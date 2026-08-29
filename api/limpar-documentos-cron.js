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

  while (Date.now() < DEADLINE && iteracoes < 40) {
    iteracoes++;
    // A regra em camadas (arrematado/relatório/ativo/reunião) vive na RPC anexos_expirados.
    const rpcRes = await sb('rpc/anexos_expirados', { method: 'POST', body: JSON.stringify({ p_limite: 500 }) });
    if (!rpcRes.ok) { ultimoErro = await rpcRes.text().catch(() => ''); break; }
    const anexos = await rpcRes.json().catch(() => []);
    if (!Array.isArray(anexos) || !anexos.length) break; // drenado

    const paths = anexos.map(a => a.storage_path).filter(Boolean);
    const ids   = anexos.map(a => a.id);

    // Remove os arquivos do bucket em lote (best-effort) + zera storage_path/url no banco
    // (mantém a linha para auditoria).
    await storage(`object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) });
    await sb(`imovel_anexos?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ storage_path: null, url: null }) });
    await marcarEspelhoPurgado(paths);

    // Zera TAMBÉM o link denormalizado imoveis_leilao.link_matricula quando o ARQUIVO da
    // matrícula é apagado (senão o botão "Matrícula" fica 404). Deriva o imovel_id do path.
    const idsMatricula = [...new Set(paths
      .map(p => (String(p).match(/^casos\/([0-9a-f-]{36})\/[^/]*matr[ií]cul[^/]*\.pdf$/i) || [])[1])
      .filter(Boolean))];
    if (idsMatricula.length) {
      await sb(`imoveis_leilao?id=in.(${idsMatricula.join(',')})&link_matricula=not.is.null`, { method: 'PATCH', body: JSON.stringify({ link_matricula: null }) });
      linksZerados += idsMatricula.length;
    }

    removidos += paths.length;
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

    const paths = anexos.map(a => a.storage_path).filter(Boolean);
    const ids   = anexos.map(a => a.id);
    await storage(`object/${BUCKET}`, { method: 'DELETE', body: JSON.stringify({ prefixes: paths }) });
    await sb(`imovel_anexos?id=in.(${ids.join(',')})`, { method: 'PATCH', body: JSON.stringify({ storage_path: null, url: null }) });
    await marcarEspelhoPurgado(paths);

    const idsMatricula = [...new Set(paths
      .map(p => (String(p).match(/^casos\/([0-9a-f-]{36})\/[^/]*matr[ií]cul[^/]*\.pdf$/i) || [])[1])
      .filter(Boolean))];
    if (idsMatricula.length) {
      await sb(`imoveis_leilao?id=in.(${idsMatricula.join(',')})&link_matricula=not.is.null`, { method: 'PATCH', body: JSON.stringify({ link_matricula: null }) });
      linksZerados += idsMatricula.length;
    }

    removidosAvisados += paths.length;
    if (anexos.length < 500) break;
  }

  return new Response(JSON.stringify({
    removidos, removidos_avisados: removidosAvisados, iteracoes, links_matricula_zerados: linksZerados,
    drenado: !ultimoErro && removidos >= 0, erro: ultimoErro || undefined,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
