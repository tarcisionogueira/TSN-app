/**
 * FONTE (config) — PARQUE DOS LEILÕES (parquedosleiloes.com.br, Brasília/DF; família Braggio). Plataforma BRClick
 * (Laravel), server-rendered, sem anti-bot → fetch direto, grátis. Duas listas no site (extrajudiciais e judiciais), cada
 * uma com o filtro de LOTES de imóvel (`is_lot=1&type_id=3`) — duas fontes do mesmo leiloeiro (`catalogo` por tenant).
 * Parser puro em lib/parquedosleiloes-parse.mjs; teste em scripts/testes/parquedosleiloes-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../parquedosleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'parquedosleiloes',
  fetch: 'fetch',
  catalogo: '/leiloes?is_lot=1&type_id=3', // cada tenant traz o seu
  paginaParam: 'page',
  // 12 lotes por página, mais novos primeiro; os abertos cabem na 1ª (30/10: 2 judiciais abertos, 18 páginas de histórico).
  maxPages: 2,
  maxRefresh: 24,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'BRClick (Laravel), server-rendered; lote com JSON auctionLot', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes e /leiloes-judiciais com is_lot=1&type_id=3 → /leilao/<evento>/lote/<id>',
    url_lote: '/leilao/<evento>/lote/<id>', scraper: 'scraper-parquedosleiloes.mjs',
  },
};
