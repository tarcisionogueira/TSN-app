/**
 * FONTE (config) — ARNALDO LEILÕES (arnaldoleiloes.com.br). Triagem 22/10 (#292): HTML do servidor, via grátis.
 * Um nível: `/lotes/?&cate[]=111` (IMÓVEIS) → `/lote/<slug>/<id>/`. Valores e datas não estão no HTML: o
 * `enriquecerProntos` busca todos num POST só no AJAX do próprio site (o mesmo que a página chama a cada 5 s).
 * Parser em lib/arnaldo-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, aplicarValores,
} from '../../arnaldo-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

async function enriquecer(rows, tenant) {
  const ids = [...new Set(rows.map((r) => idDaUrl(r.url_lote)).filter(Boolean))];
  if (!ids.length) return null;
  const r = await fetch(`${tenant.base}/app/Ajax/Leiloes/atualizar_leiloes.php`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Requested-With': 'XMLHttpRequest' },
    body: new URLSearchParams({ leiloes: '', lotes: `${ids.join('-')}-`, lote: '' }),
  });
  if (!r.ok) throw new Error(`AJAX de valores HTTP ${r.status}`);
  const j = await r.json();
  if (!j?.item || typeof j.item !== 'object') throw new Error(`AJAX sem "item": ${JSON.stringify(j).slice(0, 160)}`);
  if (process.env.ARNALDO_DEBUG === '1') console.log(JSON.stringify(Object.values(j.item)[0]).slice(0, 1500));
  return `valores do AJAX em ${aplicarValores(rows, j.item)}/${rows.length} lote(s)`;
}

export default {
  chave: 'arnaldo',
  fetch: 'fetch',
  catalogo: '/lotes/?&cate[]=111',
  paginaParam: 'pagina',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  enriquecerProntos: enriquecer,
  conhecimento: {
    plataforma: 'PHP próprio (valores por AJAX atualizar_leiloes.php)', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/lotes/?&cate[]=111 → /lote/<slug>/<id>/', url_lote: '/lote/<slug>/<id>/', scraper: 'scraper-arnaldo.mjs',
  },
};
