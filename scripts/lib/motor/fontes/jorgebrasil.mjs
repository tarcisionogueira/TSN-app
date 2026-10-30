/**
 * FONTE (config) — JORGE BRASIL LEILOEIRO (jorgebrasil.lel.br, Porto Alegre/RS; varas cíveis de POA, Canoas e São
 * Leopoldo). Site estático feito à mão, sem anti-bot → fetch direto, grátis. NÃO há página de lote: a home é a agenda
 * inteira (uma linha de tabela por imóvel) e o detalhe sai dela (`detalhesDoCatalogo`). Parser puro em
 * lib/jorgebrasil-parse.mjs; teste em scripts/testes/jorgebrasil-parse.mjs.
 */
import { TENANTS, extrairUrlsDeLote, extrairUrlsDeEvento, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../jorgebrasil-parse.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'jorgebrasil',
  fetch: 'fetch',
  catalogo: '/',
  maxPages: 1,          // página única (15 imóveis em 30/10)
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, extrairUrlsDeEvento, detalhesDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Site estático (HTML em tabela, "Site por Douglas Fork"), pregão por Zoom', acesso: 'fetch-direto', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: 'home = agenda (uma <tr> por imóvel; detalhe no próprio catálogo)',
    url_lote: '/?item=<nome-do-pdf-do-edital> (não existe página de lote)', scraper: 'scraper-jorgebrasil.mjs',
  },
};
