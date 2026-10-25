/**
 * FONTE (config) — PLATAFORMA LEILOVIA (ASP.NET; pendência 356, 25/10): Casa de Leilões e RP Leilões (MS).
 * Três níveis: home → /leilao/<slug>/<id> → /lote/lote-NNN/<slug>/<id>. Parser em lib/leilovia-parse.mjs.
 * Motor `fetch` SEM Bright Data (semBD no wrapper): o IIS dá 400 ao cabeçalho de navegador e 200 sem cabeçalho —
 * o fetch direto e a via banco já tentam a forma "pelada" depois do 400 (fetch-fonte.mjs, #292).
 */
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../leilovia-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leilovia',
  fetch: 'fetch',
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  // Casa de Leilões: ~15 leilões abertos (25/10), metade de veículo — os de veículo/sucata/DETRAN nem entram.
  maxEventos: 30,
  maxPagesEvento: 1,
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Leilovia (ASP.NET WebForms)', acesso: 'fetch-direto sem cabeçalho (IIS 400 a UA de navegador) + banco (pelada)',
    custo: 'gratis', anti_bot: 'nenhum (só o 400 de cabeçalho)',
    enumeracao: 'home → /leilao/<slug>/<id> (sem veículo/sucata/simulador) → /lote/lote-NNN/<slug>/<id>',
    url_lote: '/lote/lote-NNN/<slug>/<id>', scraper: 'scraper-leilovia.mjs',
  },
};
