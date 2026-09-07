/**
 * FONTE (config) — LEJE (leje.com.br). Fonte `dom`, plataforma própria em PHP antigo, sem
 * Cloudflare (recon 07/09). Catálogo é a HOME ("/") — todo outro path testado devolveu a
 * mesma home byte a byte. Parser puro em lib/leje-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leje-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leje',
  fetch: 'dom',
  dom: { esperaMs: 4000 },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (PHP antigo, URL por query string)', acesso: 'dom-puppeteer',
    custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ (home — todo outro path testado é a mesma home)',
    url_lote: '/index.php?acao=evento&cod=<leilaoId>&lote=<loteId>',
    scraper: 'scraper-leje.mjs',
  },
};
