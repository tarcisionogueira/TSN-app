/**
 * FONTE (config) — plataforma ROISOFT (7 leiloeiros da triagem de 26/10). Parser em lib/roisoft-parse.mjs; transporte
 * em motor/fetch-roisoft.mjs (catálogo por POST de formulário, todas as páginas; lote por GET). Roda no GitHub com
 * fetch puro — o banco (AWS) leva 403 e o PC do dono não é necessário.
 */
import { TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../roisoft-parse.mjs';
import { criarMotorRoisoft } from '../fetch-roisoft.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'roisoft',
  criarMotor: criarMotorRoisoft,
  catalogo: '/lotes/listar-imoveis-dados',
  paginaParam: 'pagina',
  maxPages: 2,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Roisoft (PHP, jQuery; "Roisoft - Softwares Web")', acesso: 'fetch-direto do runner do GitHub (POST de formulário no catálogo)', custo: 'gratis', anti_bot: '403 ao IP da AWS (banco)',
    enumeracao: 'POST /lotes/listar-imoveis-dados (pagina=N, LET_ID=2) → JSON {total, dados} → /imoveis/lote/<id>', url_lote: '/imoveis/lote/<id>',
    scraper: 'scraper-roisoft.mjs',
  },
};
