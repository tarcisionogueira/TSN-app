/**
 * FONTE (config) — SUPORTE LEILÕES v2 (front Next.js novo da Suporte; pendência 296, 24/10). Hoje: o banco do
 * Marco Antônio Leiloeiro, que serve quatro vitrines (marcoantonio, rodrigoleiloeiro = Rodrigo Collyer, annaluiza,
 * dcm) — uma fonte só, MARCOANTONIO, com o leiloeiro de cada lote tirado do `leilao.sites` (lib/suportev2-parse.mjs).
 * Saíram de SUPORTE_TENANTS (scraper-puppeteer.mjs), cujo template antigo (`article.lote-main`) o site não tem mais.
 *
 * Catálogo `/leiloes-de/imoveis` (lista inteira numa página, sem paginação — 45 de 45 do sitemap em 24/10) + a
 * mesma página nas vitrines irmãs (nível 2: lote publicado só num irmão, ex. 11086, não aparece na do dono).
 * Detalhe `/lotes/<id>` (payload RSC). Sem Cloudflare challenge: fetch direto, banco de reserva, nunca Bright Data.
 */
import {
  TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../suportev2-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

const CAT_IMOVEIS = '/leiloes-de/imoveis';
const CAT_VEICULOS = '/leiloes-de/veiculos';

export default {
  chave: 'suportev2',
  fetch: 'fetch',
  catalogo: CAT_IMOVEIS,
  paginaParam: 'page',
  maxPages: 1,
  maxEventos: 8,
  maxPagesEvento: 1,
  // ~45 imóveis (24/10): a releitura cobre o acervo inteiro todo dia (~1,5 s/lote).
  maxRefresh: 80,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  // VEÍCULOS: /leiloes-de/veiculos (48 no dono + 1 só na vitrine da Anna Luiza, 24/10). A ficha (placa, chassi,
  // renavam) vem na descrição do lote; o tipo do bem decide o descarte em lib/veiculo-do-lote.mjs.
  veiculos: {
    catalogo: CAT_VEICULOS, maxPages: 1, extrairUrlsDeLote,
    // O complemento genérico lê o texto da PÁGINA, que aqui é casca de JS: a ficha já está na descrição.
    complemento: () => ({}),
  },
  conhecimento: {
    plataforma: 'Suporte Leilões v2 (Next.js App Router + api-v2.suporteleiloes.com.br) — um banco, 4 vitrines',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum (Cloudflare sem challenge)',
    enumeracao: '/leiloes-de/imoveis no dono + nas vitrines irmãs (nível 2)',
    url_lote: '/lotes/<id> (payload RSC initialLote)', scraper: 'scraper-suportev2.mjs',
  },
};
