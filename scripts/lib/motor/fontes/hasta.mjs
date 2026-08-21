/**
 * FONTE (config) — HASTA (hastaleiloes.com.br, o site REAL — plural; ver a história do
 * domínio errado no cabeçalho de lib/hasta-parse.mjs). Fonte `dom` do Passo 2: o site não
 * responde a datacenter (render vazio no runner do GitHub), então a coleta roda pelo
 * runner RESIDENCIAL (linha HASTA no runner-residencial.sh, gate coleta_cliente).
 * Estrutura mapeada pelo DONO via console do navegador (21/08): listagem /lotes/imovel
 * (30/pág) → lote /item/<ID>/detalhes. Comitente observado: CAIXA (vigiar duplicidade
 * com a fonte CEF). Parser puro em lib/hasta-parse.mjs.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade,
} from '../../hasta-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'hasta',
  fetch: 'dom',
  dom: { esperaMs: 3500 },
  catalogo: '/lotes/imovel',
  paginaParam: 'page',
  maxPages: 3,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Hasta Leilões (SPA própria; render exige IP residencial)', acesso: 'dom-puppeteer-residencial',
    custo: 'gratis', anti_bot: 'bloqueio a datacenter', enumeracao: '/lotes/imovel (renderizado)',
    url_lote: '/item/<ID>/detalhes', scraper: 'scraper-hasta.mjs (runner residencial)',
  },
};
