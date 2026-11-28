/**
 * FONTE (config) — CRISTIANO ESCOLA LEILÕES (cristianoescolaleiloes.com.br, Caxias do Sul/RS; TJRS, TRT4, JF e vendas
 * diretas). 28/11: site refeito em Laravel + Inertia/Vue — os dados vêm em JSON embutido na página. Sem anti-bot →
 * fetch direto, grátis. Catálogo `/leiloes?page=N` (todas as categorias; a categoria do lote decide se é imóvel).
 * Parser puro em lib/cristianoescola-parse.mjs; teste em scripts/testes/cristianoescola-parse.mjs.
 */
import { TENANTS, CATALOGO, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../cristianoescola-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'cristianoescola',
  fetch: 'fetch',
  catalogo: CATALOGO,
  paginaParam: 'page',
  maxPages: 20,              // 15 páginas de 14 em 28/11; o laço para sozinho na página sem item novo
  eventosEmTodasPaginas: true, // eventos aparecem em qualquer página do catálogo
  maxEventos: 15,            // 10 em 28/11 (quase todos de bens móveis)
  maxPagesEvento: 1,         // `props.lots` vem inteiro na página do evento
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Laravel + Inertia/Vue (JSON em <script data-page="app">) — desde ~27/11; antes BF2/CodeIgniter',
    acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes?page=N (todas as categorias, kind lot|auction) → evento /leiloes/<slug> (props.lots) → lote',
    url_lote: '/leiloes/<slug>/lotes/<id>', scraper: 'scraper-cristianoescola.mjs',
  },
};
