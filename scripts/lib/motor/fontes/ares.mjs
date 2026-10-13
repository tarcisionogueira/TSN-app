/**
 * FONTE (config) — plataforma ARES (white-label sobre Supabase): Picelli + Shiokawa. Parser em
 * lib/ares-parse.mjs. Motor `api` (fetch-api.mjs): o catálogo é UMA consulta PostgREST com o
 * cabeçalho `apikey` público de cada site; o det sai pronto do catálogo, sem abrir página.
 * Custo Bright Data ZERO (a API não tem Cloudflare; o site do Picelli tem, mas não é usado).
 */
import { TENANTS, CATALOGO, extrairUrlsDeLote, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../ares-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'ares',
  fetch: 'api',
  catalogo: CATALOGO,
  paginaParam: 'offset', // não usado: maxPages 1 e limit=1000 na consulta (Picelli tem ~160 lotes vivos)
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Ares (Agência Ares) — Supabase/PostgREST por leiloeiro, api.<domínio>/rest/v1',
    acesso: 'api-publica', custo: 'gratis', anti_bot: 'cloudflare no site (API livre)',
    enumeracao: 'lots?select=…&status=in.(aberto,futuro) — catálogo completo numa chamada',
    url_lote: '/lote/<uuid>',
    scraper: 'scraper-ares.mjs',
  },
};
