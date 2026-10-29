/**
 * FONTE (config) — ALLIANCE LEILÕES (allianceleiloes.com.br, SP). Dois níveis: home (cards de leilão — só os com praça
 * futura ou venda direta sem data viram evento) → `leiloes/<id>-<slug>` → `lotes/<id>-<nº>-<slug>`. Server-rendered,
 * sem anti-bot → fetch direto, grátis. Parser puro em lib/alliance-parse.mjs; teste em scripts/testes/alliance-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../alliance-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'alliance',
  fetch: 'fetch',
  catalogo: '/',
  maxPages: 1,
  maxEventos: 40,
  maxPagesEvento: 1,
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'própria (Bootstrap 4 + jQuery), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home (cards; o rótulo "Futuro" não vale — filtra pela data) → leiloes/<id>-<slug> → lotes/<id>-<nº>-<slug>',
    url_lote: '/lotes/<id>-<nº>-<slug>', scraper: 'scraper-alliance.mjs',
  },
};
