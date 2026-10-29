/**
 * FONTE (config) — LUCIAN LEILÕES (lucianleiloes.com.br, RS). Home lista os lotes de todas as categorias; o parser fica
 * só com a categoria 6 (Imóveis). Nível 2: a agenda de cada pregão futuro (`/agenda/leiloes/data/<data>/1`), que traz
 * lotes que a home às vezes não mostra. Server-rendered, sem anti-bot → fetch direto, grátis.
 * Parser puro em lib/lucian-parse.mjs; teste em scripts/testes/lucian-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../lucian-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'lucian',
  fetch: 'fetch',
  catalogo: '/',
  maxPages: 1,
  maxEventos: 12,
  maxPagesEvento: 1,
  maxRefresh: 60,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'própria (Bootstrap 5 + jQuery), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home + /agenda/leiloes/data/<data>/1 → categoria/6/imoveis/leilao/<id>/<slug>',
    url_lote: '/categoria/6/<cat>/leilao/<id>/<slug>', scraper: 'scraper-lucian.mjs',
  },
};
