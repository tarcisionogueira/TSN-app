/**
 * FONTE (config) — família "leilao/index" (RIGOLONLEILOES, GIORDANOLEILOES, THAISTEIXEIRA).
 * Fonte `dom`: server-rendered, sem Cloudflare (recon 07/09). Catálogo é a HOME ("/") — NÃO
 * `/leilao/index/imoveis`. Esse path era só um LINK DE MENU visto na home do Rigolon; nunca foi
 * de fato aberto/testado no recon. A 1ª rodada real (07/09) confirmou o engano: os 3 tenants
 * enumeraram 0 lotes em `/leilao/index/imoveis` — enquanto os lotes reais que o recon achou
 * (Rigolon `leilao_id/98206/lote/211554`, Giordano com 6 links diretos) vieram TODOS da HOME
 * ("/"), nunca dessa página. Corrigido para `catalogo: '/'`. THAISTEIXEIRA pode continuar
 * enumerando 0 mesmo assim (a home dela não mostrou lote nenhum no recon original) — tratado
 * como fonteVazia, não erro.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leilaoindex-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leilaoindex',
  fetch: 'dom',
  dom: { esperaMs: 3000 },
  catalogo: '/',
  paginaParam: 'pagina',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Plataforma "leilao/index" (vendor compartilhado — mesmo bucket S3 em Rigolon/Giordano/Thaisteixeira)',
    acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ (home — confirmado real; /leilao/index/imoveis testado e vazio nos 3 tenants)',
    url_lote: '/leilao/index/leilao_id/<id>/lote/<id2>',
    scraper: 'scraper-leilaoindex.mjs',
  },
};
