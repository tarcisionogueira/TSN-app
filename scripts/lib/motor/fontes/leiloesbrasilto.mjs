/**
 * FONTE (config) — LEILÕES BRASIL TOCANTINS (leiloesbrasilto.com.br, Palmas/TO; Antônio Carlos Volpi Santana). Plataforma
 * própria antiga (PHP, popups), server-rendered, sem anti-bot → fetch direto, grátis. `/imoveis` lista uma linha por
 * imóvel mas linka o LEILÃO; o leilão lista os bens (`javascript:bem(<id>)`) por categoria. Parser puro em
 * lib/leiloesbrasilto-parse.mjs; teste em scripts/testes/leiloesbrasilto-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../leiloesbrasilto-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leiloesbrasilto',
  fetch: 'fetch',
  catalogo: '/imoveis',
  paginaParam: 'page',   // `/imoveis` não pagina (30/10: 1 linha); o laço para na 1ª página sem lote novo
  maxPages: 1,
  maxPagesEvento: 1,     // o leilão lista todos os bens numa página só
  maxRefresh: 20,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria antiga (PHP, popups window.open), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/imoveis → /leilao/<id> (bens da categoria Imóveis: javascript:bem(<id>)) → popup /bem/<id> + /bem_galeria/<id>',
    url_lote: '/leilao/<id>#bem-<idBem>', scraper: 'scraper-leiloesbrasilto.mjs',
  },
};
