/**
 * FONTE (config) — MV LEILÕES (mvleiloes.com.br, RJ; Maicon Rodrigues Itaboray). WordPress + Elementor, server-rendered,
 * sem anti-bot → fetch direto, grátis. A home lista todos os imóveis (`/leilao_imoveis/<slug>/`, abertos e encerrados);
 * não há nível de evento. Parser puro em lib/mvleiloes-parse.mjs; teste em scripts/testes/mvleiloes-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../mvleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'mvleiloes',
  fetch: 'fetch',
  catalogo: '/',
  maxPages: 1,
  maxEventos: 0,
  maxPagesEvento: 1,
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'WordPress + Elementor (tipo leilao_imoveis fora da REST), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home → /leilao_imoveis/<slug>/',
    url_lote: '/leilao_imoveis/<slug>/', scraper: 'scraper-mvleiloes.mjs',
  },
};
