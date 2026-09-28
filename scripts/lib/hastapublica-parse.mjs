/**
 * Parser puro — HASTAPÚBLICA, página ESTÁTICA do leilão (`/leilao/<id>`).
 *
 * Por que esta página (28/09): o coletor lia só o `innerText` do Auditório (`/leilao/painel/<id>`),
 * que é montado por socket.io — nunca viu uma <img>, e 126 de 126 lotes saíam sem foto. A página
 * `/leilao/<id>` vem pronta do servidor (medido pelo servidor do banco: 100 de 100 leilões ativos,
 * 129 cartões) e cada cartão amarra NÚMERO do lote + foto + link do lote no mesmo bloco — a foto é
 * do lote pelo HTML, não por posição ou adivinhação.
 *
 * Também traz o LEILOEIRO de verdade ("Leiloeiro: Euclides Maraschi Junior"). O coletor gravava
 * em `leiloeiro` o "Comitente:" do painel — a vara, o banco, e às vezes a data da praça junto.
 *
 * Fixtures reais: scripts/testes/fixtures/hastapublica-leilao-*.html.
 */

// Só a foto enviada ao CDN do site (hash de 32 hex). O cartão sem foto usa
// `util/img/nopicfull.png`, e o cabeçalho do leilão traz o logo do tribunal (`medium-TJSP.png`)
// — nenhum dos dois pode virar capa do imóvel.
const RE_FOTO_REAL = /^https:\/\/s3-sa-east-1\.amazonaws\.com\/cdnhp\/content\/[0-9a-f]{32}\.(?:jpe?g|png|webp)$/i;

const limpar = (s) => String(s || '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

export function parseLeilaoHasta(html) {
  const h = String(html || '');
  const leiloeiro = limpar((h.match(/<strong>\s*Leiloeir[oa]:\s*<\/strong>\s*([^<]+)/i) || [])[1]) || null;
  const lotes = new Map();
  for (const card of h.split('class="card card-leilao"').slice(1)) {
    const num = (card.match(/<dt>\s*Lote\s*<\/dt>\s*<dd>\s*(\d+)\s*<\/dd>/i) || [])[1];
    if (!num || lotes.has(num)) continue;
    // Recorta o bloco da imagem: sem o recorte, um cartão sem <img> pegaria a do seguinte.
    const bloco = (card.split(/class="imgLoteSmall"/i)[1] || '').split(/class="card-body"/i)[0];
    const src = (bloco.match(/<img[^>]*\ssrc="([^"]+)"/i) || [])[1] || '';
    const href = (bloco.match(/href="(https?:\/\/[^"]*\/lote\/\d+\/[^"]*)"/i) || [])[1] || null;
    lotes.set(num, { foto: RE_FOTO_REAL.test(src) ? src : null, urlLote: href });
  }
  return { leiloeiro, lotes };
}
