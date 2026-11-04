/**
 * FONTE (config) — MARCUS VINÍCIUS LEILÕES (Montes Claros/MG, Brain at Work). Server-rendered sem anti-bot → fetch
 * direto, grátis. Home lista os LEILÕES (nível 2); cada leilão lista os lotes `item/<id>/…`. Parser puro em
 * lib/marcusvinicius-parse.mjs; teste em scripts/testes/marcusvinicius-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../marcusvinicius-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'marcusvinicius',
  fetch: 'fetch',
  catalogo: '/',
  maxPages: 1,           // a home não pagina (17 leilões em 04/11)
  maxPagesEvento: 1,     // o leilão lista os lotes numa página só
  maxEventos: 40,
  maxRefresh: 20,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Brain at Work (PHP), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ (cards de leilão, filtro de imóvel pelo data-busca) → /leilao/<id>/<slug> → /item/<id>/lote-NN/<slug>',
    url_lote: '/item/<id>/lote-NN/<slug>', scraper: 'scraper-marcusvinicius.mjs',
  },
};
