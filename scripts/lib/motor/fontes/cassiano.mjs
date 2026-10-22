/**
 * FONTE (config) — GLENER BRASIL CASSIANO (leiloesbrasilcassiano.com.br). Triagem 22/10 (#292): Django, HTML do
 * servidor, via grátis. Dois níveis: home → `/leiloes/leilao/<slug>/` → `/leiloes/lote/<slug>/`. Leilões mistos
 * da Justiça do Trabalho: o motor descarta o que não é imóvel. Parser em lib/cassiano-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../cassiano-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'cassiano',
  fetch: 'fetch',
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  maxPagesEvento: 1,
  maxEventos: 30,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'smartweb (Django, HTML do servidor)', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home → /leiloes/leilao/<slug>/ → /leiloes/lote/<slug>/', url_lote: '/leiloes/lote/<slug>/', scraper: 'scraper-cassiano.mjs',
  },
};
