/**
 * FONTE (config) — WR LEILÕES (wrleiloes.com.br; Wesley Silva Ramos, Boa Vista/RR + Manaus/Macapá/Rio Branco). Plataforma
 * própria (PHP + jQuery), server-rendered, sem anti-bot → fetch direto, grátis. Sem catálogo por categoria: a agenda
 * lista os leilões abertos, o leilão lista os lotes (20 por página, `?page=N`) e o card de veículo sai antes de abrir.
 * Parser puro em lib/wrleiloes-parse.mjs; teste em scripts/testes/wrleiloes-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../wrleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'wrleiloes',
  fetch: 'fetch',
  catalogo: '/agenda-de-leiloes',
  paginaParam: 'page',
  maxPages: 1,           // a agenda é uma página só
  maxPagesEvento: 8,     // 30/10: TRT11 com 25 lotes em 2 páginas; o laço para na 1ª página sem lote novo
  maxRefresh: 30,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (PHP + jQuery), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/agenda-de-leiloes → /leilao/<id>/<slug>?page=N (card de veículo filtrado) → /lote/<id>/<slug>; data e situação do leilão',
    url_lote: '/lote/<id>/<slug>', scraper: 'scraper-wrleiloes.mjs',
  },
};
