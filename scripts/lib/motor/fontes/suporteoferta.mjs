/**
 * FONTE (config) — Suporte Leilões, front-end "oferta" (Rafael Leiloeiro). Achado no radar de
 * editais do DJEN em 10/10. Server-rendered, sem Cloudflare → motor `fetch` grátis (Bright Data só
 * como 2ª chance, dentro do teto semanal). Parser puro em lib/suporte-oferta-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../suporte-oferta-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'suporteoferta',
  fetch: 'fetch',
  catalogo: '/busca?tipo=Imoveis',
  paginaParam: 'page',
  maxPages: 3,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Suporte Leilões — front-end "oferta" (JSON var lote/var leilao)', acesso: 'fetch-direto',
    custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/busca?tipo=Imoveis',
    url_lote: '/oferta/leilao/imoveis/<cat>/<id>/id-<id>/<slug>',
    scraper: 'scraper-suporteoferta.mjs',
  },
};
