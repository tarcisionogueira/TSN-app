/**
 * FONTE (config) — SUPORTE "CLÁSSICO" (Symfony + jQuery, `/categoria/<Tipo>`; 26/10). Simões, VJ e Marco Aurélio —
 * cada um a SUA fonte (o sweep do motor é por `fonte`). O card da vitrine é o dado (`detalhesDoCatalogo`): o motor não
 * abre página de lote. Parser puro em lib/suporte-classico-parse.mjs.
 */
import * as P from '../../suporte-classico-parse.mjs';

export default {
  chave: 'suporteclassico',
  fetch: 'fetch',
  catalogo: '/categoria/Im%C3%B3veis',
  paginaParam: 'page',
  maxPages: 5,
  maxRefresh: 40,
  tenants: Object.values(P.TENANTS),
  parse: {
    extrairUrlsDeLote: P.extrairUrlsDeLote, totalDoCatalogo: (h) => P.totalDaCategoria(h, 'Im'), detalhesDoCatalogo: P.detalhesDoCatalogo, idDaUrl: P.idDaUrl,
    parseDetalhe: P.parseDetalhe, montarRow: P.montarRow, checarQualidade: P.checarQualidade,
  },
  conhecimento: {
    plataforma: 'Suporte Leilões — front clássico (Symfony, /build/*.js, SL_API api.suporteleiloes.com)',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/categoria/Imóveis (cards div.lote com praças e lance)', url_lote: '/lote/<id>/<slug> (não lida: o card basta)',
    scraper: 'scraper-suportenext.mjs',
  },
};
