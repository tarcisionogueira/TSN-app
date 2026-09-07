/**
 * FONTE (config) — JELEILOES (jeleiloes.com.br). Fonte `dom`: server-rendered, roda no
 * runner sem Cloudflare (recon 07/09, GitHub Actions). Catálogo de imóveis: /imoveis,
 * paginação `?page=N` (confirmado real: 9+ páginas, ~172 imóveis no total). Parser puro em
 * lib/jeleiloes-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../jeleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'jeleiloes',
  fetch: 'dom',
  // delayAntesMs 5000: recon real (07/09) confirmou a página 1 dando 200 e a 2ª+ requisição
  // da MESMA sessão, poucos segundos depois, dando 403 — rate-limit por rajada da infra
  // Suporte Leilões (não IP de datacenter: todo recon isolado, 1 request por job, deu 200).
  dom: { esperaMs: 3000, delayAntesMs: 5000 },
  catalogo: '/imoveis',
  paginaParam: 'page',
  maxPages: 10,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Suporte Leilões (infra) com front-end próprio — não é o template /buscador do SUEDPETER/LIDER',
    acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/imoveis?page=N (renderizado)',
    url_lote: '/oferta(s)/leilao/imoveis/<categoria>/<id>/(id-)?<id2>/<slug>',
    scraper: 'scraper-jeleiloes.mjs',
  },
};
