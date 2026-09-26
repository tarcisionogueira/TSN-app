/**
 * FONTE (config) — LEJE (leje.com.br). Fonte `dom`, plataforma própria em PHP antigo, sem
 * Cloudflare (recon 07/09). Catálogo é a HOME ("/") — todo outro path testado devolveu a
 * mesma home byte a byte. Parser puro em lib/leje-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leje-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leje',
  fetch: 'dom',
  // `usarProxyIsp` (26/09): desde 24/09 o site devolve HTTP 403 ao IP do runner do GitHub
  // (datacenter) — reputação de IP, mesmo quadro do HASTA resolvido assim em 19/09. Proxy ISP é
  // custo fixo por IP; sem as env BRIGHTDATA_ISP_* cai para o IP da máquina (runner residencial).
  dom: { esperaMs: 4000, usarProxyIsp: true },
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (PHP antigo, URL por query string)', acesso: 'dom-puppeteer',
    custo: 'proxy_isp (fixo)', anti_bot: 'bloqueio de IP de datacenter (403, desde 24/09)',
    enumeracao: '/ (home — todo outro path testado é a mesma home)',
    url_lote: '/index.php?acao=evento&cod=<leilaoId>&lote=<loteId>',
    scraper: 'scraper-leje.mjs',
  },
};
