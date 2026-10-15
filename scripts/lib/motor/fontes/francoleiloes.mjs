/**
 * FONTE (config) — FRANCOLEILOES (francoleiloes.com.br). Fonte `dom`, Cloudflare por SESSÃO
 * (não por IP — recon 17/09, mesma assinatura já resolvida em JELEILOES e
 * ALBERTOMACEDOLEILOES). A HOME lista os lotes direto (`/lote/<leilao-slug>/<id>/`, 48 reais
 * confirmados), sem catálogo separado. Parser puro em lib/francoleiloes-parse.mjs.
 *
 * `isolarSessao`: confirmado necessário e suficiente — 1ª navegação (HOME) sempre passa limpo,
 * 2ª+ na MESMA sessão batia "Performing security verification". Com contexto novo por página,
 * o DETALHE também passou limpo (dado real: R$6.046.287,22, matrícula, 6 PDFs).
 *
 * 15/10: a home deixou de trazer os lotes no HTML (14/10: 200, 0 lotes, só o template jquery-tmpl
 * `${row.URLlote}` — recon_dump `vazio:FRANCOLEILOES`). É a plataforma Degrau, que monta a lista
 * por AJAX e redireciona a home para /proximos_leiloes/1/1/ (Firecrawl, 15/10: 8 lotes ali). Mesma
 * receita da família MGL/Jinkings: catálogo direto nessa página e 7 s de hidratação.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../francoleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'francoleiloes',
  fetch: 'dom',
  dom: { esperaMs: 7000, isolarSessao: true },
  catalogo: '/proximos_leiloes/1/1/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'cloudflare (por sessão, isolarSessao resolve)',
    enumeracao: '/proximos_leiloes/1/1/ (lista montada por AJAX — esperar 7 s)',
    url_lote: '/lote/<leilao-slug>/<id>/', scraper: 'scraper-francoleiloes.mjs',
  },
};
