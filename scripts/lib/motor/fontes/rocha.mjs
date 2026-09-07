/**
 * FONTE (config) — ROCHALEILOES (rochaleiloes.com.br). Fonte `dom`, sem Cloudflare (recon
 * 07/09). Catálogo confirmado real em /imoveis?page=N (página 2 trouxe lotes diferentes da
 * 1ª). Parser puro em lib/rocha-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../rocha-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'rocha',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/imoveis',
  paginaParam: 'page',
  maxPages: 6,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/imoveis?page=N (confirmado real)',
    url_lote: '/lote/<ID>', scraper: 'scraper-rocha.mjs',
  },
};
