/**
 * FONTE (config) — FLÁVIO GARCIA LEILÕES (flaviogarcia.lel.br, Porto Alegre/RS; Justiça Federal e Estadual). PHP próprio,
 * server-rendered, sem anti-bot → fetch direto, grátis. Home → leilões (`/leilao/<slug>/<id>`, nível 2) → lotes
 * (`/lote/<slug>/<id>`); o parser relê o evento (1× por evento) para selo, mínimo da 2ª praça e edital/matrícula.
 * Parser puro em lib/flaviogarcia-parse.mjs; teste em scripts/testes/flaviogarcia-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../flaviogarcia-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'flaviogarcia',
  fetch: 'fetch',
  catalogo: '/',
  maxPages: 1,
  maxEventos: 12,       // 30/10: 4 leilões abertos
  maxPagesEvento: 1,    // o evento lista todos os lotes numa página (5 no maior)
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (PHP + Bootstrap, gerenciador/arquivos), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home → /leilao/<slug>/<id> → /lote/<slug>/<id> (imóvel, veículo e bens juntos)',
    url_lote: '/lote/<slug>/<id>', scraper: 'scraper-flaviogarcia.mjs',
  },
};
