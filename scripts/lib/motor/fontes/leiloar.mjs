/**
 * FONTE (config) — PLATAFORMA LEILOAR (1º tenant: leiloesuberlandia.com.br). Enumeração em DOIS
 * NÍVEIS: home /externo/ → leilões /externo/leilao/<id> → lotes /externo/lote/<id>/<slug>.
 * HTML estático, sem Cloudflare neste tenant (recon 28/09 pelo servidor do banco — datacenter
 * respondeu 200 em todas as rotas). Grátis: o wrapper roda com `semBD` (nunca cai no pago).
 * Parser puro em lib/leiloar-parse.mjs; teste em scripts/testes/leiloar-parse.mjs.
 *
 * 25/10 (#356): + os tenants do 2º template (Bootstrap "responsivo") — Nasar (CE; 28 imóveis de venda direta
 * da Porto Seguro em 9 cidades), Rodrigo (DF), Marques Barreto (DF), Lucas Ignacio e Moacira (DF, na RAIZ do
 * domínio: `catalogo: '/'`) — e o IPC (MS, 1º template com endereço no LOCAL). Todos grátis, sem Bright Data.
 * Fora (recon 24-25/10): brasilialeiloes (só leilão de TESTE), curiau (só veículos — UNIFAP), salgueiro (home sem
 * leilão) e tenorio (só veículos/DETRAN; leilão 894 "em elaboração").
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leiloar-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leiloar',
  fetch: 'fetch',
  catalogo: '/externo/',
  paginaParam: 'page',
  maxPages: 1,
  maxEventos: 25,
  // ~60 imóveis somando os 7 tenants (25/10): a releitura cobre o acervo todo dia.
  maxRefresh: 80,
  maxPagesEvento: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Plataforma Leiloar (CakePHP, HTML estático) — 2 templates: l-cabecalho e Bootstrap responsivo', acesso: 'fetch-direto', custo: 'gratis',
    anti_bot: 'nenhum (neste tenant; crleiloes, mesma plataforma, tem Cloudflare)',
    enumeracao: '/externo/ (ou / na raiz) → leilao/<id> (2 níveis); teste/simulador fora', url_lote: '[/externo]/lote/<id>/<slug-com-cidade>',
    scraper: 'scraper-leiloar.mjs',
  },
};
