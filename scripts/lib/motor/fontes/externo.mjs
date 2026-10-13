/**
 * FONTE (config) — plataforma Leiloar "/externo/" (modelo listagem-bens-responsivo): Sanches, Osvaldo e
 * Judhastas. Parser em lib/externo-parse.mjs. O leilão É o imóvel; valores só no edital em PDF.
 * Motor `fetch` SEM Bright Data (semBD no wrapper): direto do runner e, no Cloudflare do Osvaldo, via
 * banco (pg_net) — os dois grátis. ~15 imóveis (alienação por iniciativa particular, TRT-2/15).
 */
import { TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../externo-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'externo',
  fetch: 'fetch',
  catalogo: '/',          // a home lista os "LEILÕES ATUAIS"
  paginaParam: 'page',
  maxPages: 1,
  // Leilão já gravado NÃO é relido: o PDF do Osvaldo custa crédito de Bright Data, e o edital não muda.
  // Fim do leilão sai pela limpeza por data (desativar_leiloes_encerrados), não por releitura.
  maxRefresh: 0,
  // JUDHASTAS fora (13/10): espelha os 5 leilões do Sanches (mesmo título, data e valores — 2251=2253,
  // 2247=2249, 2241=2242, 2255=2256, 2223=2227). Sem releitura, a deduplicação em memória não veria o
  // Sanches já gravado e o espelho entraria duplicado todo dia. Volta se passar a ter leilão próprio.
  tenants: [TENANTS.sanches, TENANTS.osvaldo],
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Leiloar /externo/ (listagem-bens-responsivo) — backend único, leilão = imóvel',
    acesso: 'fetch-direto + banco (Cloudflare no osvaldo)', custo: 'gratis', anti_bot: 'cloudflare (osvaldo)',
    enumeracao: 'home → /externo/leilao/<id>; arquivos em /externo/arquivos/<cabecalho_id>',
    url_lote: '/externo/leilao/<id>',
    scraper: 'scraper-externo.mjs',
  },
};
