/**
 * FONTE (config) — Emílio Matos (Superbid/MBV SSR). Fonte única (1 tenant). Reusa o parser puro
 * lib/emiliomatos-parse.mjs. montarRow(url, det) ignora o 3º arg (tenant) que o runner passa.
 */
import {
  FONTE, LEILOEIRO, BASE, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../emiliomatos-parse.mjs';

export default {
  chave: 'emiliomatos',
  catalogo: '/busca/segmento/imoveis',
  paginaParam: 'page',                // ⚠️ Superbid usa ?page= (não ?pagina=)
  maxPages: 15,
  tenants: [{ fonte: FONTE, leiloeiro: LEILOEIRO, base: BASE }],
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Superbid/MBV (white-label SSR)', acesso: 'gratis+brightdata', custo: 'misto',
    anti_bot: 'cloudflare', enumeracao: '/busca/segmento/imoveis?page=N',
    url_lote: '/imoveis/<tipo>/<slug>-<ID>', scraper: 'scraper-emiliomatos.mjs',
  },
};
