/**
 * CACHE DE EXTRAÇÃO POR DOCUMENTO + PRIOR DE PAGAMENTO POR LEILOEIRO.
 * "Leia 1 vez, use em todo lugar" (pedido do dono, 05/08): a leitura de edital/
 * matrícula — determinística (grátis) ou por IA (paga) — grava o resultado em
 * `doc_extracoes` chaveado pelo CONTEÚDO; mercadológico, documental e laudo
 * consultam o cache antes de qualquer download ou chamada paga. Regenerar um
 * relatório, ou gerar o 2º/3º do mesmo lote, custa zero.
 *
 * Cascata de custo (mesmo padrão do geocode): regex/pdf-parse primeiro (custo
 * zero), IA só quando o campo crítico não saiu no grátis, visão só onde o
 * documental já a usa. Cada camada grava por cima apenas com confiança >= a
 * existente no campo — o barato nunca apaga o preciso.
 *
 * O "agente que aprende" (leiloeiro_pagamento_prior): cada extração de forma de
 * pagamento VOTA no padrão do leiloeiro × modalidade; lote cujo edital não abre
 * (escaneado/judicial) herda o CONSENSO (moda com ≥2 amostras), sempre rotulado
 * `origem: 'padrao_leiloeiro'` — estimado com base declarada, nunca inventado.
 */
import { createHash } from 'node:crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const sb = (path, init = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...init,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  signal: init.signal || AbortSignal.timeout(10000),
});

export const chaveConteudo = (texto) => 'h:' + createHash('md5').update(String(texto || '')).digest('hex');
// URL canônica: sem querystring (signed URLs trocam o token a cada assinatura — o
// documento é o mesmo) e limitada — chave estável entre gerações de relatório.
export const chaveUrl = (url) => 'u:' + String(url || '').split(/[?#]/)[0].slice(0, 500);

/** Lê o cache. Chave 'h:' (conteúdo) vale para sempre; 'u:' expira em maxDias. */
export async function cacheLer(chave, { maxDias = 30 } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY || !chave) return null;
  try {
    const r = await sb(`doc_extracoes?chave=eq.${encodeURIComponent(chave)}&select=campos,extrator,atualizado_em&limit=1`);
    if (!r.ok) return null;
    const [row] = await r.json();
    if (!row) return null;
    if (chave.startsWith('u:') && Date.now() - new Date(row.atualizado_em).getTime() > maxDias * 864e5) return null;
    return row;
  } catch { return null; }
}

/**
 * Grava campos no cache com MERGE por confiança: um campo existente só é
 * sobrescrito se a confiança nova for >= à registrada para ele. Best-effort.
 */
export async function cacheGravar(chave, { url = null, imovelId = null, tipoDoc = null, campos = {}, via = 'regex', confianca = 60 } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY || !chave) return;
  const uteis = {};
  for (const [k, v] of Object.entries(campos || {})) {
    if (v === null || v === undefined || v === '' || (typeof v === 'number' && !Number.isFinite(v))) continue;
    uteis[k] = v;
  }
  if (!Object.keys(uteis).length) return;
  try {
    const atual = await cacheLer(chave, { maxDias: 36500 });
    const camposFinal = { ...(atual?.campos || {}) };
    const extratorFinal = { ...(atual?.extrator || {}) };
    for (const [k, v] of Object.entries(uteis)) {
      const confAtual = Number(extratorFinal?.[k]?.confianca) || 0;
      if (confianca >= confAtual) { camposFinal[k] = v; extratorFinal[k] = { via, confianca }; }
    }
    await sb('doc_extracoes?on_conflict=chave', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ chave, url, imovel_id: imovelId ? String(imovelId) : null, tipo_doc: tipoDoc, campos: camposFinal, extrator: extratorFinal, atualizado_em: new Date().toISOString() }),
    });
  } catch { /* cache é acelerador, nunca bloqueia */ }
}

const numBr = (s) => {
  const v = parseFloat(String(s || '').replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(v) ? v : 0;
};

/**
 * METRAGEM + Nº DA MATRÍCULA por regex (custo zero) — o dado que os casos
 * documentados de divergência pedem. Âncoras estritas: só aceita área COM a
 * qualificação (privativa/construída/total/terreno) para nunca confundir
 * fração ideal/área comum com a área que baliza o R$/m².
 */
export function extrairMatriculaTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 120) return null;
  const area = (re) => {
    let best = 0;
    for (const m of t.matchAll(re)) {
      const v = numBr(m[1]);
      if (v >= 5 && v <= 1000000 && v > best) best = v;
    }
    return best || null;
  };
  const out = {
    areaPrivativaM2: area(/[áa]rea\s+(?:real\s+)?(?:privativ|[úu]til|constru[íi]d)[a-zíú]*\s+(?:de\s+|com\s+|:\s*)?(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d{1,6}(?:,\d{1,4})?)\s*(?:m²|m2|metros?\s+quadrados?)/gi),
    areaTotalM2: area(/[áa]rea\s+total\s+(?:de\s+|com\s+|:\s*)?(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d{1,6}(?:,\d{1,4})?)\s*(?:m²|m2|metros?\s+quadrados?)/gi),
    areaTerrenoM2: area(/(?:[áa]rea\s+d[oe]\s+terreno|terreno\s+(?:medindo|com\s+[áa]rea))\s*(?:de\s+|:\s*)?(\d{1,3}(?:\.\d{3})*,\d{1,4}|\d{1,7}(?:,\d{1,4})?)\s*(?:m²|m2|metros?\s+quadrados?)/gi),
    numeroMatricula: (t.match(/matr[íi]cula\s*(?:n[ºo°.]?\s*)?[:.]?\s*(\d{1,3}(?:\.\d{3})+|\d{2,7})\b/i)?.[1] || '').replace(/\./g, '') || null,
  };
  return (out.areaPrivativaM2 || out.areaTotalM2 || out.areaTerrenoM2 || out.numeroMatricula) ? out : null;
}

