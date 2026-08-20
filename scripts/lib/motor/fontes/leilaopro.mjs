/**
 * FONTE (config) — LeilãoPro Core (leffa/oscar). Só DADO: o par fetch × parse e os metadados.
 * O parser puro (lib/leilaopro-parse.mjs) é reusado sem cópia; o runner faz o resto.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leilaopro-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;   // { leffa, oscar } — o wrapper filtra por env

export default {
  chave: 'leilaopro',                 // proposito Bright Data + rótulo
  catalogo: '/leilao/lotes/imoveis',
  paginaParam: 'pagina',
  maxPages: 3,
  tenants: Object.values(TENANTS),    // default: todos os tenants conhecidos
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'LeilãoPro Core (artisticweb/leilaodetran SSR)', acesso: 'gratis+brightdata',
    custo: 'misto', anti_bot: 'cloudflare', enumeracao: '/leilao/lotes/imoveis',
    url_lote: '/leilao/<slug>/lote_id/<ID>', scraper: 'scraper-leilaopro.mjs',
  },
};
