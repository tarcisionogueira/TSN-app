/**
 * FONTE (config) — plataforma TRIACCA (RS): Lara Forster Leilões e Alexsandro Leilões. PHP server-rendered, sem anti-bot
 * → fetch direto, grátis. A home lista todos os bens (imóvel, veículo, máquina); o não-imóvel sai pelo texto.
 * Parser puro em lib/triacca-parse.mjs; teste em scripts/testes/triacca-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../triacca-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'triacca',
  fetch: 'fetch',
  catalogo: '/',
  maxPages: 1,
  maxRefresh: 20,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'TRIACCA Design Digital (PHP), server-rendered, charset misto', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home → leilao-virtual/<slug> (todos os bens)', url_lote: '/leilao-virtual/<slug>', scraper: 'scraper-triacca.mjs',
  },
};