/**
 * FORMA DE PAGAMENTO ESTRUTURADA (custo zero) — alimenta a projeção de fluxo de
 * caixa por modalidade. null em campo que o texto não afirma; nunca inventa.
 */
export function extrairPagamentoTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 40) return null;
  const pct = (re) => { const m = t.match(re); const v = m ? numBr(m[1]) : 0; return v > 0 && v <= 100 ? v : null; };
  const out = {
    aVista: /(?:pagamento|arremata[çc][ãa]o|lance)[^.;]{0,60}[àa]\s*vista|[àa]\s*vista[^.;]{0,40}(?:pagamento|arremata)/i.test(t) || null,
    parcelas: (() => { const m = t.match(/(?:em\s+at[ée]|parcelad[oa]\s+em|at[ée])\s+(\d{1,3})\s*(?:parcelas|vezes|x)\b/i); const n = m ? Number(m[1]) : 0; return n >= 2 && n <= 420 ? n : null; })(),
    sinalPct: pct(/(?:sinal|entrada)\s+(?:de\s+|m[íi]nim[oa]\s+de\s+)?(\d{1,2}(?:,\d{1,2})?)\s*%/i),
    caucaoPct: pct(/cau[çc][ãa]o\s+(?:de\s+)?(\d{1,2}(?:,\d{1,2})?)\s*%/i),
    comissaoPct: pct(/comiss[ãa]o\s+(?:do\s+leiloeiro\s+)?(?:de\s+|no\s+percentual\s+de\s+)?(\d{1,2}(?:,\d{1,2})?)\s*%/i),
    prazoDias: (() => { const m = t.match(/prazo\s+(?:de|para)\s+(?:pagamento|dep[óo]sito|quita[çc][ãa]o)[^.;]{0,30}?(\d{1,3})\s*(?:dias?|horas?)/i); if (!m) return null; const n = Number(m[1]); const horas = /horas?/i.test(m[0]); return n > 0 ? (horas ? Math.max(1, Math.round(n / 24)) : n) : null; })(),
    financiavel: /financiamento\s+(?:habitacional|banc[áa]rio|imobili[áa]rio)|aceita\s+financiamento|pode\s+ser\s+financiad/i.test(t) || null,
    fgts: /\bfgts\b/i.test(t) || null,
  };
  return Object.values(out).some((v) => v !== null) ? out : null;
}

// ── PRIOR POR LEILOEIRO × MODALIDADE (o agente que aprende) ──────────────────

/** Consenso aprendido: moda por campo, exigindo ≥2 amostras. null = sem consenso. */
export async function pagamentoPrior(fonte, modalidade) {
  if (!fonte) return null;
  try {
    const r = await sb(`leiloeiro_pagamento_prior?fonte=eq.${encodeURIComponent(fonte)}&modalidade=eq.${encodeURIComponent(modalidade || '')}&select=freq,amostras&limit=1`);
    if (!r.ok) return null;
    const [row] = await r.json();
    if (!row || Number(row.amostras) < 2) return null;
    const consenso = {};
    for (const [campo, votos] of Object.entries(row.freq || {})) {
      let melhor = null, n = 0;
      for (const [valor, cont] of Object.entries(votos || {})) if (cont > n) { n = cont; melhor = valor; }
      if (melhor === null || n < 2) continue;
      consenso[campo] = melhor === 'true' ? true : melhor === 'false' ? false : (Number.isFinite(Number(melhor)) ? Number(melhor) : melhor);
    }
    return Object.keys(consenso).length ? { ...consenso, amostras: Number(row.amostras) } : null;
  } catch { return null; }
}

/** Vota o padrão observado (read-modify-write; volume baixo). Best-effort. */
export async function pagamentoAprender(fonte, modalidade, regras) {
  if (!fonte || !regras) return;
  const votos = Object.entries(regras).filter(([, v]) => v !== null && v !== undefined);
  if (!votos.length) return;
  try {
    const r = await sb(`leiloeiro_pagamento_prior?fonte=eq.${encodeURIComponent(fonte)}&modalidade=eq.${encodeURIComponent(modalidade || '')}&select=freq,amostras&limit=1`);
    const [atual] = r.ok ? await r.json() : [];
    const freq = { ...(atual?.freq || {}) };
    for (const [campo, valor] of votos) {
      const chaveV = String(typeof valor === 'number' ? Math.round(valor * 100) / 100 : valor);
      freq[campo] = { ...(freq[campo] || {}) };
      freq[campo][chaveV] = (Number(freq[campo][chaveV]) || 0) + 1;
    }
    await sb('leiloeiro_pagamento_prior?on_conflict=fonte,modalidade', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ fonte, modalidade: modalidade || '', freq, amostras: (Number(atual?.amostras) || 0) + 1, atualizado_em: new Date().toISOString() }),
    });
  } catch { /* aprendizado nunca bloqueia */ }
}
