/**
 * JURISPRUDÊNCIA SOB DEMANDA (30/09, dono: "trazer jurisprudências" no chat jurídico e na busca
 * processual do assessorado). Não há API aberta de jurisprudência unificada; o caminho é a busca web
 * do Claude RESTRITA a domínios de tribunal (`jus.br`, que inclui STJ, STF, TST, TJs, TRTs, TRFs) e a
 * dois portais jurídicos, com PROVA de que buscou (`buscarComProva`: resposta sem busca é falha,
 * nunca "não há jurisprudência"). Link fora dos domínios permitidos é descartado — citação sem fonte
 * verificável não sai. Cache de 30 dias por tema (`jurisprudencia_cache`): a mesma pergunta não paga
 * de novo. Custo medido em `registrarCustoGeracao('jurisprudencia')`.
 */
import { buscarComProva } from './_busca-com-prova.js';
import { ferramentaBusca } from './_busca-modelo.js';
import { registrarCustoGeracao } from './_uso.js';

const MODELO = 'claude-haiku-4-5-20251001';
export const DOMINIOS_JURIS = ['jus.br', 'conjur.com.br', 'migalhas.com.br'];
const VALIDADE_DIAS = 30;

export function urlPermitida(u) {
  try {
    const h = new URL(String(u)).hostname.toLowerCase();
    return /^https?:$/.test(new URL(String(u)).protocol) && DOMINIOS_JURIS.some((d) => h === d || h.endsWith(`.${d}`));
  } catch { return false; } // URL malformada É a resposta: não é link citável
}

export function chaveTema(tema, contexto = '') {
  return `${String(tema || '')} | ${String(contexto || '')}`.normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9| ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300);
}

function lerJson(texto) {
  const m = String(texto || '').match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; } // JSON quebrado = sem resultado aproveitável (tratado pelo chamador)
}

// Puro: itens da IA → só os com link verificável num domínio permitido, sem duplicata.
export function filtrarItens(itens) {
  const vistos = new Set();
  return (Array.isArray(itens) ? itens : [])
    .filter((i) => i && urlPermitida(i.url) && String(i.tese || '').trim().length >= 20)
    .filter((i) => { const k = String(i.url).split('#')[0]; return !vistos.has(k) && vistos.add(k); })
    .slice(0, 5)
    .map((i) => ({
      tribunal: String(i.tribunal || '').slice(0, 40) || null, processo: String(i.processo || '').slice(0, 60) || null,
      data: String(i.data || '').slice(0, 20) || null, tese: String(i.tese).trim().slice(0, 400), url: String(i.url).slice(0, 500),
    }));
}

async function sbReq(path, opts = {}) {
  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  return fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

export async function buscarJurisprudencia({ tema, contexto = '', userId = null, prazoMs = 50000 }) {
  const t = String(tema || '').trim();
  if (t.length < 8) return { erro: 'descreva o tema (ex.: "prazo para impugnar a arrematação", "imissão na posse com ocupante")' };
  const chave = chaveTema(t, contexto);
  try {
    const r = await sbReq(`jurisprudencia_cache?chave=eq.${encodeURIComponent(chave)}&criado_em=gt.${new Date(Date.now() - VALIDADE_DIAS * 86400000).toISOString()}&select=resultado,criado_em&limit=1`);
    if (r.ok) { const [c] = await r.json(); if (c?.resultado?.itens?.length) return { ...c.resultado, do_cache: true, pesquisado_em: c.criado_em }; }
    else console.warn('[jurisprudencia] cache ilegível HTTP', r.status);
  } catch (e) { console.warn('[jurisprudencia] cache:', e?.message || e); }

  const CHAVE = process.env.CLAUDE_KEY;
  if (!CHAVE) return { erro: 'CLAUDE_KEY ausente' };
  const system = 'Pesquisador jurídico brasileiro. Use a ferramenta web_search nos sites dos tribunais (jus.br) ANTES de responder — nunca responda de memória. Cite só decisões que você VIU nas páginas, com o link exato.';
  const prompt = `Pesquise jurisprudência (acórdãos, súmulas, decisões de tribunais brasileiros — dê preferência a STJ, TST e tribunais estaduais/regionais) sobre: ${t}.${contexto ? `\nContexto do caso: ${String(contexto).slice(0, 400)}` : ''}
Responda SOMENTE com JSON: {"itens":[{"tribunal":"STJ|TST|TJSP|TRT5…","processo":"número do recurso/processo como aparece","data":"data do julgamento se houver","tese":"em 1 ou 2 frases simples, o que o tribunal decidiu e por que importa para o arrematante","url":"link exato da página onde você viu"}]} — até 5 itens. Se não achar nada confiável, devolva {"itens":[]}.`;
  let res;
  try {
    res = await buscarComProva({
      degrau: { model: MODELO, ferramenta: (n) => ({ ...ferramentaBusca(MODELO, n), allowed_domains: DOMINIOS_JURIS }) },
      chave: CHAVE, system, prompt, webUses: 4, timeoutMs: prazoMs, maxTokens: 3000,
      cobranca: 'Você respondeu sem pesquisar. Use AGORA a ferramenta web_search nos sites dos tribunais (jus.br) e responda SOMENTE com o JSON pedido, só com decisões que você viu.',
      aoCusto: (c) => { registrarCustoGeracao('jurisprudencia', { userId, custoMicro: c, ok: true, meta: { tema: t.slice(0, 80) } }).catch((e) => console.warn('[jurisprudencia] custo não medido:', e?.message || e)); },
    });
  } catch (e) {
    return { erro: `pesquisa indisponível agora (${String(e?.message || e).slice(0, 60)})` };
  }
  if (!res.buscas) return { erro: 'a pesquisa não chegou a consultar os tribunais — tente de novo' };
  const j = lerJson(res.texto);
  if (!j) return { erro: 'a pesquisa voltou em formato ilegível — tente de novo' };
  const itens = filtrarItens(j.itens);
  const resultado = { tema: t, itens, buscas: res.buscas, descartados: (Array.isArray(j.itens) ? j.itens.length : 0) - itens.length,
    aviso: 'Resumo automático de decisões encontradas nos sites dos tribunais — leia o inteiro teor no link antes de usar como fundamento.' };
  if (itens.length) {
    try {
      const g = await sbReq('jurisprudencia_cache?on_conflict=chave', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ chave, tema: t.slice(0, 200), resultado, criado_em: new Date().toISOString() }) });
      if (!g.ok) console.warn('[jurisprudencia] cache não gravou HTTP', g.status);
    } catch (e) { console.warn('[jurisprudencia] cache não gravou:', e?.message || e); }
  }
  return resultado;
}
