/**
 * FONTE (config) — leilaobrasil.com.br / lutheroleiloes.com.br, 3º template da infra Suporte
 * Leilões (ver cabeçalho de lib/leilaobrasil-parse.mjs pra história completa e estrutura).
 * Fonte `fetch` simples (grátis primeiro): server-rendered, sem Cloudflare, sem bloqueio de IP
 * — confirmado em 5 rodadas de recon (19/09), plain fetch do GitHub Actions responde 200 em
 * toda rota. NÃO precisa de Puppeteer/dom nem Bright Data.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leilaobrasil-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leilaobrasil',
  fetch: 'fetch',
  // A HOME lista TODOS os anúncios ativos direto (~230 confirmados no recon, sem paginação
  // nem sitemap) — 1 fetch só. maxPages:1 evita qualquer tentativa de `?page=2` inútil.
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Suporte Leilões (3º template — /eventos/leilao/<id>/<slug>/lote, JSON embutido em <script>)',
    acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ lista os anúncios direto (sem paginação)',
    url_lote: '/eventos/leilao/<slug>/lote/<ID>/<slug>',
    scraper: 'scraper-leilaobrasil.mjs',
  },
};
