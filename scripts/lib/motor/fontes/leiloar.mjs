/**
 * FONTE (config) — PLATAFORMA LEILOAR (1º tenant: leiloesuberlandia.com.br). Enumeração em DOIS
 * NÍVEIS: home /externo/ → leilões /externo/leilao/<id> → lotes /externo/lote/<id>/<slug>.
 * HTML estático, sem Cloudflare neste tenant (recon 28/09 pelo servidor do banco — datacenter
 * respondeu 200 em todas as rotas). Grátis: o wrapper roda com `semBD` (nunca cai no pago).
 * Parser puro em lib/leiloar-parse.mjs; teste em scripts/testes/leiloar-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leiloar-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leiloar',
  fetch: 'fetch',
  catalogo: '/externo/',
  paginaParam: 'page',
  maxPages: 1,
  maxEventos: 25,
  maxPagesEvento: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Plataforma Leiloar (CakePHP, HTML estático)', acesso: 'fetch-direto', custo: 'gratis',
    anti_bot: 'nenhum (neste tenant; crleiloes, mesma plataforma, tem Cloudflare)',
    enumeracao: '/externo/ → /externo/leilao/<id> (2 níveis)', url_lote: '/externo/lote/<id>/<slug>',
    scraper: 'scraper-leiloar.mjs',
  },
};
