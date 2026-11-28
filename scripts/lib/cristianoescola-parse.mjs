/**
 * Parser puro — CRISTIANO ESCOLA LEILÕES (cristianoescolaleiloes.com.br, Caxias do Sul/RS; Cristiano Escola, leiloeiro
 * oficial — TJRS, TRT4, Justiça Federal e vendas diretas de bancos/consórcios). Fila #380.
 *
 * 28/11 — O SITE FOI REFEITO. A plataforma BF2/CodeIgniter (`/categoria/imoveis`, `/ver-lote/<id>_<SLUG>`) saiu do ar
 * em ~27/11 (404) e entrou um app Laravel + Inertia/Vue. A coleta caiu para 0 com "catálogo não abriu: inexistente".
 * O app novo é MAIS fácil de ler: cada página entrega os dados em JSON num
 * `<script data-page="app" type="application/json">{"component":…,"props":…}</script>`. Recon pelo banco (pg_net):
 *
 *   • `/leiloes?page=N` (15 páginas de 14, 203 itens em 28/11): `props.items.data[]` com `kind: 'lot' | 'auction'`,
 *     `id`, `link`, `title`, `firstAuction`/`secondAuction` `{date: 'dd/mm/aaaa', time: 'hh:mm'}` e `suggestedValue`.
 *     É o catálogo de TODAS as categorias. NÃO use `?type=imoveis`: em 28/11 ele trazia 13 itens e deixava de fora 5
 *     imóveis que estão no catálogo completo (4983, 4986, 4992, 5078, 5103) — a varredura de sumidos os desligaria.
 *   • Evento (`kind: 'auction'`, `/leiloes/<slug>`): `props.lots[]` no mesmo formato dos itens.
 *   • Lote (`/leiloes/<slug>/lotes/<id>`): `props.lot` com `category` ('imoveis' | 'veiculos' | 'maquinas'), `title`,
 *     `description` (HTML), `characteristics[]` (Tipo/Situação/Localização do imóvel), `endsAt` e `roundLabel` da praça
 *     CORRENTE, `initialPriceCents` (mínimo da praça), `currentBidCents`, `isClosed`, `status`, `media[]`, `documents[]`
 *     (Matrícula, Avaliação…), `editalUrl`, `auctionType` ("Leilão Judicial"…) e `modality` ("Venda Direta"…).
 *   • O id do lote é a MESMA numeração da plataforma antiga (4983–5128), então `fonte_id` não muda e nada duplica.
 *   • Regras mantidas da versão anterior: na 1ª praça o lance inicial É a avaliação (TJRS); na 2ª, avaliação só se a
 *     descrição citar "Valor de Avaliação"; 2ª praça que não vem depois da 1ª é erro do site e é descartada.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://www.cristianoescolaleiloes.com.br';
export const CATALOGO = '/leiloes';
export const TENANTS = {
  cristianoescola: { fonte: 'CRISTIANOESCOLA', leiloeiro: 'Cristiano Escola Leilões (Cristiano Escola)', base: BASE },
};

// Novo: /leiloes/<slug>/lotes/<id>. Antigo (/ver-lote/<id>_<SLUG>) segue reconhecido: é o url_lote dos lotes já gravados.
export const idDaUrl = (url) => (String(url).match(/\/lotes\/(\d+)(?:[/?#]|$)/) || String(url).match(/\/ver-lote\/(\d+)_/) || [])[1] || null;

/** O JSON que o Inertia embute na página. `null` quando a página não é do app (erro, desafio, HTML antigo). */
export function dadosDaPagina(html) {
  const m = String(html || '').match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/i);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; } // padrao-ok: JSON quebrado = página que não é do app; o chamador trata null
}

/** {date:'26/11/2026', time:'14:00'} → '2026-11-26T14:00:00-03:00'. */
const isoPraca = (p) => {
  const d = String(p?.date || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!d) return null;
  const t = String(p?.time || '').match(/^(\d{1,2}):(\d{2})/);
  return `${d[3]}-${d[2]}-${d[1]}T${t ? t[1].padStart(2, '0') : '00'}:${t ? t[2] : '00'}:00-03:00`;
};

/** Datas das praças por id, lidas do catálogo (o lote só traz a praça corrente). */
const PRACAS_DO_CATALOGO = new Map();

/** Itens de catálogo ou de evento (`items.data` / `lots`). */
function itensDaPagina(html) {
  const p = dadosDaPagina(html)?.props || {};
  return [...(Array.isArray(p.items?.data) ? p.items.data : []), ...(Array.isArray(p.lots) ? p.lots : [])];
}

/** Catálogo `/leiloes?page=N` ou página de evento → Map id → url do lote (e guarda as praças para o parseDetalhe). */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const it of itensDaPagina(html)) {
    if (it?.kind !== 'lot' || !it.id || !it.link) continue;
    const id = String(it.id);
    out.set(id, it.link);
    PRACAS_DO_CATALOGO.set(id, { d1: isoPraca(it.firstAuction), d2: isoPraca(it.secondAuction) });
  }
  return out;
}

/** Eventos (`kind: 'auction'`) do catálogo → Map id → url do evento. Os lotes moram em `props.lots` da página dele. */
export function extrairUrlsDeEvento(html) {
  const out = new Map();
  for (const it of itensDaPagina(html)) if (it?.kind === 'auction' && it.id && it.link) out.set(String(it.id), it.link);
  return out;
}

