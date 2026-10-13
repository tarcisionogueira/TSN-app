/**
 * FONTE (config) — e-leiloes.com.br (= e-leiloeiro.com.br = e-confianca.com.br), infra Suporte
 * Leilões com front-end Nuxt 3 (4º template). Parser em lib/eleiloes-parse.mjs.
 * Fetch direto (sem Cloudflare, robots Allow /), custo Bright Data ZERO — recon de 13/10 via pg_net.
 * Enumeração pela LISTA da categoria Imóveis (15 ativos em 13/10, 12 por página), não pelo
 * sitemap (20 mil URLs com histórico — o "≈191" do 1º recon era um `total` qualquer, forma nº 10).
 */
import { TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../eleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'eleiloes',
  fetch: 'fetch',
  catalogo: '/leilao/imoveis',
  paginaParam: 'page',
  maxPages: 10, // 12/página: cobre até 120 imóveis; o laço para sozinho na 1ª página sem lote novo
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Suporte Leilões (4º template — Nuxt 3, __NUXT_DATA__ em devalue)',
    acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leilao/imoveis?page=N (12/pág) → data["leilao-categoria-imoveis--{}"].results',
    url_lote: '/eventos/leilao/<slug>/lote/<ID>/<slug>',
    scraper: 'scraper-eleiloes.mjs',
  },
};
