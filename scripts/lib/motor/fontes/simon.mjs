/**
 * FONTE (config) — SIMONLEILOES (simonleiloes.com.br). Fonte `dom`, sem Cloudflare (recon
 * 07/09). Catálogo confirmado real em /leiloes/imoveis ("62 oportunidades encontradas").
 * Paginação (`pagina`) é ponto de partida, não confirmada ao vivo. Parser puro em
 * lib/simon-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../simon-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'simon',
  fetch: 'dom',
  // 30/10: o site ficou lento e o `networkidle2` passou a estourar os 45 s também em /leiloes/imoveis
  // (imagens que não param). Sem mídia, DOM pronto e espera do 1º link de lote (só no catálogo).
  dom: { esperaMs: 3000, bloquearMidia: true, waitUntil: 'domcontentloaded', timeoutMs: 60000,
    esperarSeletor: (url) => (/\/lotes\//.test(url) ? null : 'a[href*="/lotes/"]') },
  catalogo: '/leiloes/imoveis',
  // 21/10: `pagina` era ignorado (o site devolve a pág. 1) e o laço parava em 12 — enumerados = 12
  // em 29 de 29 rodadas, com 48 imóveis no site. O parâmetro real é `page` (medido: page=2 traz
  // outros 12). 4 páginas hoje; teto 6 de folga.
  paginaParam: 'page',
  maxPages: 6,
  tenants: Object.values(TENANTS),
  // VEÍCULOS (21/10): /leiloes/veiculos, mesma paginação (51 no site, 0 no acervo).
  // 30/10: o catálogo de veículos "não abriu" em 29/10 (52 → 0) pelo mesmo `networkidle2` — herda o `dom` acima.
  veiculos: { catalogo: '/leiloes/veiculos', paginaParam: 'page', maxPages: 8 },
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes/imoveis (confirmado real, 62 oportunidades; paginação a confirmar)',
    url_lote: '/lotes/<slug>', scraper: 'scraper-simon.mjs',
  },
};
