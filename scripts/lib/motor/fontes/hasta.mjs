/**
 * FONTE (config) — HASTA (hastaleilao.com.br, Flávio Costa). Fonte `dom` do Passo 2: todo
 * /lote/ devolve o MESMO shell no HTML cru; o dado só existe renderizado. Sem Cloudflare —
 * grátis no runner. Parser puro em lib/hasta-parse.mjs.
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
