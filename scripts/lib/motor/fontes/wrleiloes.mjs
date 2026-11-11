/**
 * FONTE (config) — WR LEILÕES (wrleiloes.com.br; Wesley Silva Ramos, Boa Vista/RR + Manaus/Macapá/Rio Branco).
 * Pendência 469 (11/11): o site PHP server-rendered virou um app React que monta tudo no navegador — o HTML cru vem
 * sem leilão nenhum. Agora é fonte `dom` (Chromium renderiza; grátis, roda no GitHub Actions como ALFA/HASTA).
 * `/leiloes` lista os leilões abertos → `/leiloes/<uuid>` lista os lotes (o motor clica "Carregar mais" até o fim) →
 * `/lotes/<uuid>`. Parser puro em lib/wrleiloes-parse.mjs; teste em scripts/testes/wrleiloes-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../wrleiloes-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'wrleiloes',
  fetch: 'dom',
  dom: {
    esperaMs: 2500,
    // O app pinta a lista depois do 1º carregamento: espera o card (`h3`) ou o título do lote (`h1`).
    esperarSeletor: (url) => (/\/lotes\//.test(url) ? 'h1' : 'h3'),
    carregarMais: { texto: 'Carregar mais', max: 15 },   // 12 lotes por carga; 15 cliques = 192 lotes por leilão
  },
  catalogo: '/leiloes',
  paginaParam: 'page',
  maxPages: 1,           // a lista de leilões é uma página só
  maxEventos: 15,        // 8 abertos em 11/11 (DETRAN fica de fora no parser)
  maxPagesEvento: 1,     // a lista do leilão cresce por clique, não por página
  maxRefresh: 30,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'App React (Vite) renderizado no navegador; fotos e editais em wrleiloes.s3.sa-east-1.amazonaws.com',
    acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/leiloes (abertos, antes de "Leilões anteriores") → /leiloes/<uuid> (botão "Carregar mais") → /lotes/<uuid>; edital e local na página do leilão',
    url_lote: '/lotes/<uuid>', scraper: 'scraper-wrleiloes.mjs',
  },
};