const texto = (html) => decodificarEntidades(String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const reais = (c) => (Number.isFinite(Number(c)) && Number(c) > 0 ? Math.round(Number(c)) / 100 : 0);
const FORA = /\b(encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad)/i;
// "… - Vacaria/RS" / "… em Toledo-PR" → "Cidade/UF" para o validador de município.
const comBarra = (s) => String(s).replace(/([A-Za-zÀ-ÿ])\s*[–-]\s*([A-Z]{2})\b(?![\wÀ-ÿ])/g, '$1/$2');

export function parseDetalhe(html, url, { agora = new Date(), pracas = PRACAS_DO_CATALOGO } = {}) {
  const lot = dadosDaPagina(html)?.props?.lot;
  if (!lot?.title) return null;
  const id = String(lot.id || idDaUrl(url) || '');
  const carac = (rot) => texto((lot.characteristics || []).find((c) => rot.test(String(c?.label || '')))?.value);
  const tipoTabela = carac(/tipo de im/i);
  const localizacao = carac(/localiza/i);
  const situacaoImovel = carac(/situa/i);
  const h1 = texto(lot.title);
  const desc = texto(lot.description);
  const segunda = /segund/i.test(String(lot.roundLabel || ''));
  const atual = /^\d{4}-\d{2}-\d{2}T/.test(String(lot.endsAt || '')) ? String(lot.endsAt) : null;
  const cat = pracas.get(id) || {};
  let d1 = cat.d1 || (segunda ? null : atual);
  let d2 = cat.d2 || (segunda ? atual : null);
  if (d1 && d2 && Date.parse(d2) <= Date.parse(d1)) { if (segunda) d1 = null; else d2 = null; }
  if (!d1 && d2) { d1 = d2; d2 = null; }
  const fim = d2 || d1;
  const lance = reais(lot.initialPriceCents);
  // Só o rótulo do leiloeiro ("Valor de Avaliação: R$ 667.000,00"); "avaliado em NCr$ 10,00" é matrícula antiga.
  const avalTxt = (desc.match(/Valor\s+de\s+Avalia[çc][ãa]o[^:R]{0,20}:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1];
  const avalTexto = avalTxt ? Number(avalTxt.replace(/\./g, '').replace(',', '.')) : 0;
  const aval = avalTexto || (!segunda ? lance : 0);
  const local = [cidadeDoTexto(comBarra(localizacao)), cidadeDoTexto(comBarra(h1)), cidadeDoTexto(comBarra(desc))].find((c) => c.cidade) || { cidade: null, estado: null };
  const base = titleCase(h1.replace(/^\s*LOTE\s+(?:[ÚU]NICO|\d+)\s*[-–:]\s*/i, '').replace(/^VENDA DIRETA DE\s+/i, '').replace(/[.;,\s]+$/, '').toLowerCase())
    .replace(/\/([a-z]{2})\b/gi, (_, uf) => `/${uf.toUpperCase()}`).replace(/\bM²/g, 'm²').replace(/^./, (l) => l.toUpperCase());
  const prefixo = tipoTabela && (/box|vaga|garagem/i.test(tipoTabela) || inferirTipo(base, url) === 'outros') ? `${tipoTabela} - ` : '';
  const titulo = `${prefixo}${base}`;
  const docs = (lot.documents || []).filter((d) => d?.url).map((d) => ({ nome: texto(d.label) || 'Documento', url: d.url }));
  const matricula = docs.find((d) => /matr[íi]cula/i.test(d.nome))?.url || null;
  const edital = lot.editalUrl || null;
  const fotos = [...new Set((lot.media || []).filter((m) => m?.type === 'image' && m.url).map((m) => m.url))];
  const venda = /venda direta/i.test(`${lot.modality || ''} ${h1}`);
  const statusFora = FORA.test(`${lot.status || ''} ${lot.biddingBlockReason || ''}`);
  return {
    titulo: (local.cidade && !titulo.includes(local.cidade) ? `${titulo} - ${local.cidade}/${local.estado}` : titulo).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval, valor_minimo: lance, valor_minimo_2: null,
    modalidade: venda ? 'venda_direta' : /extrajudicial/i.test(String(lot.auctionType || '')) ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(desc) || extrairAreaM2(h1) || 0,
    descricao: [desc, localizacao && `Localização: ${localizacao}`, situacaoImovel && !/n[ãa]o informado/i.test(situacaoImovel) && `Situação: ${situacaoImovel}.`]
      .filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: d1, data_leilao_2: d2,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: matricula,
    anexos: [edital && { tipo: 'edital', nome: 'Edital', url: edital },
      ...docs.map((d) => ({ tipo: /matr[íi]cula/i.test(d.nome) ? 'matricula' : /avalia/i.test(d.nome) ? 'laudo' : 'outro', nome: titleCase(d.nome.toLowerCase()), url: d.url }))].filter(Boolean),
    numero_matricula: numeroMatriculaDoTexto(desc) || null,
    situacao: lot.roundLabel || lot.status || null,
    // A CATEGORIA da própria página decide (veículos, máquinas e diversos dividem o catálogo com os imóveis).
    naoImovel: String(lot.category || '').toLowerCase() !== 'imoveis',
    encerrado: !!lot.isClosed || statusFora || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
