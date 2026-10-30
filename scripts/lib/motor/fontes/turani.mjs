/**
 * FONTE (config) — GUSTAVO TURANI LEILÕES (turanileiloes.com.br, RS; judiciais TJRS/TRT4, falências e extrajudiciais).
 * Plataforma própria (Laravel + Vue, duo.studio), Cloudflare só como CDN → fetch direto, grátis. `/imoveis?page=N`
 * lista só imóveis (8 por página, abertos primeiro); o detalhe é o JSON público `/lotes/<id>/atualiza-pagina`.
 * Parser puro em lib/turani-parse.mjs; teste em scripts/testes/turani-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../turani-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'turani',
  fetch: 'fetch',
  catalogo: '/imoveis',
  paginaParam: 'page',
  // 30/10: ~35 páginas de abertos (≈ 270 lotes) antes dos encerrados; a 1ª página só de encerrados encerra a lista.
  maxPages: 60,
  maxRefresh: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Própria (Laravel + Vue, duo.studio); detalhe em JSON público', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum (Cloudflare só CDN)',
    enumeracao: '/imoveis?page=N (cartões abertos primeiro) → /lotes/<id>/atualiza-pagina (JSON)',
    url_lote: '/imoveis/<id>-<slug>', scraper: 'scraper-turani.mjs',
  },
};
