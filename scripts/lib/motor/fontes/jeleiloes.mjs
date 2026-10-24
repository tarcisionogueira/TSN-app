/**
 * FONTE (config) — JELEILOES (jeleiloes.com.br). Fonte `dom`: server-rendered, roda no
 * runner sem Cloudflare (recon 07/09, GitHub Actions). Catálogo de imóveis: /imoveis,
 * paginação `?page=N` (confirmado real: 9+ páginas, ~172 imóveis no total; 24/10: 10 páginas, 197). Parser puro em
 * lib/jeleiloes-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, extrairUrlsDeVeiculo, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../jeleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'jeleiloes',
  fetch: 'dom',
  // 07/09: 1ª tentativa (só delayAntesMs=5000) NÃO resolveu — a 2ª+ requisição da mesma
  // sessão continuou 403 mesmo com 5s de espaço. Não é rajada por TEMPO, é a SESSÃO sendo
  // marcada após a 1ª navegação. `isolarSessao` abre um BrowserContext novo por requisição
  // (cada uma volta a parecer "a primeira"); delayAntesMs baixo (1s) só por educação, não
  // é mais a defesa principal.
  dom: { esperaMs: 3000, delayAntesMs: 1000, isolarSessao: true },
  catalogo: '/imoveis',
  paginaParam: 'page',
  maxPages: 15,   // 24/10: 10 páginas era exatamente o catálogo inteiro (197 imóveis) — sem folga para crescer
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  // VEÍCULOS (21/10): /veiculos?page=N (JE 124, K Leilões ≥20 no site; 0 no acervo).
  veiculos: { catalogo: '/veiculos', paginaParam: 'page', maxPages: 10, extrairUrlsDeLote: extrairUrlsDeVeiculo },
  conhecimento: {
    plataforma: 'Suporte Leilões (infra) com front-end próprio — não é o template /buscador do SUEDPETER/LIDER',
    acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/imoveis?page=N (renderizado)',
    url_lote: '/oferta(s)/leilao/imoveis/<categoria>/<id>/(id-)?<id2>/<slug>',
    scraper: 'scraper-jeleiloes.mjs',
  },
};
