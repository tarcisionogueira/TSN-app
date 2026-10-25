/**
 * FONTE (config) — PLATAFORMA LABASOFT (PHP; pendência 356, 25/10): Schulmann, Karla Pepe e Leilões Braga (RJ).
 * Dois níveis: home → categorias (`thumbs.php?tipo=` / `index.php?tipo=`, sem veículo) → `detalhe.php?id=<N>`.
 * Parser em lib/labasoft-parse.mjs. HTML estático, sem Cloudflare: fetch direto, banco de reserva, nunca Bright Data.
 */
import { TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../labasoft-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'labasoft',
  fetch: 'fetch',
  catalogo: '/',
  paginaParam: 'page',
  maxPages: 1,
  // Os lotes da home também entram (o motor lê a página 1 do catálogo antes dos eventos).
  maxEventos: 8,
  maxPagesEvento: 1,
  // Schulmann ~65 imóveis abertos (25/10, home + categorias); Karla ~8; Braga 0 (só teste da Labasoft).
  maxRefresh: 80,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Labasoft (PHP, labasoft.com.br)', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home + thumbs.php?tipo= / index.php?tipo= (sem veículo) → detalhe.php?id=<N>',
    url_lote: '/detalhe.php?id=<N>', scraper: 'scraper-labasoft.mjs',
  },
};
