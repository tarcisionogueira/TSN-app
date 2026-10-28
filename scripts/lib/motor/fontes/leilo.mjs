/**
 * FONTE (config) — LEILO (leilo.com.br, Goiânia/GO). Triagem da junta 28/10. SSR com o estado do app embutido
 * (`window.__INITIAL_STATE__`), sem Cloudflare → motor `fetch` grátis. Dois níveis: o catálogo é a VENDA DIRETA de
 * imóveis (paginada por `pagina=`) e os eventos são os leilões abertos do mesmo estado (/leilao/?leilao.nome=…), de
 * onde só os lotes de tipo "Imoveis" entram. Parser em lib/leilo-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leilo-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leilo',
  fetch: 'fetch',
  catalogo: '/imoveis/venda-direta/',
  paginaParam: 'pagina',
  maxPages: 4,
  // 25 leilões abertos em 28/10 (a maioria de veículos, 0 lote de imóvel): todos são lidos, porque o leilão de imóvel
  // nem sempre se diz de imóvel no nome. Página do leilão traz 36 lotes; o "Fecha Mês" tem 167 (5 páginas).
  maxEventos: 40,
  maxPagesEvento: 5,
  eventosEmTodasPaginas: false,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Leilo (Vue/Quasar SSR, estado em window.__INITIAL_STATE__)', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/imoveis/venda-direta/?pagina=N + leilões abertos (/leilao/?leilao.nome=…), lote tipo "Imoveis"',
    url_lote: '/lote/<uuid>/', scraper: 'scraper-leilo.mjs',
  },
};
