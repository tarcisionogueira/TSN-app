/**
 * FONTE (config) — NORTE DE MINAS LEILÕES (nortedeminasleiloes.com.br, "WebAjato"). Triagem 22/10 (#292): HTML do
 * servidor, sem Cloudflare — via grátis. Um nível: home → `/leilao/<id>` (cada um é um bem). Parser em
 * lib/nortedeminas-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../nortedeminas-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'nortedeminas',
  fetch: 'fetch',
  catalogo: '/',
  paginaParam: 'pagina',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'WebAjato (PHP, HTML do servidor)', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home → /leilao/<id>', url_lote: '/leilao/<id>', scraper: 'scraper-nortedeminas.mjs',
  },
};
