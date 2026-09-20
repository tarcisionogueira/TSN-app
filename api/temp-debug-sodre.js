// TEMPORÁRIO — por que SODRE (Honda CG 160 Cargo, leilão 29005) apurou 'indeterminado' com a
// página do leiloeiro mostrando "VENDIDO — R$ 9.000" claramente (21/09, achado do dono via
// print). Remove depois.
export const config = { runtime: 'nodejs', maxDuration: 60 };
import { isCronAuthorized } from './_auth.js';
import { fetchLote } from './enriquecer-lote.js';
import { apurarResultadoDoTexto } from './_resultado-leilao.js';

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  const url = String(req.query?.url || 'https://leilao.sodresantoro.com.br/leilao/29005/lote/2804970/');
  let html = '';
  try { ({ html } = await fetchLote(url, { proposito: 'geral' })); } catch { html = ''; } // padrao-ok: diagnóstico best-effort
  const achado = apurarResultadoDoTexto(html);
  const txt = String(html || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
  const trechos = {};
  for (const kw of ['vendid', 'VENDIDO', 'arrematad', '9.000', '9000', 'lance', 'status', 'situa']) {
    const i = txt.toLowerCase().indexOf(kw.toLowerCase());
    if (i >= 0) trechos[kw] = txt.slice(Math.max(0, i - 80), i + 120);
  }
  // Também procura no HTML CRU (antes de tirar as tags) — se "vendido" só existir dentro de um
  // atributo/JSON (ex.: data-status="vendido"), o texto limpo pode ter perdido a palavra.
  const idxCru = html.toLowerCase().indexOf('vendido');
  const trechoCru = idxCru >= 0 ? html.slice(Math.max(0, idxCru - 150), idxCru + 200) : null;

  // Procura dado ESTRUTURADO (Next.js __NEXT_DATA__, GraphQL embutido, etc.) — se o valor/
  // status do lote existir em JSON com outra codificação (status code, enum em inglês), o
  // texto "vendido" pode nunca aparecer mas o PREÇO/ID do lote sim.
  const marcadores = {};
  for (const kw of ['__NEXT_DATA__', '__NUXT__', '2804970', '9000', '9.000', 'winningBid', 'currentBid', '"status"', '"sold"', 'apolloState', 'application/json']) {
    const i = html.indexOf(kw);
    if (i >= 0) marcadores[kw] = html.slice(Math.max(0, i - 60), i + 200);
  }

  res.status(200).json({ ok: true, url, html_len: html.length, achado, trechos, trechoCru, marcadores, primeiros2000: txt.slice(0, 2000) });
}
