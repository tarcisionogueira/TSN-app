/**
 * FONTE (config) — família "Sua Plataforma de Leilão" (Degrau), tema MGL: Fernando, Jonas e Lucas
 * Leiloeiro (MG). Cloudflare barra runner, Web Unlocker e proxy ISP (07-16/09); o Firecrawl passa
 * (10/10, HTTP 200, 1 crédito/página). Página montada por JS → `waitFor` de 7 s (sem ele o lance
 * vem como template e o parser devolve null). Parser puro em lib/mgl-parse.mjs.
 * Custo medido: ~25 lotes por site no catálogo, ~10 imóveis somando os 3 (o slug descarta veículo
 * e bens antes de abrir) → ~13 créditos por rodada. Roda SEMANAL (dono, 10/10: "se consome
 * créditos, 1x por semana") em scraper-firecrawl-semanal.yml.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../mgl-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'mgl',
  fetch: 'firecrawl',
  firecrawl: { waitFor: 7000, timeoutMs: 90000 },
  catalogo: '/busca/#Engine=Start&ID_Categoria=2',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Sua Plataforma de Leilão (Degrau) — tema MGL', acesso: 'firecrawl',
    custo: 'firecrawl (1 crédito/página)', anti_bot: 'cloudflare (403 ao runner/Unlocker/ISP)',
    enumeracao: '/busca/#Engine=Start&ID_Categoria=2 (uma página, ~25 lotes)',
    url_lote: '/lote/<slug>/<id>/',
    scraper: 'scraper-mgl.mjs',
  },
};
