/**
 * FONTE (config) — BASTON LEILÕES (bastonleiloes.leilao.br). Triagem 22/10 (#292): HTML do servidor, via grátis.
 * Dois níveis com catálogo PAGINADO de leilões (`?page=` a partir de 0 → `paginaOffset: -1`, e os eventos vêm de
 * TODAS as páginas → `eventosEmTodasPaginas`): `/leiloes/imoveis` → leilão → `/leilao/<id>/lote/<n>/<slug>`.
 * Parser em lib/baston-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../baston-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'baston',
  fetch: 'fetch',
  catalogo: '/leiloes/imoveis',
  paginaParam: 'page',
  paginaOffset: -1,
  eventosEmTodasPaginas: true,
  maxPages: 8,
  maxPagesEvento: 1,
  maxEventos: 160,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Baston (ASP.NET, HTML do servidor)', acesso: 'fetch-direto (sem UA: IIS dá 400 a navegador)', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes/imoveis?page=N (0..) → leilão → /leilao/<id>/lote/<n>/<slug>', url_lote: '/leilao/<id>/lote/<n>/<slug>',
    scraper: 'scraper-baston.mjs',
  },
};
