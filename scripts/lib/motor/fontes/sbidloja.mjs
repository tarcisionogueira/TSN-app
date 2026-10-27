/**
 * FONTE (config) — lojas white-label SUPERBID EXCHANGE (32 leiloeiros da junta, 27/10). Parser em lib/sbidloja-parse.mjs;
 * transporte em motor/fetch-sbidloja.mjs. Uma `fonte` por loja (SBL_<nome>): a falha de uma não toca as outras, e a
 * varredura de sumidos de uma nunca desliga lote do portal SUPERBID (fonte diferente). Ofertas que o portal já trouxe
 * não entram (ver o motor).
 */
import { TENANTS, extrairUrlsDeLote, detalhesDoCatalogo, totalDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade } from '../../sbidloja-parse.mjs';
import { criarMotorSbidLoja } from '../fetch-sbidloja.mjs';

export const TENANTS_POR_CHAVE = TENANTS;

export default {
  chave: 'sbidloja',
  criarMotor: criarMotorSbidLoja,
  catalogo: '/offers/',        // cada tenant traz o seu (`tenant.catalogo`, com o storeId)
  paginaParam: 'pageNumber',
  maxPages: 5,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, detalhesDoCatalogo, totalDoCatalogo, idDaUrl, parseDetalhe, montarRow, checarQualidade },
  conhecimento: {
    plataforma: 'Superbid Exchange (S4B) — loja white-label; storeId do siteconfig.superbid.net/<host>/style.config.json',
    acesso: 'api-publica (offer-query.superbid.net, modo loja)', custo: 'gratis', anti_bot: 'nenhum na API',
    enumeracao: 'offers/?portalId=[2,15]&requestOrigin=store&filter=stores.id:<id>;product.productType.description:imoveis; — menos o que já vem pelo portal SUPERBID',
    url_lote: '/oferta/<id>', scraper: 'scraper-sbidloja.mjs',
  },
};
