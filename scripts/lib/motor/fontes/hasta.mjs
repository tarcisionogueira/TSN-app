/**
 * FONTE (config) — HASTA (hastaleilao.com.br, Flávio Costa). Fonte `dom` do Passo 2: todo
 * /lote/ devolve o MESMO shell no HTML cru; o dado só existe renderizado.
 *
 * ⚠️ BLOQUEADA NO RUNNER (DRY-RUN 21/08): o site devolve **HTTP 403 a IP de datacenter**
 * (o recon de 20/08 só passou porque foi via Bright Data). Como o dado exige RENDER, nem o
 * BD cru resolve (devolve o shell). Destravar = runner RESIDENCIAL (mesma infra do
 * GESTAO_HEADLESS) ou BD com render JS. O parser está pronto e testado em mesa — é só fetch.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../hasta-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'hasta',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Vite SPA (agrega TRT-5/TJPE; shell único no HTML cru)', acesso: 'dom-puppeteer',
    custo: 'gratis', anti_bot: 'nenhum', enumeracao: '/ (home renderizada)',
    url_lote: '/lote/<ID>/<slug>', scraper: 'scraper-hasta.mjs',
  },
};
