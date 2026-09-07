/**
 * FONTE (config) — SIMONLEILOES (simonleiloes.com.br). Fonte `dom`, sem Cloudflare (recon
 * 07/09). Catálogo confirmado real em /leiloes/imoveis ("62 oportunidades encontradas").
 * Paginação (`pagina`) é ponto de partida, não confirmada ao vivo. Parser puro em
 * lib/simon-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../simon-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'simon',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/leiloes/imoveis',
  paginaParam: 'pagina',
  maxPages: 5,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes/imoveis (confirmado real, 62 oportunidades; paginação a confirmar)',
    url_lote: '/lotes/<slug>', scraper: 'scraper-simon.mjs',
  },
};
