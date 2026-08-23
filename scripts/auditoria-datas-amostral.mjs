#!/usr/bin/env node
/**
 * AUDITORIA AMOSTRAL DE DATAS — banco × página VIVA do leiloeiro (23/08/2026).
 *
 * Gatilho: relatório do Ed. Ville de Lyon (Feira de Santana, SUPERBID) saiu com a
 * data do leilão ~1 mês diferente da mostrada no site do leiloeiro. Dado errado
 * apresentado ao cliente é crítico — esta auditoria mede o TAMANHO do problema.
 *
 * O que faz: amostra 1 a cada 20 lotes ativos POR FONTE (determinístico, ordenado
 * por fonte_id), visita a url_lote com fetch simples (sem navegador) e procura as
 * datas do banco (data_leilao / data_leilao_2 / data_fim, ±1 dia) entre as datas
 * imprimíveis da página (dd/mm/aaaa e ISO — o JSON embutido de apps Next/Nuxt
 * conta). CEF/caixa ficam de fora: têm pipeline próprio de datas (puppeteer) e a
 * Caixa bloqueia runner rápido.
 *
 * HONESTIDADE DO VEREDITO (a pergunta de 10/08 — "este vazio é resposta?"):
 *  - página sem NENHUMA data plausível = PAGINA_SEM_DATA (site JS; INCONCLUSIVO,
 *    nunca "ok") — vai para o relatório como cobertura que este método não alcança;
 *  - erro HTTP/timeout = ERRO_HTTP (inconclusivo, contado à parte);
 *  - só é DIVERGENTE quando a página TEM datas plausíveis e a nossa não está lá.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcionais:
 *   AMOSTRA_PASSO (default 20) · FORCAR_IDS (ids separados por vírgula, sempre
 *   incluídos — ex.: o lote que motivou a auditoria).
 */

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const PASSO = Math.max(1, parseInt(process.env.AMOSTRA_PASSO || '20', 10));
const FORCAR = String(process.env.FORCAR_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

if (!SB || !KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function sbGet(caminho) {
  const r = await fetch(`${SB}/rest/v1/${caminho}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${caminho.slice(0, 120)}: ${(await r.text().catch(() => '')).slice(0, 160)}`);
  return r.json();
}

// ── 1) Acervo ativo (sem CEF), paginado ──────────────────────────────────────
async function carregarAcervo() {
  const linhas = [];
  const LOTE = 1000;
  for (let off = 0; ; off += LOTE) {
    const pag = await sbGet(
      `imoveis_leilao?select=id,fonte,fonte_id,url_lote,data_leilao,data_leilao_2,data_fim` +
      `&ativo=eq.true&url_lote=not.is.null&fonte=not.in.(CEF,caixa)` +
      `&order=fonte.asc,fonte_id.asc&limit=${LOTE}&offset=${off}`);
    linhas.push(...pag);
    if (pag.length < LOTE) break;
  }
  return linhas;
}

function amostrar(acervo) {
  const porFonte = new Map();
  for (const l of acervo) {
    if (!porFonte.has(l.fonte)) porFonte.set(l.fonte, []);
    porFonte.get(l.fonte).push(l);
  }
  const amostra = [];
  for (const [, lista] of porFonte) {
    for (let i = 0; i < lista.length; i += PASSO) amostra.push(lista[i]);
  }
  for (const id of FORCAR) {
    if (!amostra.some(l => String(l.id) === id)) {
      const l = acervo.find(x => String(x.id) === id);
      if (l) amostra.push(l);
    }
  }
  return amostra;
}

// ── 2) Datas imprimíveis de uma página ───────────────────────────────────────
// dd/mm/aaaa (e dd/mm/aa) + ISO aaaa-mm-dd (pega o JSON embutido de Next/Nuxt).
// Janela de plausibilidade: leilão anunciado vive entre ~60 dias atrás e ~400 à
// frente; fora disso é copyright, CPF, data de matrícula — ruído.
function datasDaPagina(html) {
  const hoje = Date.now();
  const min = hoje - 60 * 86400000, max = hoje + 400 * 86400000;
  const achadas = new Set();
  const põe = (y, mo, d) => {
    const t = Date.parse(`${y}-${mo}-${d}T12:00:00Z`);
    if (!isNaN(t) && t >= min && t <= max) achadas.add(`${y}-${mo}-${d}`);
  };
  let m;
  const br = /(\d{2})\/(\d{2})\/(\d{2,4})/g;
  while ((m = br.exec(html))) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    põe(y, m[2], m[1]);
  }
  const iso = /(\d{4})-(\d{2})-(\d{2})/g;
  while ((m = iso.exec(html))) põe(m[1], m[2], m[3]);
  return achadas;
}

const dataSó = (v) => (v ? String(v).slice(0, 10) : null);
const vizinhos = (ymd) => {
  const t = Date.parse(`${ymd}T12:00:00Z`);
  return [-1, 0, 1].map(d => new Date(t + d * 86400000).toISOString().slice(0, 10));
};

// ── 3) Visita e veredito ─────────────────────────────────────────────────────
async function verificar(lote) {
  const nossas = [...new Set([dataSó(lote.data_leilao), dataSó(lote.data_leilao_2), dataSó(lote.data_fim)].filter(Boolean))];
  if (!nossas.length) return { ...lote, veredito: 'SEM_DATA_NO_BANCO' };
  let html = '';
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20000);
    const r = await fetch(lote.url_lote, { headers: { 'User-Agent': UA, Accept: 'text/html,*/*' }, redirect: 'follow', signal: ctl.signal });
    clearTimeout(timer);
    if (!r.ok) return { ...lote, veredito: r.status === 404 || r.status === 410 ? 'LOTE_SUMIU' : 'ERRO_HTTP', http: r.status };
    html = await r.text();
  } catch (e) {
    return { ...lote, veredito: 'ERRO_HTTP', http: String(e?.name || e).slice(0, 40) };
  }
  const naPagina = datasDaPagina(html);
  if (!naPagina.size) return { ...lote, veredito: 'PAGINA_SEM_DATA' };
  // A 1ª praça (data_leilao) é a data que o cliente vê no card — é ela que precisa
  // bater. As demais entram como reforço: qualquer uma casando conta como OK
  // (leiloeiro costuma imprimir só a praça vigente).
  const bate = nossas.some(d => vizinhos(d).some(v => naPagina.has(v)));
  if (bate) return { ...lote, veredito: 'OK' };
  const futurasDaPagina = [...naPagina].filter(d => Date.parse(d) > Date.now() - 86400000).sort();
  return { ...lote, veredito: 'DIVERGENTE', nossas, pagina_futuras: futurasDaPagina.slice(0, 6) };
}

