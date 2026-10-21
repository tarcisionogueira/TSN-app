/**
 * FONTE (config) — NORDESTE (nordesteleiloes.com.br). Fonte `dom` do Passo 2 com
 * enumeração em DOIS NÍVEIS: home → eventos /leiloes/<id>-<slug> → lotes
 * /lotes/<ev>-<seq>-<slug>. Next.js App Router (RSC, sem API de lote). Sem Cloudflare —
 * grátis no runner. Parser puro em lib/nordeste-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, urlCandidata,
} from '../../nordeste-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'nordeste',
  fetch: 'dom',
  dom: { esperaMs: 3500 },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  // 21/10: o EVENTO pagina (16 lotes por página, `?page=N` — medido no 217: page=2 traz 017–032).
  // Sem isto valia `maxPages: 1` também dentro do evento e só a 1ª página de cada um entrava.
  // O laço para sozinho na 1ª página sem lote novo.
  maxPagesEvento: 15,
  maxEventos: 15,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, urlCandidata },
  conhecimento: {
    plataforma: 'Next.js App Router (RSC; sem API de lote)', acesso: 'dom-puppeteer',
    custo: 'gratis', anti_bot: 'nenhum', enumeracao: '/ → /leiloes/<evento> (2 níveis, renderizado)',
    url_lote: '/lotes/<evento>-<seq>-<slug>', scraper: 'scraper-nordeste.mjs',
  },
};
