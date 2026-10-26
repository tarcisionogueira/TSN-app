/**
 * MOTOR `roisoft` (26/10) — transporte da plataforma Roisoft (lib/roisoft-parse.mjs). O catálogo de imóveis é um POST
 * de formulário (`/lotes/listar-imoveis-dados`, pagina=N) que devolve JSON com `total` e o HTML dos lotes, 20 por
 * página: este motor busca TODAS as páginas na 1ª chamada e devolve o HTML concatenado (a 2ª chamada do runner recebe
 * a mesma lista e o laço para). O lote é GET `/imoveis/lote/<id>`. Fetch puro do runner do GitHub (o banco leva 403):
 * nunca Bright Data, nunca Firecrawl. Página que não abre derruba a lista do tenant (nunca metade como se fosse tudo).
 *
 * `COBERTURA_ROISOFT`: por host, "total" que o site declara × lotes lidos — o coletor imprime a tabela no fim.
 */
import { lerCatalogo } from '../roisoft-parse.mjs';
import { decodificarHtml } from './fetch-fonte.mjs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const COBERTURA_ROISOFT = new Map();

async function buscar(url, form) {
  const headers = { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', Accept: form ? 'application/json, text/javascript, */*' : 'text/html,application/xhtml+xml' };
  if (form) { headers['Content-Type'] = 'application/x-www-form-urlencoded'; headers['X-Requested-With'] = 'XMLHttpRequest'; }
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const r = await fetch(url, { method: form ? 'POST' : 'GET', headers, body: form ? new URLSearchParams(form).toString() : undefined, signal: AbortSignal.timeout(30000) });
      const corpo = decodificarHtml(await r.arrayBuffer(), r.headers.get('content-type') || '');
      if (r.ok && corpo) return { corpo };
      if (r.status === 404) return { corpo: null, motivo: 'HTTP 404' };
      if (tentativa === 2) return { corpo: null, motivo: `HTTP ${r.status}` };
    } catch (e) {
      if (tentativa === 2) return { corpo: null, motivo: `rede: ${String(e?.name === 'TimeoutError' ? 'timeout 30s' : e?.cause?.code || e?.message || e).slice(0, 60)}` };
    }
    await sleep(1500);
  }
  return { corpo: null, motivo: 'sem resposta' };
}

export function criarMotorRoisoft() {
  const estado = { semCota: false };
  const cache = new Map();
  async function lerCatalogoInteiro(base) {
    const url = `${base}/lotes/listar-imoveis-dados`;
    const form = (p) => ({ pagina: String(p), LET_ID: '2', LED_DIA: '', LEILOES_ANTERIORES: '', comitente: '', onlyFilters: '0' });
    const r1 = await buscar(url, form(1));
    const c1 = r1.corpo && lerCatalogo(r1.corpo);
    if (!c1) return { html: null, via: `catálogo: ${r1.motivo || 'resposta não é o JSON da plataforma'}` };
    const partes = [c1.dados];
    const paginas = Math.min(Math.ceil(c1.total / (c1.porPagina || 20)) || 1, 40);
    for (let p = 2; p <= paginas; p++) {
      await sleep(400);
      const r = await buscar(url, form(p));
      const c = r.corpo && lerCatalogo(r.corpo);
      if (!c) return { html: null, via: `catálogo página ${p}/${paginas}: ${r.motivo || 'JSON inválido'}` };
      partes.push(c.dados);
    }
    const html = `<!-- roisoft-total: ${c1.total} -->\n${partes.join('\n<!-- roisoft: proxima pagina -->\n')}`;
    const lidos = new Set([...html.matchAll(/\bdata-rowid=["'](\d+)["']/g)].map((m) => m[1])).size;
    COBERTURA_ROISOFT.set(new URL(base).host, { total: c1.total, lidos, paginas });
    return { html, via: 'direto' };
  }
  async function fetchFonte(url) {
    let u; try { u = new URL(url); } catch { return { html: null, via: 'url inválida' }; }
    const base = `${u.protocol}//${u.host}`;
    if (/\/lotes\/listar-imoveis-dados$/i.test(u.pathname)) {
      if (!cache.has(base)) cache.set(base, await lerCatalogoInteiro(base));
      return cache.get(base);
    }
    const r = await buscar(url, null);
    return r.corpo ? { html: r.corpo, via: 'direto' } : { html: null, via: r.motivo };
  }
  return { fetchFonte, estado };
}

export function tabelaCoberturaRoisoft() {
  const linhas = ['domínio | total declarado (imóveis) | lotes enumerados | páginas | ok'];
  for (const [host, c] of COBERTURA_ROISOFT) linhas.push(`${host} | ${c.total} | ${c.lidos} | ${c.paginas} | ${c.total === 0 || c.lidos >= 0.9 * c.total ? 'ok' : `NÃO (${Math.round((100 * c.lidos) / c.total)}%)`}`);
  return linhas.join('\n');
}
