/**
 * FONTE (config) — FRANCOLEILOES (francoleiloes.com.br). Fonte `dom`, Cloudflare por SESSÃO
 * (não por IP — recon 17/09, mesma assinatura já resolvida em JELEILOES e
 * ALBERTOMACEDOLEILOES). A HOME lista os lotes direto (`/lote/<leilao-slug>/<id>/`, 48 reais
 * confirmados), sem catálogo separado. Parser puro em lib/francoleiloes-parse.mjs.
 *
 * `isolarSessao`: confirmado necessário e suficiente — 1ª navegação (HOME) sempre passa limpo,
 * 2ª+ na MESMA sessão batia "Performing security verification". Com contexto novo por página,
 * o DETALHE também passou limpo (dado real: R$6.046.287,22, matrícula, 6 PDFs).
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../francoleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'francoleiloes',
  fetch: 'dom',
  dom: { esperaMs: 3500, isolarSessao: true },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'cloudflare (por sessão, isolarSessao resolve)',
    enumeracao: '/ (home lista os lotes direto, sem catálogo separado)',
    url_lote: '/lote/<leilao-slug>/<id>/', scraper: 'scraper-francoleiloes.mjs',
  },
};
