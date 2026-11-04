/**
 * FONTE (config) — KWARA (marketplace extrajudicial, vendedores empresa). Next.js sem anti-bot → fetch direto, grátis.
 * Parser puro em lib/kwara-parse.mjs; teste em scripts/testes/kwara-parse.mjs.
 */
import { TENANTS, CATEGORIA_IMOVEIS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../kwara-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'kwara',
  fetch: 'fetch',
  catalogo: `/busca?assetCategoryIds%5B%5D=${CATEGORIA_IMOVEIS}`,
  maxPages: 1,
  maxRefresh: 30,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Kwara (Next.js RSC, marketplace extrajudicial)', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/busca?assetCategoryIds[]=<imóveis> (24 cards, sem paginação)', url_lote: '/bens/<slug>-<id>', scraper: 'scraper-kwara.mjs',
  },
};
