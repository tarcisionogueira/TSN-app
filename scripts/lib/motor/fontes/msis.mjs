/**
 * FONTE (config) — plataforma MSIS (msis.com.br, ASP clássico): 21 leiloeiros do RJ (JUCERJA), triagem 26/10
 * (leiloeiro_triagem.plataforma = 'ASP_PRINCIPAL'). Parser em lib/msis-parse.mjs; transporte em motor/fetch-msis.mjs
 * (catálogo só por POST de formulário; via banco quando o Cloudflare recusa o runner). Dois níveis:
 * `Principal.asp` (todas as páginas, `acaoDest=N`) → leilão aberto `Leilao.asp?zz=` → lotes da própria página.
 */
import {
  TENANTS, extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, detalhesDoCatalogo, montarRow, checarQualidade,
} from '../../msis-parse.mjs';
import { criarMotorMsis } from '../fetch-msis.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'msis',
  criarMotor: criarMotorMsis,
  catalogo: '/Principal.asp',
  paginaParam: 'pag',
  // O motor msis já devolve o catálogo INTEIRO na 1ª chamada (todas as páginas por POST); a 2ª página do laço
  // recebe a mesma lista e o laço para. Evento idem (todas as páginas de lotes concatenadas).
  maxPages: 2,
  maxPagesEvento: 1,
  maxEventos: 400,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeEvento, extrairUrlsDeLote, idDaUrl, parseDetalhe, detalhesDoCatalogo, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'MSIS (ASP clássico, "desenvolvido por MSIS")', acesso: 'fetch-direto (POST de formulário) · banco (pg_net) quando Cloudflare', custo: 'gratis', anti_bot: 'Cloudflare em parte dos tenants (só IP de datacenter)',
    enumeracao: 'POST Principal.asp acaoDest=N&pag=N → Leilao.asp?zz=<zz> (lotes na página; POST pag p/ página 2+)', url_lote: '/Leilao.asp?zz=<zz>&nlo=<id>',
    scraper: 'scraper-msis.mjs',
  },
};
