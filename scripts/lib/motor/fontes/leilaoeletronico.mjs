/**
 * FONTE (config) — LEILÃO ELETRÔNICO (leilaoeletronico.com.br; pendência 307, 23/10). Plataforma Degrau ("Sua
 * Plataforma de Leilão"), mas sem Cloudflare: feed e páginas abrem pela via grátis (fetch direto e, se o runner for
 * barrado, pelo banco). NÃO entra no motor `mgl`, que é Firecrawl (crédito por página). Enumeração pelo feed
 * /sitemap.xml (224 abertos em 23/10, nacional); datas e lances de cada praça saem do feed, o resto da página.
 * Parser puro em lib/leilaoeletronico-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../leilaoeletronico-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'leilaoeletronico',
  fetch: 'fetch',
  catalogo: '/sitemap.xml',
  paginaParam: 'page',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Sua Plataforma de Leilão (Degrau) — tema padrão', acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/sitemap.xml (feed <listing>: praças com <end_date>/<rate>, cidade, coordenadas, fotos)',
    url_lote: '/lote/<slug>/<id>/', scraper: 'scraper-leilaoeletronico.mjs',
  },
};
