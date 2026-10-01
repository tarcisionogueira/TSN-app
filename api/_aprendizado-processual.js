/**
 * APRENDIZADO PROCESSUAL (30/09, dono: "garanta que o agente que aprende com o relatório documental
 * e processual também aprenda com essas consultas — aproveita a leitura do processo para um
 * possível diagnóstico").
 *
 * Antes: só o cnj-monitor-cron alimentava o aprendizado processual. Consulta feita à mão (tela do
 * caso, chat operacional) e jurisprudência pesquisada morriam na tela. Agora as duas pontas:
 *
 *  ENTRADA — `aprenderDaConsulta()` (chamada pela tela do caso e pelo chat):
 *    1. movimentos → `processo_movimentos` (a série que calibra processo_fluxo_estatistica);
 *    2. desfecho/marco do arremate → `arremate_aprendizado.realizado.juridico` (só se o lote é
 *       arremate; mesmo registro que o monitor faz);
 *    3. lição do agente 'processual' → `agente_aprendizado` (etapa, ritmo, riscos, origem).
 *  SAÍDA — `contextoProcessualParaDocumental()` (injetado no prompt do relatório documental):
 *    a leitura JÁ FEITA do processo do lote (etapa, ritmo, previsão), os padrões reais da Justiça
 *    dele e a jurisprudência já pesquisada. Custo zero (só leitura do banco).
 *
 * Nunca lança e nunca bloqueia quem chama: aprendizado é best-effort, com o motivo no log.
 * Poison-resistente (regra de _aprendizado.js): grava só o que veio do CNJ/DJEN, nunca texto do usuário.
 */
