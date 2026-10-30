/**
 * FONTE (config) — família "leilao/index" (RIGOLONLEILOES, GIORDANOLEILOES, THAISTEIXEIRA).
 * Fonte `dom`: server-rendered, sem Cloudflare (recon 07/09). Catálogo é a HOME ("/") — NÃO
 * `/leilao/index/imoveis`. Esse path era só um LINK DE MENU visto na home do Rigolon; nunca foi
 * de fato aberto/testado no recon. A 1ª rodada real (07/09) confirmou o engano: os 3 tenants
 * enumeraram 0 lotes em `/leilao/index/imoveis` — enquanto os lotes reais que o recon achou
 * (Rigolon `leilao_id/98206/lote/211554`, Giordano com 6 links diretos) vieram TODOS da HOME
 * ("/"), nunca dessa página. Corrigido para `catalogo: '/'`. THAISTEIXEIRA pode continuar
 * enumerando 0 mesmo assim (a home dela não mostrou lote nenhum no recon original) — tratado
 * como fonteVazia, não erro.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leilaoindex-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leilaoindex',
  fetch: 'dom',
  // 30/10: a home monta os cards por JS; espera o 1º link de lote (só no catálogo — a página do lote
  // não tem esse link e esperaria à toa). Em 29/10 os 3 s fixos pegaram "Carregando…" no Giordano.
  dom: { esperaMs: 3000, esperarSeletor: (url) => (/\/leilao\/index\/leilao_id\//.test(url) ? null : 'a[href*="/leilao/index/leilao_id/"]') },
  catalogo: '/',
  // 21/10: a home pagina por `?pg=N` (Giordano: 3 páginas, a 3ª com 34 cards) — com `pagina` e
  // teto 1 só a 1ª entrava (Giordano ~55 imóveis no site × 17 aqui; Rigolon 5; Thais 9). O laço
  // do motor para na 1ª página sem lote novo, então o teto 6 é folga, não custo.
  paginaParam: 'pg',
  maxPages: 6,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Plataforma "leilao/index" (vendor compartilhado — mesmo bucket S3 em Rigolon/Giordano/Thaisteixeira)',
    acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/ (home — confirmado real; /leilao/index/imoveis testado e vazio nos 3 tenants)',
    url_lote: '/leilao/index/leilao_id/<id>/lote/<id2>',
    scraper: 'scraper-leilaoindex.mjs',
  },
};
