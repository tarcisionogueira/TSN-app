/**
 * FONTE (config) — ALFA (alfaleiloes.com.br). Fonte `dom` do Passo 2: SPA sem SSR, sem
 * Cloudflare — renderiza GRÁTIS no runner. Catálogo de imóveis: /imoveis (a home mistura
 * veículos). Parser puro em lib/alfa-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../alfa-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'alfa',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/imoveis',
  paginaParam: 'pagina',
  maxPages: 2,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'SPA própria (sem SSR; dados só renderizados)', acesso: 'dom-puppeteer',
    custo: 'gratis', anti_bot: 'nenhum', enumeracao: '/imoveis (renderizado)',
    url_lote: '/lote/<ID>/<slug>', scraper: 'scraper-alfa.mjs',
  },
};
