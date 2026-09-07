/**
 * FONTE (config) — família "leilao/index" (RIGOLONLEILOES, GIORDANOLEILOES, THAISTEIXEIRA).
 * Fonte `dom`: server-rendered, sem Cloudflare (recon 07/09). Catálogo em
 * /leilao/index/imoveis; paginação NÃO confirmada ao vivo ainda (Giordano mostrou "1 de 3" na
 * UI, mas o parâmetro real da query string não foi visto no recon) — `paginaParam: 'pagina'`
 * é a convenção mais comum nesta base e serve de ponto de partida; ajustar depois de uma
 * rodada real mostrar se a página 2 traz lotes DIFERENTES da página 1.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leilaoindex-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leilaoindex',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/leilao/index/imoveis',
  paginaParam: 'pagina',
  maxPages: 3,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Plataforma "leilao/index" (vendor compartilhado — mesmo bucket S3 em Rigolon/Giordano/Thaisteixeira)',
    acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leilao/index/imoveis (paginação a confirmar)',
    url_lote: '/leilao/index/leilao_id/<id>/lote/<id2>',
    scraper: 'scraper-leilaoindex.mjs',
  },
};
