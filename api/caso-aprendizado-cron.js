/**
 * /api/caso-aprendizado-cron — a IA aprende com tudo o que acontece num caso pós-arremate (15/10, pedido do dono).
 *
 * "A IA deve aprender com cada devolutiva de e-mail, cada anexo, cada movimentação processual. Isso gera
 * aprendizado para auxiliar em novas arrematações e diagnósticos futuros."
 *
 * As devolutivas por e-mail já têm o seu leitor (juridico-devolutivas-cron). Este cron cobre as outras três
 * fontes, por caso, só o que é NOVO desde a última leitura (caso_aprendizado_cursor):
 *   - documento: cada anexo já lido e classificado (caso_documentos: tipo, título, resumo, data);
 *   - andamento: o que a equipe registrou na tela do caso (caso_andamentos);
 *   - movimento: o que o CNJ/DataJud trouxe do processo (processo_movimentos, cnj-monitor-cron e consultas).
 * Junto vai o que os RELATÓRIOS do BidPro previram para aquele imóvel (documental e mercadológico do cliente):
 * é o confronto previsto × acontecido que vira lição útil ("o relatório não apontou X e o cartório exigiu").
 *
 * A IA devolve lições GERAIS (valem para outros imóveis), gravadas em juridico_aprendizado com fonte, UF e
 * modalidade; o gerar-documental lê e prioriza as do mesmo recorte. Caso sem nada novo não chama IA.
 * Falha da IA não move as datas de cobertura (o material é relido), mas move `atualizado_em`: o caso vai
 * para o fim da fila, para que um caso que falha sempre não trave os outros. `?seco=1` mostra sem gravar;
 * `?caso=<uuid>` força um caso.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { iaTexto } from './_claude.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const MAX_CASOS_POR_RODADA = 4;
const FONTES = ['documento', 'andamento', 'movimento'];

async function ler(path) {
  const r = await sb(path);
  if (!r.ok) throw new Error(`leitura ${path.split('?')[0]} HTTP ${r.status}`);
  return r.json();
}

const SISTEMA = `Você é o analista jurídico de uma assessoria de leilões de imóveis. Recebe, de UM caso já arrematado, o que o relatório da empresa previu antes do lance e o que aconteceu depois (documentos recebidos, registros da equipe, movimentos do processo). Extraia LIÇÕES que ajudem a avaliar OUTROS imóveis no futuro. Responda SOMENTE com JSON válido:
{"licoes":[{"fonte":"documento|andamento|movimento","tema":"curto, ex.: ITBI, carta de arrematação, desocupação, emolumentos, registro","licao":"regra prática em 1-2 frases, com prazo/valor/órgão quando o material mostrar","recorte":"geral|uf|modalidade"}]}
Regras: só o que o material sustenta; nunca invente prazos, valores ou órgãos. Lição é regra reaproveitável (ex.: "em Vargem Grande Paulista/SP o ITBI de arrematação é calculado sobre o valor venal e pago antes do registro"), não um fato isolado deste caso. Quando o relatório previu algo que não se confirmou, ou deixou de prever o que aconteceu, isso é a lição mais valiosa: diga o que o diagnóstico deveria verificar. Não repita as lições já existentes listadas. Nunca tire lição sobre o funcionamento interno da empresa, do sistema ou da abertura/encerramento de casos: só sobre imóvel, documentação, processo, cartório, tributos, custos, prazos e mercado. Fato isolado deste caso (um valor, uma data, uma sequência de datas) só entra como exemplo dentro de uma regra. NUNCA cite nome, CPF, RG ou endereço de pessoa (cliente, executado, herdeiro, ocupante): a lição vai para relatórios de OUTROS clientes. Se não houver lição nova, devolva {"licoes":[]}. Sem travessões no texto.`;

const ufDo = (caso, lote) => lote?.estado || (/\/([A-Z]{2})\b(?!.*\/[A-Z]{2}\b)/.exec(caso.imovel_endereco || '') || [])[1] || null;

function resumoRelatorios(doc, merc) {
  const p = [];
  const r = doc?.result;
  if (r) {
    p.push(`DOCUMENTAL (gerado ${String(doc.updated_at || '').slice(0, 10)}): risco ${r.nivelRisco || '?'}, confiança ${r.confianca || '?'}.`);
    const riscos = (Array.isArray(r.riscos) ? r.riscos : []).slice(0, 8).map((x) => `- ${x?.titulo || x?.risco || x?.descricao || JSON.stringify(x).slice(0, 160)}`);
    if (riscos.length) p.push(`Riscos apontados:\n${riscos.join('\n')}`);
    const pend = (Array.isArray(r.pendencias) ? r.pendencias : []).slice(0, 6).map((x) => `- ${typeof x === 'string' ? x : x?.titulo || x?.descricao || ''}`);
    if (pend.length) p.push(`Pendências apontadas:\n${pend.join('\n')}`);
    if (r.parecer) p.push(`Parecer: ${String(typeof r.parecer === 'string' ? r.parecer : JSON.stringify(r.parecer)).slice(0, 900)}`);
  }
  const m = merc?.result;
  if (m) p.push(`MERCADOLÓGICO: valor de mercado ${m.valorMercado ?? '?'}, avaliação ${m.valorAvaliacao ?? '?'}, locação ${m.valorLocacao ?? '?'}.`);
  return p.length ? p.join('\n') : 'Nenhum relatório do BidPro gerado para este imóvel.';
}

async function processarCaso(caso, cursor, licoesExistentes, { seco }) {
  const lote = caso.imovel_id ? (await ler(`imoveis_leilao?id=eq.${caso.imovel_id}&select=estado,cidade,modalidade,numero_processo`))[0] : null;
  const uf = ufDo(caso, lote);
  const modalidade = lote?.modalidade || caso.tipo_leilao || null;
  const desde = (c) => (c ? `&criado_em=gt.${encodeURIComponent(c)}` : '');

  const docs = await ler(`caso_documentos?caso_id=eq.${caso.id}${desde(cursor?.documentos_ate)}&grupo=neq.outro&select=tipo,titulo,resumo,data_documento,criado_em&order=criado_em.asc&limit=40`);
  // "Encerrado sem análise" é limpeza de caso aberto por engano (1º dry-run, 15/10: virou "lição" sobre o nosso
  // fluxo interno). Não é fato do imóvel nem do processo: fica fora.
  const ands = await ler(`caso_andamentos?caso_id=eq.${caso.id}${desde(cursor?.andamentos_ate)}&etapa=not.ilike.Encerrado%20sem%20an*&select=etapa,observacao,data_evento,numero_processo,criado_em&order=criado_em.asc&limit=40`);
  const numeros = [...new Set([lote?.numero_processo, ...(await ler(`caso_andamentos?caso_id=eq.${caso.id}&numero_processo=not.is.null&select=numero_processo`)).map((a) => a.numero_processo)].filter(Boolean))];
  const movs = numeros.length
    ? await ler(`processo_movimentos?numero_processo=in.(${numeros.map((n) => `"${String(n).replace(/"/g, '')}"`).join(',')})${desde(cursor?.movimentos_ate)}&select=data,descricao,risco,criado_em&order=criado_em.asc&limit=60`)
    : [];
  if (!docs.length && !ands.length && !movs.length) return { caso: caso.id, nada_novo: true };

  const [doc] = caso.imovel_id ? await ler(`analises_documental?imovel_id=eq.${caso.imovel_id}&user_id=eq.${caso.cliente_id}&status=eq.concluida&select=result,updated_at&limit=1`) : [];
  const [merc] = caso.imovel_id ? await ler(`analises_mercado?imovel_id=eq.${caso.imovel_id}&user_id=eq.${caso.cliente_id}&status=eq.concluida&select=result,updated_at&limit=1`) : [];

  const blocos = [
    `Imóvel: ${caso.imovel_endereco || '?'} · UF ${uf || '?'} · modalidade ${modalidade || '?'}${numeros.length ? ` · processo ${numeros.join(', ')}` : ''}`,
    `O QUE O RELATÓRIO PREVIU:\n${resumoRelatorios(doc, merc)}`,
    docs.length ? `DOCUMENTOS RECEBIDOS:\n${docs.map((d) => `- [${d.data_documento || String(d.criado_em).slice(0, 10)}] ${d.tipo || 'documento'}: ${d.titulo || ''}. ${String(d.resumo || '').slice(0, 400)}`).join('\n')}` : '',
    ands.length ? `REGISTROS DA EQUIPE:\n${ands.map((a) => `- [${a.data_evento || String(a.criado_em).slice(0, 10)}] ${a.etapa}: ${String(a.observacao || '').slice(0, 400)}`).join('\n')}` : '',
    movs.length ? `MOVIMENTOS DO PROCESSO:\n${movs.map((m) => `- [${m.data}] ${String(m.descricao || '').slice(0, 250)}${m.risco ? ` (risco: ${m.risco})` : ''}`).join('\n')}` : '',
    licoesExistentes.length ? `LIÇÕES JÁ REGISTRADAS (não repita):\n${licoesExistentes.map((l) => `- ${l}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');

  const ia = await iaTexto({ system: SISTEMA, prompt: blocos.slice(0, 60000), maxTokens: 1500, primario: 'claude', timeoutMs: 90000 });
  if (!ia) return { caso: caso.id, erro: 'IA indisponível' };
  const ini = ia.texto.indexOf('{'), fim = ia.texto.lastIndexOf('}');
  let saida = null;
  try { saida = ini >= 0 ? JSON.parse(ia.texto.slice(ini, fim + 1)) : null; } catch (e) { console.warn(`[caso-aprendizado] JSON inválido no caso ${caso.id}: ${e?.message}`); }
  if (!saida || !Array.isArray(saida.licoes)) return { caso: caso.id, erro: 'IA respondeu fora do formato' };

  const licoes = saida.licoes.filter((l) => l?.licao).slice(0, 8).map((l) => {
    const fonte = FONTES.includes(l.fonte) ? l.fonte : 'documento';
    return {
      caso_id: caso.id, imovel_id: caso.imovel_id || null, fonte,
      uf: l.recorte === 'geral' ? null : uf, modalidade: l.recorte === 'geral' ? null : modalidade,
      campo: `licao_${fonte}:${String(l.tema || 'geral').slice(0, 60)}`, valor_ia: null,
      valor_advogado: String(l.licao).replace(/\s*[—–]\s*/g, ', ').slice(0, 600),
      observacao: `aprendido do caso (${[caso.imovel_endereco, modalidade].filter(Boolean).join(' · ')}) pelo caso-aprendizado-cron`,
    };
  });
  const novoCursor = {
    caso_id: caso.id,
    documentos_ate: docs.length ? docs[docs.length - 1].criado_em : cursor?.documentos_ate || null,
    andamentos_ate: ands.length ? ands[ands.length - 1].criado_em : cursor?.andamentos_ate || null,
    movimentos_ate: movs.length ? movs[movs.length - 1].criado_em : cursor?.movimentos_ate || null,
    licoes_total: (cursor?.licoes_total || 0) + licoes.length, atualizado_em: new Date().toISOString(),
  };
  const lido = { documentos: docs.length, andamentos: ands.length, movimentos: movs.length };
  if (seco) return { caso: caso.id, lido, licoes };

  if (licoes.length) {
    const r = await sb('juridico_aprendizado', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(licoes) });
    const gravadas = r.ok ? await r.json() : [];
    // Lição não gravada = cursor parado: o mesmo material é relido na próxima rodada, nada se perde.
    if (gravadas.length !== licoes.length) throw new Error(`gravar lições HTTP ${r.status}: ${r.ok ? 'gravou menos que o enviado' : (await r.text().catch(() => '')).slice(0, 200)}`);
  }
  const up = await sb('caso_aprendizado_cursor?on_conflict=caso_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(novoCursor) });
  const cur = up.ok ? await up.json() : [];
  if (!cur.length) console.error(`[caso-aprendizado] cursor do caso ${caso.id} não gravado: HTTP ${up.status}`);
  return { caso: caso.id, lido, licoes: licoes.length };
}

