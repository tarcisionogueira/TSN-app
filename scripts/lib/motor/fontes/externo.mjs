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
  // SÓ O SANCHES (13/10): Osvaldo e Judhastas REPUBLICAM os mesmos leilões do Sanches (ensaio: os 4 do
  // Osvaldo e os 5 do Judhastas têm título, data e valores idênticos aos do Sanches — 2252/2248/2243/2257 e
  // 2253/2249/2242/2256/2227). Sem releitura, a deduplicação em memória não veria o Sanches já gravado e os
  // espelhos entrariam duplicados todo dia — e o Osvaldo ainda cobraria Bright Data pelo PDF (Cloudflare).
  // Volta um tenant se ele passar a ter leilão próprio (o recon é a home de cada um).
  tenants: [TENANTS.sanches],
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Leiloar /externo/ (listagem-bens-responsivo) — backend único, leilão = imóvel',
    acesso: 'fetch-direto + banco (Cloudflare no osvaldo)', custo: 'gratis', anti_bot: 'cloudflare (osvaldo)',
    enumeracao: 'home → /externo/leilao/<id>; arquivos em /externo/arquivos/<cabecalho_id>',
    url_lote: '/externo/leilao/<id>',
    scraper: 'scraper-externo.mjs',
  },
};
