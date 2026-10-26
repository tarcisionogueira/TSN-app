/**
 * FONTE (config) — PORTAL DOS LEILÕES (portaldosleiloes.com.br, AL; front Next.js novo da Suporte, SSR — 26/10). Parser
 * puro em lib/suporte-next-parse.mjs (PORTAL). Catálogo = o filtro de imóveis do PRÓPRIO site; em 26/10 ele responde
 * "Nenhum lote encontrado" (o acervo é de usinas: máquinas, equipamentos e veículos) — ligado assim mesmo, para o
 * imóvel que for publicado entrar sozinho. O zero declarado vira linha em fonte_saude com o motivo "site declara…".
 */
import { PORTAL } from '../../suporte-next-parse.mjs';

const { TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade } = PORTAL;

export default {
  chave: 'portaldosleiloes',
  fetch: 'fetch',
  catalogo: '/lotes?categoria=Im%C3%B3veis',
  paginaParam: 'page',
  maxPages: 6,
  maxRefresh: 30,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Suporte Leilões — front Next.js "lei-" (Portal dos Leilões), SSR',
    acesso: 'fetch-direto (banco de reserva)', custo: 'gratis', anti_bot: 'nenhum (Cloudflare sem challenge)',
    enumeracao: '/lotes?categoria=Imóveis&page=N', url_lote: '/lote/<slug> (props RSC do painel: loteId, valorInicial, dataEncerra)',
    scraper: 'scraper-suportenext.mjs',
  },
};
