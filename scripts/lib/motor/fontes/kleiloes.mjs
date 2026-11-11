/**
 * FONTE (config) — KLÖCKNER LEILÕES (kleiloes.com.br; pendência 468, 11/11). Front Next.js próprio sobre o backend da
 * Suporte Leilões desde 09/11 (antes era tenant do JELEILOES, no template antigo). Server-rendered, sem anti-bot:
 * fetch direto, grátis. Catálogo `/lotes?categoria=Imóveis&page=N` (24 por página; 67 imóveis em 3 páginas em 11/11);
 * detalhe `/lote/<id>-<slug>` lido do payload RSC. Parser puro em lib/kleiloes-parse.mjs; teste em
 * scripts/testes/kleiloes-parse.mjs.
 */
import {
  TENANTS, CAT_IMOVEIS, CAT_VEICULOS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../kleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'kleiloes',
  fetch: 'fetch',
  catalogo: CAT_IMOVEIS,
  paginaParam: 'page',
  maxPages: 8,       // 3 páginas em 11/11; folga para crescer (o laço para na 1ª página sem lote novo)
  maxRefresh: 80,    // ~67 imóveis: a releitura cobre o acervo inteiro todo dia
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  // VEÍCULOS: mesma vitrine com a categoria Veículos (44 em 2 páginas em 11/11). A ficha (placa, chassi, renavam)
  // vem na descrição do lote, que é o que lib/veiculo-do-lote.mjs lê.
  veiculos: { catalogo: CAT_VEICULOS, paginaParam: 'page', maxPages: 6, extrairUrlsDeLote, complemento: () => ({}) },
  conhecimento: {
    plataforma: 'Next.js próprio (classes kl-l-*) sobre o backend da Suporte Leilões (static.suporteleiloes.com.br/kleiloescombr)',
    acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/lotes?categoria=Imóveis&page=N e /lotes?categoria=Veículos&page=N (server-rendered, 24 por página)',
    url_lote: '/lote/<id>-<slug> (payload RSC: painel com linhas de praça, fichas kl-l-spec, kl-l-doc)',
    scraper: 'scraper-kleiloes.mjs',
  },
};
