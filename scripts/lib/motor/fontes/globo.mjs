/**
 * FONTE (config) — GLOBOLEILOES (globoleiloes.com.br). Fonte `dom`, sem Cloudflare (recon
 * 07/09). Catálogo confirmado na HOME (27 <article> com URL de lote completa já na 1ª
 * carga) — paginação da home não confirmada ao vivo, por isso `maxPages: 1` (conservador;
 * ajustar se um dry-run mostrar mais páginas reais). Parser puro em lib/globo-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../globo-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'globo',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ (home, confirmado real; paginação a confirmar)',
    url_lote: '/leiloes/lote-<n>-<slug>/<ID>', scraper: 'scraper-globo.mjs',
  },
};
