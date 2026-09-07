/**
 * FONTE (config) — ALBERTOMACEDOLEILOES (albertomacedoleiloes.com.br). Fonte `dom`, sem
 * Cloudflare (recon 07/09). Sem catálogo de lotes separado — cada "leilão" na home é
 * potencialmente um lote (ou um pacote, ver observação em lib/albertomacedo-parse.mjs).
 * Parser puro em lib/albertomacedo-parse.mjs.
 *
 * `isolarSessao` (07/09): a 1ª rodada real enumerou os 12 leilões certinho na home, mas TODOS
 * os 12 fetches de detalhe voltaram HTTP 403 — a mesma assinatura de rate-limit POR SESSÃO já
 * vista e resolvida na JELEILOES (1ª navegação da sessão sempre passa, a 2ª+ apanha). Mesma
 * causa provável (WAF/CDN por sessão, não por IP), mesmo remédio: BrowserContext incógnito
 * novo por requisição.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../albertomacedo-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'albertomacedo',
  fetch: 'dom',
  dom: { esperaMs: 3000, isolarSessao: true },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ (home lista os leilões; sem catálogo de lotes separado)',
    url_lote: '/leilao/<slug>', scraper: 'scraper-albertomacedo.mjs',
  },
};
