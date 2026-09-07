/**
 * FONTE (config) — ALBERTOMACEDOLEILOES (albertomacedoleiloes.com.br). Fonte `dom`, sem
 * Cloudflare (recon 07/09). Sem catálogo de lotes separado — cada "leilão" na home é
 * potencialmente um lote (ou um pacote, ver observação em lib/albertomacedo-parse.mjs).
 * Parser puro em lib/albertomacedo-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../albertomacedo-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'albertomacedo',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ (home lista os leilões; sem catálogo de lotes separado)',
    url_lote: '/leilao/<slug>', scraper: 'scraper-albertomacedo.mjs',
  },
};
