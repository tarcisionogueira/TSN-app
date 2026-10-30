/**
 * FONTE (config) — BENEDETTO LEILÕES (benedettoleiloes.com.br, Rolante/RS; TJRS e vendas diretas). Plataforma PowerWeb
 * (Laravel + Vue), server-rendered, sem anti-bot → fetch direto, grátis. `/leiloes?category_id=1` lista só imóveis,
 * numa página só (a paginação da plataforma está comentada). O lote traz tudo num JSON (`<status-leilao :config>`).
 * Parser puro em lib/benedetto-parse.mjs; teste em scripts/testes/benedetto-parse.mjs.
 */
import { TENANTS, CATALOGO, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../benedetto-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'benedetto',
  fetch: 'fetch',
  catalogo: CATALOGO,
  paginaParam: 'page',
  maxPages: 1,    // página única (30 lotes em 30/10, finalizados inclusos)
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'PowerWeb (Laravel + Vue), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes?category_id=1 (página única) → /lance/<id>; dados no JSON <status-leilao :config>',
    url_lote: '/lance/<id>', scraper: 'scraper-benedetto.mjs',
  },
};
