/**
 * FONTE (config) — PAULO BOTELHO LEILOEIRO (paulobotelholeiloeiro.com.br, RJ; TRT1 e extrajudiciais). Plataforma própria
 * (Laravel, "@lstonon"), server-rendered, sem anti-bot → fetch direto, grátis. `/lotes/imoveis` já lista só lotes de
 * imóvel (12 por página). Parser puro em lib/botelho-parse.mjs; teste em scripts/testes/botelho-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../botelho-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'botelho',
  fetch: 'fetch',
  catalogo: '/lotes/imoveis',
  paginaParam: 'page',
  maxPages: 10,   // 30/10: 66 lotes em 6 páginas
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (Laravel, @lstonon), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/lotes/imoveis?page=N → /leiloes/<slug-do-leilão>/<id>',
    url_lote: '/leiloes/<slug>/<id>', scraper: 'scraper-botelho.mjs',
  },
};
