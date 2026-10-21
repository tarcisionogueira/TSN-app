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
  // 21/10: domínio novo (.com) — catálogo é /leiloes/ com `?page=N` (5 páginas; mistura veículo e
  // gado, que o filtro de não-imóvel do motor já descarta).
  catalogo: '/leiloes/',
  paginaParam: 'page',
  maxPages: 8,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'SPA própria (sem SSR; dados só renderizados)', acesso: 'dom-puppeteer',
    custo: 'gratis', anti_bot: 'nenhum', enumeracao: '/imoveis (renderizado)',
    url_lote: '/lote/<ID>/<slug>', scraper: 'scraper-alfa.mjs',
  },
};
