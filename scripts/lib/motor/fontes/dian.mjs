/**
 * FONTE (config) — LEILOEIRO DIAN (leiloeirodian.com.br, RS). Fonte `dom`: a página do item é montada no navegador
 * (Next.js + Supabase próprio), então renderiza no runner — grátis, sem Cloudflare. Listagens: home + /agenda +
 * /venda-direta (server-rendered; só cards de categoria Imóvel viram lote). Parser puro em lib/dian-parse.mjs; teste em
 * scripts/testes/dian-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../dian-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'dian',
  fetch: 'dom',
  // 29/10: o item mostra "Carregando leilão…" até o cliente buscar os dados; ~3–4 s depois do network idle no navegador.
  dom: { esperaMs: 4000 },
  catalogo: '/',
  maxPages: 1,
  maxEventos: 2,
  maxPagesEvento: 1,
  maxRefresh: 30,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Next.js + Supabase próprio (item montado no cliente)', acesso: 'dom-puppeteer', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home + /agenda + /venda-direta → /item/<uuid> (só categoria Imóvel)',
    url_lote: '/item/<uuid>', scraper: 'scraper-dian.mjs',
  },
};
