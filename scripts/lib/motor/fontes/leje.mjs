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
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leje-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leje',
  // 21/10: Firecrawl só onde há chave (GitHub). O runner RESIDENCIAL não tem FIRECRAWL_API_KEY — com 'firecrawl'
  // fixo cada rodada de casa falhava sem tentar; de IP residencial o site abre direto (é por isso que o LEJE está
  // no runner-residencial.sh), então lá vai pelo DOM, sem custo.
  fetch: (process.env.FIRECRAWL_API_KEY || '').trim() ? 'firecrawl' : 'dom',
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  // 20/10 (#250): a home lista EVENTOS; cada um é aberto uma vez (lote único sai dali mesmo, ver leje-parse).
  // Medido: 43 eventos no ar → ~44 créditos/rodada semanal. O teto padrão de 12 cortaria 2/3 do acervo.
  maxEventos: 60,
  maxPagesEvento: 1,
  // Semanal: 15 dias = ausente do catálogo em 2 rodadas seguidas → sumiu_da_fonte (ver runner).
  sumidoDias: 15,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (PHP antigo, URL por query string)', acesso: 'firecrawl',
    custo: 'firecrawl (1 crédito/página)', anti_bot: 'cloudflare (403 ao runner/ISP)',
    enumeracao: '/ (home lista eventos cod=N) → evento (lote único = o próprio evento; vários = links lote=)',
    url_lote: '/index.php?acao=evento&cod=<leilaoId>&lote=<loteId>',
    scraper: 'scraper-leje.mjs',
  },
};
