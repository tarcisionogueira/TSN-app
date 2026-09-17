/**
 * FONTE (config) — GLOBOLEILOES (globoleiloes.com.br). Fonte `dom`.
 *
 * ⚠️ 17/09 — o site ganhou Cloudflare desde o recon de 07/09 ("sem Cloudflare"), em cima da
 * migração pra SPA Inertia.js já documentada em globo-parse.mjs. Confirmado via IP
 * RESIDENCIAL (dump real): a home não é mais catálogo (é menu/categorias); o catálogo real
 * é `/leiloes` — mesmo padrão de URL de lote de sempre (`/leiloes/lote-<n>-<slug>/<id>`).
 * Bright Data Web Unlocker testado e confirmado insuficiente (desafio intacto mesmo com
 * corpo de resposta grande) — só passa de IP residencial, mesmo remédio de RJ/GESTAO/PECINI/
 * HASTA (`scripts/runner-residencial.sh`). Rodar `node scripts/scraper-globo.mjs` da CI
 * continua bloqueado; do residencial deve funcionar sem mudança nenhuma no motor (`dom` já é
 * Puppeteer puro, sem Bright Data — só a origem do IP importa aqui).
 *
 * `timeoutMs` alto (herdado de 07/09): página pesada, muito rastreador/analytics — 90s dá
 * folga sem custar nada (dom é grátis, o preço é só tempo de execução).
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../globo-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'globo',
  fetch: 'dom',
  dom: { esperaMs: 6000, timeoutMs: 90000 },
  catalogo: '/leiloes',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (Inertia.js) — atrás de Cloudflare desde ~09/09, só passa de IP residencial',
    acesso: 'dom-puppeteer (residencial obrigatório)', custo: 'gratis', anti_bot: 'cloudflare',
    enumeracao: '/leiloes (confirmado real via residencial, 17/09)',
    url_lote: '/leiloes/lote-<n>-<slug>/<ID>', scraper: 'scraper-globo.mjs',
  },
};