// ── 4) Execução: sequencial por host (educado), hosts em paralelo ────────────
async function main() {
  const acervo = await carregarAcervo();
  const amostra = amostrar(acervo);
  console.log(`[auditoria-datas] acervo=${acervo.length} amostra=${amostra.length} passo=${PASSO}`);

  const porHost = new Map();
  for (const l of amostra) {
    let host = 'invalido';
    try { host = new URL(l.url_lote).host; } catch { /* url quebrada conta como erro adiante */ }
    if (!porHost.has(host)) porHost.set(host, []);
    porHost.get(host).push(l);
  }

  const resultados = [];
  await Promise.all([...porHost.values()].map(async (fila) => {
    for (const lote of fila) {
      const r = await verificar(lote);
      resultados.push(r);
      if (r.veredito === 'DIVERGENTE' || r.veredito === 'LOTE_SUMIU') {
        console.log('ACHADO ' + JSON.stringify({ veredito: r.veredito, fonte: r.fonte, id: r.id, fonte_id: r.fonte_id, nossas: r.nossas, pagina: r.pagina_futuras, url: r.url_lote }));
      }
      await sleep(600);
    }
  }));

  const resumo = {};
  for (const r of resultados) {
    resumo[r.fonte] = resumo[r.fonte] || { amostra: 0, OK: 0, DIVERGENTE: 0, PAGINA_SEM_DATA: 0, ERRO_HTTP: 0, LOTE_SUMIU: 0, SEM_DATA_NO_BANCO: 0 };
    resumo[r.fonte].amostra++;
    resumo[r.fonte][r.veredito] = (resumo[r.fonte][r.veredito] || 0) + 1;
  }
  console.log('RESUMO ' + JSON.stringify(resumo, null, 0));
  const div = resultados.filter(r => r.veredito === 'DIVERGENTE').length;
  const inconc = resultados.filter(r => r.veredito === 'PAGINA_SEM_DATA' || r.veredito === 'ERRO_HTTP').length;
  console.log(`[auditoria-datas] FIM: ${resultados.length} verificados · ${div} divergentes · ${inconc} inconclusivos (JS/erro — este método não cobre)`);
}

main().catch(e => { console.error('[auditoria-datas] FALHOU:', e?.message || e); process.exit(1); });
