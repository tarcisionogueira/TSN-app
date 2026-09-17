/**
 * FONTE (config) — ALBERTOMACEDOLEILOES (albertomacedoleiloes.com.br). Fonte `dom`, Cloudflare
 * por SESSÃO (não por IP — recon 07/09 e 17/09, ver `isolarSessao` abaixo). A home lista os
 * "leilões" (`/leilao/<slug>`); NÍVEL 2 (`extrairUrlsDeEvento`) revisita cada um pra achar
 * `/lote/<n>-<slug>` dentro — é como um pacote de vários imóveis expõe os itens de verdade
 * (achado 17/09: dono reportou lote que nunca aparecia — o scraper só olhava `/leilao/`, e
 * pacote multi-imóvel não tem valor único nessa página, então `checarQualidade` descartava
 * o pacote inteiro sem nunca visitar os `/lote/` filhos). Parser puro em
 * lib/albertomacedo-parse.mjs.
 *
 * `isolarSessao` (07/09): a 1ª rodada real enumerou os 12 leilões certinho na home, mas TODOS
 * os 12 fetches de detalhe voltaram HTTP 403 — a mesma assinatura de rate-limit POR SESSÃO já
 * vista e resolvida na JELEILOES (1ª navegação da sessão sempre passa, a 2ª+ apanha). Mesma
 * causa provável (WAF/CDN por sessão, não por IP), mesmo remédio: BrowserContext incógnito
 * novo por requisição. Reconfirmado 17/09 com Puppeteer real: 1ª navegação (o lote em si)
 * passou 200 batendo direto; a 2ª (home, mesma sessão) bateu Cloudflare challenge — com
 * contexto isolado por página as duas passam.
 */
import {
  TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade,
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
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'cloudflare (por sessão, isolarSessao resolve)',
    enumeracao: '/ (home lista /leilao/<slug>; nível 2 abre cada um e acha /lote/<n>-<slug> quando é pacote)',
    url_lote: '/leilao/<slug> (single) ou /lote/<n>-<slug> (item dentro de pacote)', scraper: 'scraper-albertomacedo.mjs',
  },
};
