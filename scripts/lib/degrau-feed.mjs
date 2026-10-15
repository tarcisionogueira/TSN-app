/**
 * FEED de anúncios da plataforma "Sua Plataforma de Leilão" (Degrau) — `/sitemap.xml` (15/10).
 *
 * Apesar do nome, não é sitemap: é um catálogo no formato do Meta (`<listings><listing>`), XML puro, sem
 * JavaScript, com TODOS os lotes já publicados. Cada `<listing>` traz `<name>`, `<url>` (…/lote/<slug>/<id>/)
 * e um `<available_dates_price_config>` POR PRAÇA, cada um com `<end_date>`. Medido em 15/10: FRANCO (226
 * lotes, 73 abertos), VIVA (44/43) e JINKINGS (18/16). Nesses sites a lista da página vem por AJAX, que não
 * completa no runner (FRANCO) — o feed resolve a enumeração.
 *
 * Regras:
 *  - aberto = a ÚLTIMA `end_date` do lote é hoje ou depois (a 1ª praça vencida com a 2ª aberta continua
 *    aberto). Sem nenhuma data o lote entra e o detalhe decide. Sem o filtro o motor reabriria o histórico
 *    todo dia (lote encerrado não é guardado e volta como "novo").
 *  - `descartar(slug, nome)` tira o que não é imóvel ANTES de abrir o detalhe (cada abertura pode custar
 *    crédito). `<property_type>` não serve para isso: vem `other` até para fazenda (JINKINGS).
 */
export function lotesDoFeed(xml, base, { hojeISO = new Date().toISOString().slice(0, 10), descartar } = {}) {
  const urls = new Map();
  for (const [, item] of String(xml || '').matchAll(/<listing>([\s\S]*?)<\/listing>/gi)) {
    const m = item.match(/<url>\s*([^<\s]*\/lote\/([^<\s/]+)\/(\d+)\/?)\s*<\/url>/i);
    if (!m) continue;
    const [, u, slug, id] = m;
    const fim = [...item.matchAll(/<end_date>\s*(\d{4}-\d{2}-\d{2})/gi)].map((x) => x[1]).sort().pop();
    if (fim && fim < hojeISO) continue;
    const nome = (item.match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || '';
    let slugTxt = slug;
    try { slugTxt = decodeURIComponent(slug); } catch { /* slug com % solto: usa cru */ }
    if (descartar && descartar(slugTxt, nome)) continue;
    try { urls.set(id, new URL(u, base).href); } catch { /* url malformada: ignora o lote */ }
  }
  return urls;
}

export const ehFeedDegrau = (txt) => /<listing>/i.test(String(txt || ''));
