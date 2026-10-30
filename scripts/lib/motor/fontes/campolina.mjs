/**
 * FONTE (config) — LUIZ CAMPOLINA LEILÕES (luizcampolina.com.br, Sete Lagoas/MG; TRT3). WordPress + WooCommerce: o
 * catálogo é a Store API pública em JSON (categoria `imoveis`) e já traz o detalhe de cada lote — nenhuma página de
 * lote é aberta. Fetch direto, grátis. Parser puro em lib/campolina-parse.mjs; teste em scripts/testes/campolina-parse.mjs.
 */
import { TENANTS, CATALOGO, extrairUrlsDeLote, extrairUrlsDeEvento, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../campolina-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'campolina',
  fetch: 'fetch',
  catalogo: CATALOGO,
  paginaParam: 'page',
  maxPages: 1,          // per_page=100 cobre a categoria inteira (5 em 30/10)
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'WordPress + WooCommerce (produto tipo auction)', acesso: 'fetch-direto (Store API JSON)', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/wp-json/wc/store/v1/products?category=imoveis&per_page=100 (detalhe no próprio JSON)',
    url_lote: '/produto/<slug>/', scraper: 'scraper-campolina.mjs',
  },
};
