/**
 * FONTE (config) — plataforma SoftGT: FLEX LEILÕES (DF/GO) e LUIZ CARVALHO LEILÕES (MG/GO). Triagem de 22/10
 * (#292): HTML pronto do servidor, sem Cloudflare — via grátis (fetch direto; `semBD` no wrapper).
 * Dois níveis: catálogo → leilão (`lotes/<L>` · `leiloes/<L>`) → lote `/detalhe-lote/<L>/<ordem>/`.
 * Parser em lib/softgt-parse.mjs. A Luiz lista leilões de todo tipo na home: o motor descarta o que não é
 * imóvel (`naoEhImovel`) — e o lote do Comprei repetido sai pela dedup por matrícula.
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../softgt-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'softgt',
  fetch: 'fetch',
  catalogo: '/',               // cada tenant traz o próprio `catalogo` (Flex /imoveis/, Luiz /)
  paginaParam: 'pagina',
  maxPages: 1,
  maxPagesEvento: 1,
  maxEventos: 40,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'SoftGT (PHP, HTML do servidor)', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'catálogo → lotes/<L> ou leiloes/<L> → detalhe-lote/<L>/<ordem>', url_lote: '/detalhe-lote/<L>/<ordem>/',
    scraper: 'scraper-softgt.mjs',
  },
};
