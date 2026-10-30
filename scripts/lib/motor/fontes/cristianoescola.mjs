/**
 * FONTE (config) — CRISTIANO ESCOLA LEILÕES (cristianoescolaleiloes.com.br, Caxias do Sul/RS; TJRS, TRT4, JF e vendas
 * diretas). Plataforma BF2 Tecnologia (CodeIgniter), server-rendered, sem anti-bot → fetch direto, grátis.
 * `/categoria/imoveis` lista todos os imóveis numa página só; o card traz as duas praças, a página do lote o valor.
 * Parser puro em lib/cristianoescola-parse.mjs; teste em scripts/testes/cristianoescola-parse.mjs.
 */
import { TENANTS, CATALOGO, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../cristianoescola-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'cristianoescola',
  fetch: 'fetch',
  catalogo: CATALOGO,
  paginaParam: 'page',
  maxPages: 1,    // página única (50 lotes em 30/10; conferido contra /lotes/pagina/1…15)
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'BF2 Tecnologia (CodeIgniter), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/categoria/imoveis (página única; card com 1ª e 2ª praça) → /ver-lote/<id>_<SLUG>',
    url_lote: '/ver-lote/<id>_<SLUG>', scraper: 'scraper-cristianoescola.mjs',
  },
};
