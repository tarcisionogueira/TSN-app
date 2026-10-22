/**
 * FONTE (config) — plataforma ARES (white-label sobre Supabase): Picelli + Shiokawa. Parser em
 * lib/ares-parse.mjs. Motor `api` (fetch-api.mjs): o catálogo é UMA consulta PostgREST com o
 * cabeçalho `apikey` público de cada site; o det sai pronto do catálogo, sem abrir página.
 * Custo Bright Data ZERO (a API não tem Cloudflare; o site do Picelli tem, mas não é usado).
 */
import { TENANTS, CATALOGO, extrairUrlsDeLote, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade, apurarAusentes, extrairUrlsDeVeiculo, detalhesDoCatalogoVeiculo } from '../../ares-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'ares',
  fetch: 'api',
  catalogo: CATALOGO,
  paginaParam: 'offset', // não usado: maxPages 1 e limit=1000 na consulta (Picelli tem ~160 lotes vivos)
  paginarPostgrest: true, // 22/10: Savoy passa de 1.000 — o motor API pede as páginas seguintes (offset)
  maxPages: 1,
  tenants: Object.values(TENANTS),
  // VEÍCULOS (21/10): mesma consulta, categoria `veiculos`; o det sai do catálogo (o site tem Cloudflare).
  veiculos: { catalogo: CATALOGO, maxPages: 1, listaCompleta: true, extrairUrlsDeLote: extrairUrlsDeVeiculo, detalhesDoCatalogo: detalhesDoCatalogoVeiculo },
  parse: { extrairUrlsDeLote, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  apurarAusentes, // lote vencido sem resultado → desfecho lido na própria API (20/10)
  conhecimento: {
    plataforma: 'Ares (Agência Ares) — Supabase/PostgREST por leiloeiro, api.<domínio>/rest/v1',
    acesso: 'api-publica', custo: 'gratis', anti_bot: 'cloudflare no site (API livre)',
    enumeracao: 'lots?select=…&status=in.(aberto,futuro) — catálogo completo numa chamada',
    url_lote: '/lote/<uuid>',
    scraper: 'scraper-ares.mjs',
  },
};
