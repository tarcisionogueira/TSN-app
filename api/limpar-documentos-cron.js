/**
 * GET /api/limpar-documentos-cron
 * Cron diário: apaga do bucket os documentos (edital/matrícula/anexos) elegíveis
 * pela RETENÇÃO EM CAMADAS (RPC anexos_expirados):
 *   • SEM data (venda direta)  → mantém enquanto o imóvel está no acervo; apaga
 *                                 quando a CEF o retira (imoveis_leilao.ativo=false).
 *   • COM data + sem reunião   → apaga no dia seguinte ao leilão (curioso gera de novo).
 *   • COM data + reunião       → mantém 30 dias após o leilão (janela p/ arremate).
 *   • arrematado = true        → nunca apaga (permanente).
 *
 * Mantém o registro no banco (sem storage_path/url) para auditoria.
 * Processa em lotes para não estourar o timeout da Edge.
 */

// Node runtime (não edge): a limpeza faz um DELETE em lote no Storage + PATCH no
// banco que às vezes passava do teto curto da Edge (timeout ~60s). Com nodejs +
// maxDuration 300 há folga de sobra. Exportar por MÉTODO nomeado (GET/POST), nunca
// `export default` — no Node da Vercel o default vira assinatura Express (req,res) e
// o Response é ignorado, pendurando a função até o timeout.
export const config = { runtime: 'nodejs', maxDuration: 300 };

// ⚠️ 29/08 — RESSURREIÇÃO DE ARQUIVO APAGADO (defeito introduzido HOJE, fechado no mesmo dia).
// A publicação do espelho (`registrar_anexos_do_espelho`, criada hoje) PREENCHE o `storage_path`
// de todo `imovel_anexos` que está nulo. E a limpeza abaixo faz exatamente isto: apaga o arquivo
// do bucket e **anula o storage_path**. Sem o aviso, o ciclo ficava assim:
//
//   limpeza apaga espelho/FONTE/<id>/matricula-x.pdf e anula a linha
//     → 4h depois o cron do espelho republica a MESMA linha com o MESMO caminho
//       → o relatório tenta assinar um objeto que não existe mais
//
// Ou seja: a retenção continuaria funcionando e o efeito dela seria desfeito sozinho, deixando
// para trás um ponteiro para arquivo inexistente — pior que não ter apagado, porque parece que
// o documento está lá. Marcar o espelho como `purgado` fecha o laço na origem: a função de
// publicação só considera `status = 'copiado'`.
async function marcarEspelhoPurgado(paths) {
  const doEspelho = (paths || []).filter((p) => String(p).startsWith('espelho/'));
  if (!doEspelho.length) return;
  try {
    const lista = doEspelho.map((p) => `"${p.replace(/"/g, '')}"`).join(',');
    // padrao-ok: aviso best-effort — falhar aqui reabre a ressurreição, mas NUNCA pode impedir
    // a limpeza em si (que é o que protege o custo de storage). O invariante abaixo vigia.
    await sb(`documento_espelho?storage_path=in.(${lista})`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ status: 'purgado', motivo: 'apagado pela retencao em camadas' }),
    });
  } catch { /* ver comentário acima */ }
}

import { isCronAuthorized } from './_auth.js';
import { limparEspelho } from './_limpeza-espelho.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET       = 'documentos';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

