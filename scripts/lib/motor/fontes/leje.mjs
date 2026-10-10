/**
 * FONTE (config) — LEJE (leje.com.br). Fonte `dom`, plataforma própria em PHP antigo, sem
 * Cloudflare (recon 07/09). Catálogo é a HOME ("/") — todo outro path testado devolveu a
 * mesma home byte a byte. Parser puro em lib/leje-parse.mjs.
 *
 * ❌ TESTADO 26/09 — proxy ISP do Bright Data NÃO resolve o 403 que o site dá ao runner do GitHub
 * desde 24/09: com `usarProxyIsp:true` a HOME passou (enumerou o lote), mas a página de DETALHE
 * seguiu 403 (run 36271000254). Mesmo desfecho do GLOBO em 20/09. Só passa de IP residencial de
 * verdade (`scripts/runner-residencial.sh`). NÃO tentar de novo sem mudar essa premissa.
 *
 * ✅ 10/10 — FIRECRAWL passa: home e detalhe com HTTP 200 (proxy básico, 1 crédito/página) e o
 * parser abaixo extraiu título/cidade/avaliação/lance/matrícula do HTML. Fetch trocado para
 * 'firecrawl' (lib/motor/fetch-firecrawl.mjs); precisa do secret FIRECRAWL_API_KEY no GitHub.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leje-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leje',
  fetch: 'firecrawl',
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (PHP antigo, URL por query string)', acesso: 'firecrawl',
    custo: 'firecrawl (1 crédito/página)', anti_bot: 'cloudflare (403 ao runner/ISP)',
    enumeracao: '/ (home — todo outro path testado é a mesma home)',
    url_lote: '/index.php?acao=evento&cod=<leilaoId>&lote=<loteId>',
    scraper: 'scraper-leje.mjs',
  },
};
