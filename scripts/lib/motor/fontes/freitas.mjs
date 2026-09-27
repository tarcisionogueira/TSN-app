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
  fetch: 'fetch',
  catalogo: '/Leiloes/Pesquisar?Categoria=2',
  paginaParam: 'pagina',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (ASP.NET MVC)', acesso: 'fetch direto (grátis)',
    custo: 'gratis', anti_bot: 'nenhum (sem Cloudflare)',
    enumeracao: '/Leiloes/Pesquisar?Categoria=2 (página única)',
    url_lote: '/Leiloes/LoteDetalhes?leilaoId=<L>&loteNumero=<N>',
    scraper: 'scraper-freitas.mjs',
  },
};