// 19/10: caso que falha SEMPRE (IA fora do formato, leitura quebrada) não movia o cursor e, como a fila é
// ordenada por `atualizado_em`, voltava ao topo em toda rodada — 4 casos assim travavam a fila inteira
// (MAX_CASOS_POR_RODADA). Na falha, só o relógio da fila anda: as datas de cobertura (documentos_ate etc.)
// ficam onde estavam, então o material NÃO se perde — é relido quando o caso voltar à vez.
async function adiarNaFila(casoId) {
  const r = await sb('caso_aprendizado_cursor?on_conflict=caso_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify({ caso_id: casoId, atualizado_em: new Date().toISOString() }) });
  const cur = r.ok ? await r.json().catch(() => []) : [];
  if (!cur.length) console.error(`[caso-aprendizado] não consegui adiar o caso ${casoId} na fila: HTTP ${r.status}`);
}

async function handler(req) {
  if (!isCronAuthorized(req)) return new Response(JSON.stringify({ error: 'não autorizado' }), { status: 401 });
  const url = new URL(req.url, BASE);
  const seco = url.searchParams.get('seco') === '1';
  const casoForcado = url.searchParams.get('caso');
  const res = { seco, processados: 0, licoes: 0, nada_novo: 0, falhas: 0, resultados: [] };
  try {
    if (casoForcado && !/^[0-9a-f-]{36}$/i.test(casoForcado)) throw new Error('caso inválido');
    const casos = await ler(`casos?${casoForcado ? `id=eq.${casoForcado}&` : ''}select=id,imovel_id,imovel_endereco,cliente_id,tipo_leilao&order=created_at.desc&limit=300`);
    const cursores = new Map((await ler('caso_aprendizado_cursor?select=*')).map((c) => [c.caso_id, c]));
    // Lições recentes entram no prompt para a IA não repetir o que já se sabe.
    const existentes = (await ler('juridico_aprendizado?campo=like.licao_*&select=valor_advogado&order=criado_em.desc&limit=60')).map((l) => String(l.valor_advogado || '').slice(0, 200));
    // Quem nunca foi lido primeiro, depois o lido há mais tempo.
    casos.sort((a, b) => String(cursores.get(a.id)?.atualizado_em || '').localeCompare(String(cursores.get(b.id)?.atualizado_em || '')));
    for (const caso of casos) {
      if (res.processados >= MAX_CASOS_POR_RODADA) break;
      try {
        const r = await processarCaso(caso, cursores.get(caso.id), existentes, { seco });
        if (r.nada_novo) { res.nada_novo++; continue; }
        res.processados++;
        res.resultados.push(r);
        if (r.erro) { res.falhas++; if (!seco) await adiarNaFila(caso.id); }
        else res.licoes += Array.isArray(r.licoes) ? r.licoes.length : r.licoes || 0;
      } catch (e) {
        res.falhas++;
        res.resultados.push({ caso: caso.id, erro: e?.message });
        console.error(`[caso-aprendizado] caso ${caso.id}:`, e?.message);
        if (!seco) await adiarNaFila(caso.id).catch((e2) => console.error(`[caso-aprendizado] adiar ${caso.id}:`, e2?.message));
      }
    }
  } catch (e) {
    console.error('[caso-aprendizado] falhou:', e?.message);
    return new Response(JSON.stringify({ ok: false, erro: e?.message, ...res }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  console.log('[caso-aprendizado]', JSON.stringify({ processados: res.processados, licoes: res.licoes, falhas: res.falhas }));
  return new Response(JSON.stringify({ ok: true, ...res }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

export const GET = handler;
export const POST = handler;