function storage(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

// 04/10 — Antes o DELETE no Storage e o PATCH no banco não tinham o resultado conferido: se o
// DELETE falhava, o arquivo ficava órfão para sempre (custo/LGPD) e o banco zerava o ponteiro
// assim mesmo; se o PATCH falhava, sobrava ponteiro para arquivo apagado; e `removidos` contava
// tudo como apagado (forma nº 10). Agora só zera o ponteiro do que o Storage CONFIRMOU ter
// apagado (a remoção em lote devolve a lista dos objetos removidos) ou que comprovadamente já
// não existe, e só conta o que foi apagado E teve o ponteiro zerado.
const MAX_CHECAGENS_AUSENCIA = 50;

// 04/10 — Objeto que já não existe não volta na lista de removidos; sem esta checagem a linha
// ficaria para sempre elegível e travaria o lote. Devolve true (ausente), false (existe) ou
// null (não deu para saber — aí NÃO zera o ponteiro).
async function objetoAusente(path) {
  const i = path.lastIndexOf('/');
  const prefix = i >= 0 ? path.slice(0, i) : '';
  const nome = i >= 0 ? path.slice(i + 1) : path;
  try {
    const r = await storage(`object/list/${BUCKET}`, {
      method: 'POST', body: JSON.stringify({ prefix, search: nome, limit: 100 }),
    });
    if (!r.ok) { console.error('[limpar-documentos] checagem de ausência falhou', r.status, path); return null; }
    const itens = await r.json();
    return !(Array.isArray(itens) && itens.some((o) => o?.name === nome));
  } catch (e) {
    console.error('[limpar-documentos] checagem de ausência:', path, String(e?.message || e).slice(0, 120));
    return null;
  }
}

// Apaga um lote de anexos e devolve o que de fato aconteceu, com o motivo das falhas.
async function apagarLote(anexos) {
  const res = { apagados: 0, ja_ausentes: 0, sem_arquivo: 0, falhas: 0, motivos: [], pathsConfirmados: [] };
  const comPath = anexos.filter((a) => a.storage_path);
  const semPath = anexos.filter((a) => !a.storage_path);
  const paths = comPath.map((a) => a.storage_path);

  // 1) DELETE em lote — confirmado = nome devolvido na resposta.
  const confirmados = new Set();
  if (paths.length) {
    try {
      const r = await storage(`object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) });
      const corpo = await r.text();
      if (!r.ok) {
        console.error('[limpar-documentos] DELETE no Storage falhou', r.status, corpo.slice(0, 300));
        res.motivos.push(`storage DELETE HTTP ${r.status}: ${corpo.slice(0, 120)}`);
      } else {
        let lista = null;
        try { lista = JSON.parse(corpo); } catch (e) { res.motivos.push(`storage DELETE corpo ilegível: ${String(e?.message || e).slice(0, 80)}`); }
        if (Array.isArray(lista)) for (const o of lista) if (o?.name) confirmados.add(o.name);
      }
    } catch (e) {
      const m = String(e?.message || e).slice(0, 120);
      console.error('[limpar-documentos] DELETE no Storage:', m);
      res.motivos.push(`storage DELETE: ${m}`);
    }
  }

  // 2) Não confirmados: só zera se o objeto comprovadamente não existe mais (com teto de checagens).
  const ausentes = new Set();
  const naoConfirmados = paths.filter((p) => !confirmados.has(p)).slice(0, MAX_CHECAGENS_AUSENCIA);
  const checagens = await Promise.all(naoConfirmados.map(async (p) => [p, await objetoAusente(p)]));
  for (const [p, ausente] of checagens) if (ausente === true) ausentes.add(p);

  // 3) PATCH só nas linhas cujo arquivo sumiu (ou que nunca tiveram arquivo — só limpa a url).
  const alvo = [
    ...comPath.filter((a) => confirmados.has(a.storage_path) || ausentes.has(a.storage_path)),
    ...semPath,
  ];
  let zerados = new Set();
  if (alvo.length) {
    try {
      const r = await sb(`imovel_anexos?id=in.(${alvo.map((a) => a.id).join(',')})&select=id`, {
        method: 'PATCH', body: JSON.stringify({ storage_path: null, url: null }),
      });
      if (!r.ok) {
        const corpo = await r.text().catch((e) => `(corpo ilegível: ${e?.message || e})`);
        console.error('[limpar-documentos] PATCH imovel_anexos falhou', r.status, corpo.slice(0, 300));
        res.motivos.push(`PATCH imovel_anexos HTTP ${r.status}: ${corpo.slice(0, 120)}`);
      } else {
        const linhas = await r.json();
        zerados = new Set((Array.isArray(linhas) ? linhas : []).map((l) => String(l.id)));
      }
    } catch (e) {
      const m = String(e?.message || e).slice(0, 120);
      console.error('[limpar-documentos] PATCH imovel_anexos:', m);
      res.motivos.push(`PATCH imovel_anexos: ${m}`);
    }
  }

  for (const a of comPath) {
    const p = a.storage_path;
    if (!zerados.has(String(a.id))) { res.falhas++; continue; }
    if (confirmados.has(p)) { res.apagados++; res.pathsConfirmados.push(p); }
    else if (ausentes.has(p)) { res.ja_ausentes++; res.pathsConfirmados.push(p); }
  }
  res.sem_arquivo = semPath.filter((a) => zerados.has(String(a.id))).length;
  if (res.falhas && !res.motivos.length) res.motivos.push(`${res.falhas} arquivo(s) não confirmados pelo Storage nem comprovadamente ausentes`);
  return res;
}

// Zera imoveis_leilao.link_matricula dos paths de matrícula realmente apagados (senão o botão
// "Matrícula" fica 404). Deriva o imovel_id do path. 04/10: resultado conferido.
async function zerarLinksMatricula(paths) {
  const idsMatricula = [...new Set(paths
    .map(p => (String(p).match(/^casos\/([0-9a-f-]{36})\/[^/]*matr[ií]cul[^/]*\.pdf$/i) || [])[1])
    .filter(Boolean))];
  if (!idsMatricula.length) return 0;
  try {
    const r = await sb(`imoveis_leilao?id=in.(${idsMatricula.join(',')})&link_matricula=not.is.null&select=id`, { method: 'PATCH', body: JSON.stringify({ link_matricula: null }) });
    if (!r.ok) { console.error('[limpar-documentos] PATCH link_matricula falhou', r.status, (await r.text().catch(() => '')).slice(0, 300)); return 0; }
    const linhas = await r.json();
    return Array.isArray(linhas) ? linhas.length : 0;
  } catch (e) {
    console.error('[limpar-documentos] PATCH link_matricula:', String(e?.message || e).slice(0, 120));
    return 0;
  }
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('Unauthorized', { status: 401 });

  // LOOP até DRENAR o backlog (antes apagava só 200/dia e o acervo crescia mais rápido
  // → Storage acumulava ~10GB). A cada volta pega até 500 (teto da RPC), apaga do bucket
  // e zera storage_path (aí saem do próximo `storage_path is not null`). Para quando não
  // há mais elegíveis, no teto de tempo (~250s de 300s) ou de iterações. Idempotente.
  const DEADLINE = Date.now() + 250_000;
  let removidos = 0, linksZerados = 0, iteracoes = 0, ultimoErro = null;
  // 04/10: o que NÃO foi apagado também aparece no retorno, com o porquê (forma nº 10).
  let jaAusentes = 0, falhas = 0;
  const motivosFalha = new Set();
  const acumular = (l) => { jaAusentes += l.ja_ausentes; falhas += l.falhas; for (const m of l.motivos) if (motivosFalha.size < 10) motivosFalha.add(m); };

  while (Date.now() < DEADLINE && iteracoes < 40) {
    iteracoes++;
    // A regra em camadas (arrematado/relatório/ativo/reunião) vive na RPC anexos_expirados.
    const rpcRes = await sb('rpc/anexos_expirados', { method: 'POST', body: JSON.stringify({ p_limite: 500 }) });
    if (!rpcRes.ok) { ultimoErro = await rpcRes.text().catch(() => ''); break; }
    const anexos = await rpcRes.json().catch(() => []);
    if (!Array.isArray(anexos) || !anexos.length) break; // drenado

    // Remove os arquivos do bucket + zera storage_path/url no banco (mantém a linha para
    // auditoria) — 04/10: só do que o Storage confirmou (ver apagarLote).
    const lote = await apagarLote(anexos);
    await marcarEspelhoPurgado(lote.pathsConfirmados);
    linksZerados += await zerarLinksMatricula(lote.pathsConfirmados);
    removidos += lote.apagados;
    acumular(lote);
    // 04/10: lote sem nenhum progresso devolveria as MESMAS linhas na próxima volta — para.
    if (!lote.apagados && !lote.ja_ausentes && !lote.sem_arquivo) break;
    if (anexos.length < 500) break; // último lote (menos que o teto)
  }

  // ── Retenção Etapa 2 (notify-first) ──────────────────────────────────────────
  // Documentos elegíveis pelas Regras 1/2 do dono, MAS somente os que já receberam
  // aviso (email_enviado=true) e cuja carência venceu (apagar_em<=now). A RPC
  // anexos_expirados_avisados revalida o estado atual (inadimplência/arremate/
  // relatórios), então nada é apagado se o cliente regularizou ou sinalizou depois.
  // Enquanto o retencao-avisos-cron estiver em dry-run, esta RPC retorna vazio.
  let removidosAvisados = 0;
  while (Date.now() < DEADLINE && iteracoes < 80) {
    iteracoes++;
    const rpcRes = await sb('rpc/anexos_expirados_avisados', { method: 'POST', body: JSON.stringify({ p_limite: 500 }) });
    if (!rpcRes.ok) { ultimoErro = await rpcRes.text().catch(() => ''); break; }
    const anexos = await rpcRes.json().catch(() => []);
    if (!Array.isArray(anexos) || !anexos.length) break; // drenado (ou vazio em dry-run)

    const lote = await apagarLote(anexos);
    await marcarEspelhoPurgado(lote.pathsConfirmados);
    linksZerados += await zerarLinksMatricula(lote.pathsConfirmados);
    removidosAvisados += lote.apagados;
    acumular(lote);
    if (!lote.apagados && !lote.ja_ausentes && !lote.sem_arquivo) break; // 04/10: sem progresso
    if (anexos.length < 500) break;
  }

  // ── Faxina do espelho (25/09, autorizada pelo dono): documento de imóvel que saiu do acervo sem
  // cliente + cópias idênticas. Os arquivos do espelho que nunca entraram em imovel_anexos não
  // passavam por NADA acima — foi assim que o bucket chegou a 64 GB. Mesma regra do workflow
  // limpar-espelho.yml (api/_limpeza-espelho.js); usa só o tempo que sobrou.
  let espelho = null;
  const restante = DEADLINE - Date.now();
  if (restante > 20000) {
    espelho = await limparEspelho({ url: SUPABASE_URL, key: SERVICE_KEY, aplicar: true, prazoMs: restante - 10000, lote: 1000 })
      .catch((e) => ({ erro: String(e?.message || e).slice(0, 120) }));
    if (espelho?.erro && espelho.erro !== 'rodada sem progresso') console.error('[limpar-documentos] espelho:', espelho.erro);
  }

  // Histórico do chat operacional (30/09): 12 meses; conversa com 👍 (exemplo que ensina o chat) 24.
  let chatExpirado = null;
  try {
    const rc = await sb('rpc/admin_chat_memoria_expirar', { method: 'POST', body: '{}' });
    chatExpirado = rc.ok ? await rc.json() : `HTTP ${rc.status}`;
    if (!rc.ok) console.error('[limpar-documentos] retenção do chat falhou:', chatExpirado);
  } catch (e) { chatExpirado = String(e?.message || e).slice(0, 80); console.error('[limpar-documentos] retenção do chat:', chatExpirado); }

  if (falhas) console.error('[limpar-documentos] anexos NÃO apagados:', falhas, [...motivosFalha]);
  return new Response(JSON.stringify({
    espelho, chat_expirado: chatExpirado,
    removidos, removidos_avisados: removidosAvisados, iteracoes, links_matricula_zerados: linksZerados,
    ja_ausentes_zerados: jaAusentes, falhas, motivos_falha: motivosFalha.size ? [...motivosFalha] : undefined,
    drenado: !ultimoErro && !falhas, erro: ultimoErro || undefined, // 04/10: falha não é "drenado"
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
