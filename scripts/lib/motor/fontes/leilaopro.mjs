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
  // `page_a` (26/10): a listagem mostra 40 lotes de leilão por página e pagina por `?page_a=N` (o link "Próximo" do
  // próprio site). `?pagina=N` era ignorado e devolvia a pág. 1 de novo — o laço parava nela e quem tinha mais de 40
  // imóveis ficava cortado em 40 sem aviso: GRANDES 40 de 59, RAUPP 40 de 45, RENOVAR 40 de 47, SANTOSBORIN 40 de 51,
  // HASTAPUBLICALEL 40 de 76. Com `page_a`, o `temProxima` do runner também passa a enxergar o corte.
  paginaParam: 'page_a',
  maxPages: 3,
  tenants: Object.values(TENANTS),    // default: todos os tenants conhecidos
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'LeilãoPro Core (artisticweb/leilaodetran SSR)', acesso: 'gratis+brightdata',
    custo: 'misto', anti_bot: 'cloudflare', enumeracao: '/leilao/lotes/imoveis',
    url_lote: '/leilao/<slug>/lote_id/<ID>', scraper: 'scraper-leilaopro.mjs',
  },
};
