/**
 * PARSER lojas white-label SUPERBID EXCHANGE (27/10) — 32 leiloeiros da junta cujo site é a SPA "Superbid Exchange"
 * (S4B): home vazia, tudo pela API pública offer-query.superbid.net. O storeId de cada site NÃO foi chutado: é o
 * `storeId` do `https://siteconfig.superbid.net/<host>/style.config.json` que o próprio site carrega (lido pelo banco
 * em 27/10), e o nome da loja é o da store-query (`/stores/?portalId=[2,15]`).
 *
 * A maior parte dos imóveis dessas lojas JÁ chega pelo coletor do portal (fonte SUPERBID, `sbid_<oferta>`, leiloeiro
 * = nome da loja). Este leitor existe para (1) deixar cada site CONECTADO com medição própria em fonte_saude e
 * (2) pegar a oferta que a loja publicou e o portal ainda não trouxe (27/10: CS LEILÕES 5067722 e PEDRO KRONBERG
 * 5058724, publicadas em 25/10). Para NÃO duplicar, o motor (fetch-sbidloja.mjs) tira do catálogo toda oferta que já
 * está ATIVA no acervo pelo portal (`sbid_`/`sold_`); quando o portal alcançar uma oferta nossa, ela sai da nossa
 * lista e a varredura de sumidos desliga a nossa cópia na rodada seguinte.
 *
 * Consulta = a mesma que o site white-label faz (modo loja: portalId=[2,15] + requestOrigin=store — sem eles a API
 * devolve vazio calado, lição do TOTALLEILOES em 30/07), filtrando productType imóveis (aceito no modo loja, medido
 * em 27/10: ECKERT 21 imóveis de 678 ofertas).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';

export const API = 'https://offer-query.superbid.net';
export const catalogoDaLoja = (storeId) => `/offers/?portalId=[2,15]&requestOrigin=store&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=stores.id:${storeId};product.productType.description:imoveis;&pageSize=100&orderBy=endDate:asc`;

const t = (fonte, loja, storeId, dominio, uf) => ({ fonte, leiloeiro: loja, loja, storeId: String(storeId), site: `https://www.${dominio}`, dominio, base: API, catalogo: catalogoDaLoja(storeId), uf });
export const TENANTS = {
  acosta: t('SBL_ACOSTA', 'ACOSTA LEILÕES', 16184, 'acostaleiloes.com.br', 'RJ'),
  batista: t('SBL_BATISTA', 'BATISTA LEILÕES', 16077, 'batistaleiloes.com.br', 'SP'),
  bm: t('SBL_BRENOMAGALHAES', 'BRENO MAGALHÃES LEILÕES', 16299, 'bmleiloes.com.br', 'MG'),
  buriham: t('SBL_BURIHAM', 'BURIHAM LEILÕES', 16105, 'burihamleiloes.com.br', 'SP'),
  bz: t('SBL_BZ', 'BZ LEILÕES', 16361, 'bzleiloes.com.br', 'PR'),
  clebercardoso: t('SBL_CLEBERCARDOSO', 'CLEBER CARDOSO LEILÕES', 16172, 'clebercardosoleiloes.com.br', 'MT'),
  cs: t('SBL_CS', 'CS LEILÕES', 16290, 'csleiloes.com.br', 'SC'),
  // style.config.json do site traz storeId [16515, 16274]: DAVISON MOREIRA (16515) — as ofertas da loja são as mesmas
  // da DILSON MOREIRA/CASA LEILOEIRA (a consulta pelas duas ids devolve as mesmas 70 em 27/10).
  davison: t('SBL_DAVISONMOREIRA', 'DAVISON MOREIRA', 16515, 'davisonmoreira.com.br', 'MG'),
  eckert: t('SBL_ECKERT', 'ECKERT ASSESSORIA', 16063, 'eckertleiloes.com.br', 'PR'),
  fernandafreire: t('SBL_FERNANDAFREIRE', 'FERNANDA JOSÉ DA SILVA FREIRE', 16070, 'fernandafreireleiloes.com.br', 'RJ'),
  franciscodavid: t('SBL_FRANCISCODAVID', 'FRANCISCO DAVID LEILOEIRO', 16116, 'franciscodavidleiloeiro.com.br', 'MG'),
  ghvm: t('SBL_GHVM', 'GHVM LEILÕES', 16080, 'ghvmleiloes.com.br', 'PE'),
  id: t('SBL_ID', 'ID LEILÕES', 16199, 'idleiloes.com.br', 'MT'),
  josimar: t('SBL_JOSIMAR', 'JOSIMAR LEILOEIRO', 16257, 'josimarleiloeiro.com.br', 'RJ'),
  kananda: t('SBL_KANANDA', 'KANANDA LEILÕES', 16368, 'kanandaleiloes.com.br', 'MG'),
  pedrokronberg: t('SBL_PEDROKRONBERG', 'PEDRO KRONBERG LEILÕES', 16189, 'kronberg.lel.br', 'PR'),
  lauand: t('SBL_LAUAND', 'LAUAND LEILÕES', 16124, 'lauandleiloes.com.br', 'SP'),
  leilominas: t('SBL_LEILOMINAS', 'LEILO MINAS', 16352, 'leilominas.com.br', 'MG'),
  leite: t('SBL_LEITE', 'LEITE LEILÕES', 16278, 'leiteleiloes.com.br', 'RJ'),
  lincoln: t('SBL_LINCOLN', 'LINCOLN LEILÕES', 16529, 'lincolnleiloes.com.br', 'MG'),
  mafra: t('SBL_MAFRA', 'MAFRA LEILÕES', 16237, 'mafraleiloes.com.br', 'SC'),
  miguelperez: t('SBL_MIGUELPEREZ', 'MIGUEL PEREZ LEILÕES', 16142, 'miguelperezleiloes.com.br', 'SP'),
  np: t('SBL_NP', 'NP LEILÕES', 16147, 'npleiloes.com.br', 'RS'),
  olivirogerio: t('SBL_OLIVIROGERIO', 'OLIVI ROGERIO LEILÕES', 16204, 'olivirogerioleiloes.com.br', 'SP'),
  pegoraro: t('SBL_PEGORARO', 'PEGORARO LEILÕES', 16104, 'pegoraroleiloes.com.br', 'SP'),
  presotto: t('SBL_PRESOTTO', 'CAMILA PRESOTTO LEILÕES', 16247, 'presottoleiloes.com.br', 'SC'),
  saladeleiloes: t('SBL_SALADELEILOES', 'SALA DE LEILÕES', 16178, 'saladeleiloes.com.br', 'MG'),
  schanzer: t('SBL_SCHANZER', 'Schanzer Leilões', 2281, 'schanzerleiloes.com.br', 'SP'),
  speranca: t('SBL_SPERANCA', 'SPERANÇA LEILÕES', 16179, 'sperancaleiloes.com.br', 'PR'),
  tadashi: t('SBL_TADASHI', 'TADASHI LEILÕES', 16430, 'tadashileiloes.com.br', 'PR'),
  taha: t('SBL_TAHA', 'TAHA LEILÕES', 16489, 'tahaleiloes.com.br', 'SP'),
  xisto: t('SBL_XISTO', 'XISTO LEILÕES', 16165, 'xistoleiloes.com.br', 'MT'),
};
const SITE_DA_LOJA = new Map(Object.values(TENANTS).map((x) => [x.storeId, x.site]));

export function lerCatalogo(txt) {
  try {
    const j = JSON.parse(String(txt || ''));
    if (!j || !Array.isArray(j.offers) || !Number.isFinite(Number(j.total))) return null;
    return j;
  } catch { return null; }
}
const storeDoTexto = (txt) => String(txt || '').match(/"_storeId"\s*:\s*"(\d+)"/)?.[1] || null;
const urlOferta = (site, id) => `${site}/oferta/${id}`;
const ehImovel = (o) => /im[óo]veis/i.test(o?.product?.productType?.description || '');

export function extrairUrlsDeLote(txt) {
  const j = lerCatalogo(txt), site = SITE_DA_LOJA.get(j?._storeId || storeDoTexto(txt));
  const out = new Map();
  if (!j || !site) return out;
  for (const o of j.offers) if (o?.id && ehImovel(o)) out.set(String(o.id), urlOferta(site, o.id));
  return out;
}
export function detalhesDoCatalogo(txt) {
  const j = lerCatalogo(txt), site = SITE_DA_LOJA.get(j?._storeId || storeDoTexto(txt));
  const out = new Map();
  if (!j || !site) return out;
  for (const o of j.offers) if (o?.id && ehImovel(o)) out.set(urlOferta(site, o.id), detalheDaOferta(o));
  return out;
}
// O total que a API declara MENOS o que o motor tirou por já vir pelo portal: é com isso que o enumerado se compara.
export function totalDoCatalogo(txt) {
  const j = lerCatalogo(txt);
  return j ? Math.max(0, Number(j.total) - (Number(j._noPortal) || 0)) : null;
}
export function idDaUrl(url) { return String(url || '').match(/\/oferta\/(?:[^/?#]*-)?(\d+)(?:[/?#]|$)/)?.[1] || null; }

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const plaus = (v) => (v >= 1000 && v <= 500_000_000 ? v : 0);
const strip = (s) => String(s || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
// "2026-11-12 14:00:00" é horário de Brasília na API (o site mostra 14h).
const isoBR = (s) => { const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/); return m ? `${m[1]}T${m[2]}:00-03:00` : null; };

export function detalheDaOferta(o, agora = Date.now()) {
  const p = o.product || {}, det = o.offerDetail || {}, au = o.auction || {};
  const cidadeUf = String(p.location?.city || '').match(/^(.*?)\s*[-–]\s*([A-Z]{2})$/);
  const desc = strip(o.offerDescription?.offerDescription || p.detailedDescription || '');
  const etapas = (o.eventPipeline?.stages || au.eventPipeline?.stages || []).filter((s) => s?.endDate);
  const iAtiva = Math.max(0, etapas.findIndex((s) => s.isActive));
  const prox = etapas[iAtiva + 1] || null;
  const minimo = plaus(num(det.initialBidValue)) || plaus(num(det.currentMinBid)) || plaus(num(o.price));
  // Avaliação: o valor de referência quando a API traz; no judicial, a 1ª praça (100% da avaliação) — só se ≥ mínimo.
  const ref = plaus(num(det.referenceValue)) || plaus(num(etapas[0]?.initialBidValue));
  const judicial = (au.subMarketplaces || []).some((s) => /judicial/i.test(s?.subMarketplaceDesc || ''));
  const titulo = String(p.shortDesc || '').trim() || null;
  const tipoTxt = `${p.subCategory?.category?.description || ''} ${p.subCategory?.description || ''} ${titulo || ''}`;
  const fim = Date.parse(isoBR(au.endDate || o.endDate) || '');
  const st = o.offerStatus || {};
  let fotos = [];
  try { fotos = (Array.isArray(p.galleryJson) ? p.galleryJson : JSON.parse(p.galleryJson || '[]')).map((g) => g?.link).filter(Boolean); } catch { fotos = []; }
  fotos = [...new Set([p.thumbnailUrl, ...fotos].filter(Boolean))];
  return {
    id: String(o.id),
    titulo, descricao: desc.slice(0, 8000) || null,
    cidade: cidadeUf ? cidadeUf[1].trim() : (p.location?.city || null), estado: cidadeUf ? cidadeUf[2] : null,
    valor_minimo: minimo, valor_avaliacao: ref >= minimo ? ref : 0,
    data_leilao: (au.endDate || o.endDate) ? String(au.endDate || o.endDate).slice(0, 10) : null,
    data_leilao_2: prox ? isoBR(prox.endDate) : null,
    valor_minimo_2: prox && plaus(num(prox.initialBidValue)) && num(prox.initialBidValue) !== minimo ? num(prox.initialBidValue) : null,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    tipo_hint: tipoTxt,
    area_m2: extrairAreaM2(titulo || '') || extrairAreaM2(desc) || 0,
    numero_processo: String(p.judicial?.processNumber || '').trim() || null,
    numero_matricula: numeroMatriculaDoTexto(desc),
    link_foto: fotos[0] || null, fotos,
    encerrado: !!(st.closed || st.sold || st.removed) || (Number.isFinite(fim) && fim < agora - 3600e3),
  };
}

export function montarRow(url, det, tenant) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${det.id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro}`,
    tipo: inferirTipo(det.tipo_hint || det.titulo || '', url), modalidade: det.modalidade,
    cidade: det.cidade, estado: det.estado, endereco: null, bairro: null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: url, url_lote: url, link_foto: det.link_foto,
    ...(det.fotos?.length ? { fotos: det.fotos } : {}),
    numero_matricula: det.numero_matricula || null, numero_processo: det.numero_processo,
    leiloeiro: tenant.leiloeiro,
    data_leilao: det.data_leilao, data_leilao_2: det.data_leilao_2, valor_minimo_2: det.valor_minimo_2,
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// O det sai pronto do catálogo; o runner nunca chama este (o contrato pede a função).
export function parseDetalhe() { return null; }
export { checarQualidade };
