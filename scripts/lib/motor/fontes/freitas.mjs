/**
 * FONTE (config) — FREITAS LEILOEIRO (freitasleiloeiro.com.br). Site próprio ASP.NET MVC, sem
 * Cloudflare. Catálogo de imóveis pelo ajax `/Leiloes/PesquisarLotes` (TopRows=200; a página só traz 12); detalhe em
 * `/Leiloes/LoteDetalhes?leilaoId=<L>&loteNumero=<N>`. Parser puro em lib/freitas-parse.mjs.
 *
 * `fetch: 'fetch'` = via grátis (fetch direto) e, só se ela falhar, Bright Data. O wrapper
 * (scraper-freitas.mjs) roda SÓ na via grátis por padrão (FREITAS_BD=1 libera o pago): o
 * propósito `freitas` não tem sub-cota própria e cairia direto no teto global.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, complementoVeiculo,
} from '../../freitas-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'freitas',
  // 30/09: 'dom' (Chromium). O servidor manda o certificado SEM a cadeia intermediária: o
  // navegador completa sozinho (o dono abre o site normal) e o fetch do Node recusa com
  // UNABLE_TO_VERIFY_LEAF_SIGNATURE — o banco também (SSL peer certificate not OK). Não é
  // bloqueio nem anti-robô (o site não tem): é o cliente HTTP que não busca o intermediário.
  fetch: 'dom',
  dom: { esperaMs: 1500 },
  // 21/10: `/Leiloes/Pesquisar?Categoria=2` traz só os 12 primeiros no HTML; o resto chega por
  // rolagem infinita (ajax `/Leiloes/PesquisarLotes`, 12 por vez). O navegador não rola, então
  // `enumerados` foi 12 em toda rodada contra ~130 no site — 6 leilões inteiros nunca entraram
  // (8099 Bradesco, 8113, 8127, 8129…). Mesmo endpoint do site, `TopRows=200`: tudo numa chamada.
  catalogo: '/Leiloes/PesquisarLotes?Categoria=2&ClienteSclId=0&PageNumber=1&TopRows=200',
  paginaParam: 'pagina',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  // VEÍCULOS (21/10): mesmo ajax, Categoria=1 (~736 no site, 0 no acervo). Lido por
  // scraper-veiculos-motor.mjs com o mesmo parser; a conversão é lib/veiculo-do-lote.mjs.
  veiculos: { catalogo: '/Leiloes/PesquisarLotes?Categoria=1&ClienteSclId=0&PageNumber=1&TopRows=2000', maxPages: 1, listaCompleta: true, complemento: complementoVeiculo },
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (ASP.NET MVC)', acesso: 'dom-puppeteer (grátis; certificado sem cadeia intermediária)',
    custo: 'gratis', anti_bot: 'nenhum (sem Cloudflare)',
    enumeracao: '/Leiloes/PesquisarLotes?Categoria=2&TopRows=200 (ajax do catálogo, chamada única)',
    url_lote: '/Leiloes/LoteDetalhes?leilaoId=<L>&loteNumero=<N>',
    scraper: 'scraper-freitas.mjs',
  },
};
