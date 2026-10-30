/**
 * FONTE (config) — D1 LANCE LEILÕES (d1lance.com.br, leiloeiro José Roberto Neves Amorim; SP/MT, TJSP/TJRJ e bancos).
 * Plataforma própria (Laravel + Livewire), server-rendered com o estado dos componentes em `wire:initial-data`, sem
 * anti-bot → fetch direto, grátis. `/navegar-pelo-mapa?tipo_filtro=imoveis` lista TODOS os imóveis numa página só
 * (115 em 30/10; `?page` é ignorado). Parser puro em lib/d1lance-parse.mjs; teste em scripts/testes/d1lance-parse.mjs.
 */
import { TENANTS, CATALOGO, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, totalDoCatalogo } from '../../d1lance-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'd1lance',
  fetch: 'fetch',
  catalogo: CATALOGO,
  paginaParam: 'page',
  maxPages: 1,    // catálogo inteiro numa página (Livewire `lastPage: 1`); o totalDoCatalogo acusa se isso mudar
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  // Sem `extrairUrlsDeEvento`: com ele o motor não confere o `totalDoCatalogo` (nível de evento não existe aqui).
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, totalDoCatalogo },
  conhecimento: {
    plataforma: 'Própria (Laravel + Livewire), server-rendered', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/navegar-pelo-mapa?tipo_filtro=imoveis (página única) → /lote/<bairro-cidadeuf>/<id>; detalhe no componente Livewire `sidebar`',
    url_lote: '/lote/<slug>/<id>', scraper: 'scraper-d1lance.mjs',
  },
};