import { classificarDesfecho, registrarDesfechoJuridico } from './_arremate-aprendizado.js';
import { aprenderNaEmissao } from './_aprendizado.js';
import { preverAndamento, estatisticaFluxo, justicaDoNumero } from './_previsao-processo.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
function sb(path, opts = {}) {
  return fetch(`${SB}/rest/v1/${path}`, {
    ...opts, signal: opts.signal || AbortSignal.timeout(8000),
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
const digitos = (n) => String(n || '').replace(/\D/g, '');

// Lote(s) do acervo com este número (a coluna guarda o número em dois formatos — a RPC normaliza).
async function lotesDoProcesso(numero) {
  try {
    const r = await sb('rpc/buscar_lote_por_processo', { method: 'POST', body: JSON.stringify({ p_numero: numero }) });
    if (!r.ok) { console.warn('[aprendizado-processual] lote do processo HTTP', r.status); return []; }
    return await r.json();
  } catch (e) { console.warn('[aprendizado-processual] lote do processo:', e?.message || e); return []; }
}

/**
 * @param {{ numero: string, processo?: {tribunal?, classe?, movimentos?: Array<{data,descricao,codigo}>},
 *           publicacoes?: Array<{data_disponibilizacao, texto, tipo_documento}>, imovelId?: string, origem: string }} p
 * @returns {Promise<{movimentos_gravados:number, desfecho:boolean, licao:boolean}>}
 */
export async function aprenderDaConsulta({ numero, processo = null, publicacoes = [], imovelId = null, origem }) {
  const out = { movimentos_gravados: 0, desfecho: false, licao: false };
  if (!SB || !KEY || digitos(numero).length < 15) return out;
  const movs = (processo?.movimentos || []).filter((m) => m?.data);
  const numeroSerie = digitos(processo?.numero || numero); // o monitor grava os 20 dígitos (numeroProcesso do DataJud)

  // 1) série
  if (movs.length) {
    try {
      const r = await sb('processo_movimentos?on_conflict=numero_processo,data,codigo,descricao', {
        method: 'POST', headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(movs.map((m) => ({ numero_processo: numeroSerie, data: String(m.data).slice(0, 10), codigo: m.codigo ?? null, descricao: String(m.nome_base || m.descricao || '').slice(0, 300), risco: m.risco || null }))),
      });
      if (r.ok) out.movimentos_gravados = movs.length; else console.warn('[aprendizado-processual] série não gravada HTTP', r.status);
    } catch (e) { console.warn('[aprendizado-processual] série não gravada:', e?.message || e); }
  }

  // 2) desfecho do arremate (lotes do acervo com este número, ou o imóvel informado)
  const imoveis = imovelId ? [{ id: imovelId }] : await lotesDoProcesso(numero);
  // Desfecho só pelos 20 movimentos MAIS RECENTES (o que `movimentos` sempre trouxe): com a série
  // completa (01/10, até 400), o "trânsito em julgado" da fase de CONHECIMENTO — anos antes da
  // execução e do leilão — marcava `encerrado` e o prompt passava a dizer "desembaraço concluído".
  const recentes = [...movs].sort((a, b) => String(b.data || '').localeCompare(String(a.data || ''))).slice(0, 20);
  const textos = [...recentes.map((m) => ({ data: m.data, descricao: m.descricao })), ...(publicacoes || []).map((p) => ({ data: p.data_disponibilizacao, descricao: String(p.texto || '').slice(0, 600) }))]
    .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')));
  const desfecho = classificarDesfecho(textos);
  for (const im of imoveis.slice(0, 3)) {
    try {
      const ok = await registrarDesfechoJuridico(im.id, { numero: processo?.numero || numero, tribunal: processo?.tribunal || null, movimentos: movs.length ? movs : textos }, desfecho);
      out.desfecho = out.desfecho || !!ok;
    } catch (e) { console.warn('[aprendizado-processual] desfecho:', e?.message || e); }
  }

  // 3) lição do agente 'processual'
  try {
    const est = await estatisticaFluxo(justicaDoNumero(numero));
    const pv = preverAndamento({ movimentos: movs, publicacoes, estat: est.linhas, justica: est.justica });
    // Mesma etapa da previsão (corte de 180 dias): a série completa traria agravo/carta de outra fase.
    const etapa = pv?.etapa_arrematacao || null;
    const lote = imoveis[0] || {};
    await aprenderNaEmissao(sb, {
      agente: 'processual',
      imovel: { id: lote.id || '', cidade: lote.cidade || null, estado: lote.estado || null, tipo: null, modalidade: 'judicial' },
      corpus: {
        numero: digitos(numero), tribunal: processo?.tribunal || null, classe: processo?.classe || null, justica: justicaDoNumero(numero),
        origem, n_movimentos: movs.length, n_publicacoes: (publicacoes || []).length,
        etapa: etapa?.etapa || null, marco: desfecho.marco || null, encerrado: !!desfecho.encerrado,
        status: pv?.status || null, entre_despachos_dias: pv?.entre_despachos?.mediana ?? null,
        dias_desde_ultimo: pv?.dias_desde_ultimo ?? null, ultimo_ato: pv?.ultimo_ato?.classe || null,
      },
      qualidade: { cnj_sem_movimentos: !movs.length, djen_sem_publicacoes: !(publicacoes || []).length },
    });
    out.licao = true;
  } catch (e) { console.warn('[aprendizado-processual] lição:', e?.message || e); }
  return out;
}

/**
 * Bloco para o prompt do relatório DOCUMENTAL: o que as consultas já ensinaram sobre ESTE processo
 * e sobre processos parecidos. Vazio quando não há nada (nunca inventa).
 */
export async function contextoProcessualParaDocumental({ numeroProcesso }) {
  if (!SB || !KEY) return '';
  const partes = [];
  const dig = digitos(numeroProcesso);
  try {
    const est = await estatisticaFluxo(dig.length === 20 ? justicaDoNumero(dig) : null);
    // (a) leitura já feita deste processo (série gravada por monitor/tela/chat)
    if (dig.length >= 15) {
      const r = await sb(`processo_movimentos?numero_processo=in.(${dig},${encodeURIComponent(numeroProcesso)})&select=data,codigo,descricao&order=data.desc&limit=200`);
      const movs = r.ok ? await r.json() : [];
      if (!r.ok) console.warn('[aprendizado-processual] série do processo HTTP', r.status);
      if (Array.isArray(movs) && movs.length) {
        const pv = preverAndamento({ movimentos: movs, estat: est.linhas, justica: est.justica });
        const etapa = pv.etapa_arrematacao; // com o corte de 180 dias — a série gravada vai a 200 linhas
        partes.push(`- Este processo JÁ FOI LIDO pela plataforma (${movs.length} movimentações, última em ${String(movs[0].data).slice(0, 10)}): ${pv.resumo}${etapa ? ` Etapa detectada: ${etapa.etapa} (${etapa.base_legal}).` : ''}`);
      }
    }
    // (b) padrões reais da Justiça do processo
    const ed = (est.linhas || []).find((x) => x.de === 'decisao' && x.para === 'decisao_seguinte' && Number(x.n) >= 5);
    const cd = (est.linhas || []).find((x) => x.de === 'conclusao' && x.para === 'decisao_seguinte' && Number(x.n) >= 5);
    if (ed || cd) partes.push(`- Ritmo real dos processos acompanhados${est.justica ? ` (Justiça ${est.justica})` : ''}: ${ed ? `entre despachos do juiz, mediana ${ed.mediana} dias (metade entre ${ed.p25} e ${ed.p75})` : ''}${ed && cd ? '; ' : ''}${cd ? `autos conclusos → decisão, mediana ${cd.mediana} dias` : ''}. Use para estimar prazos (ex.: expedição de carta/imissão), dizendo que é estimativa.`);
  } catch (e) { console.warn('[aprendizado-processual] contexto:', e?.message || e); }
  // (c) jurisprudência já pesquisada (cache recente)
  try {
    const r = await sb(`jurisprudencia_cache?select=tema,resultado&order=criado_em.desc&limit=4`);
    const js = r.ok ? await r.json() : [];
    const itens = (Array.isArray(js) ? js : []).flatMap((j) => (j.resultado?.itens || []).slice(0, 2).map((i) => `  · [${j.tema}] ${[i.tribunal, i.processo].filter(Boolean).join(' ')}: ${i.tese} (${i.url})`)).slice(0, 6);
    if (itens.length) partes.push(`- Jurisprudência já pesquisada pela equipe (cite SÓ se for pertinente a este lote, com o link):\n${itens.join('\n')}`);
  } catch (e) { console.warn('[aprendizado-processual] jurisprudência:', e?.message || e); }
  return partes.length ? `\n\nAPRENDIZADO DAS CONSULTAS PROCESSUAIS (leituras reais do CNJ/DJEN feitas pela plataforma — fatos, não suposições; se contradizerem os documentos, aponte a divergência):\n${partes.join('\n')}` : '';
}
