/**
 * FONTE (config) — FREITAS LEILOEIRO (freitasleiloeiro.com.br). Site próprio ASP.NET MVC, sem
 * Cloudflare. Catálogo de imóveis numa página só (`/Leiloes/Pesquisar?Categoria=2`); detalhe em
 * `/Leiloes/LoteDetalhes?leilaoId=<L>&loteNumero=<N>`. Parser puro em lib/freitas-parse.mjs.
 *
 * `fetch: 'fetch'` = via grátis (fetch direto) e, só se ela falhar, Bright Data. O wrapper
 * (scraper-freitas.mjs) roda SÓ na via grátis por padrão (FREITAS_BD=1 libera o pago): o
 * propósito `freitas` não tem sub-cota própria e cairia direto no teto global.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../freitas-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'freitas',
  // 30/09: 'dom' (Chromium). O servidor manda o certificado SEM a cadeia intermediária: o
  // navegador completa sozinho (o dono abre o site normal) e o fetch do Node recusa com
  // UNABLE_TO_VERIFY_LEAF_SIGNATURE — o banco também (SSL peer certificate not OK). Não é
  // bloqueio nem anti-robô (o site não tem): é o cliente HTTP que não busca o intermediário.
  fetch: 'dom',
  dom: { esperaMs: 1500 },
  catalogo: '/Leiloes/Pesquisar?Categoria=2',
  paginaParam: 'pagina',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (ASP.NET MVC)', acesso: 'dom-puppeteer (grátis; certificado sem cadeia intermediária)',
    custo: 'gratis', anti_bot: 'nenhum (sem Cloudflare)',
    enumeracao: '/Leiloes/Pesquisar?Categoria=2 (página única)',
    url_lote: '/Leiloes/LoteDetalhes?leilaoId=<L>&loteNumero=<N>',
    scraper: 'scraper-freitas.mjs',
  },
};
