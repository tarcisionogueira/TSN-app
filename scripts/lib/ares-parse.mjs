/**
 * PARSER plataforma ARES (13/10) — white-label de leilão da "Agência Ares" sobre Supabase: cada
 * leiloeiro tem o próprio projeto, exposto em `api.<domínio>/rest/v1` (PostgREST). Tenants: Picelli
 * (Jaguariúna, ~74 imóveis vivos) e Shiokawa (Praia Grande, poucos). Mesmo schema nos dois.
 *
 * O catálogo INTEIRO vem numa consulta só (lote + cidade/UF + categoria + leilão + praças + fotos +
 * documentos tipados) — `detalhesDoCatalogo` entrega o det pronto e o motor não abre página nenhuma.
 *   • A API exige o cabeçalho `apikey` com a chave `sb_publishable_…` que o PRÓPRIO site manda do
 *     navegador (pública por desenho, não é segredo). Picelli só abre em navegador (Cloudflare); a
 *     chave dele foi lida pelo recon-dom (13/10). Chave trocada = 401 nomeado na saúde da fonte.
 *   • NÃO lemos `judicial_defendant`/`judicial_plaintiff` (nome e CPF de executado/exequente) nem
 *     tabela de usuário — o JS do site cita `profiles`, `user_documents`, `user_pix_keys`: fora.
 *   • Lote de TESTE e anúncio "Leads" (captação, não é leilão) aparecem como `aberto`/`futuro` com
 *     praça VENCIDA ("REPASSE 1", "PARCELADO"…): o que separa é a data da última praça.
 *   • Página pública do lote: `/lote/<id>` (a rota do site aceita slug OU id — o id não muda quando
 *     o título é editado, o slug sim).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
// extrairAreaM2 (servidor) prioriza privativa/útil sobre a área do condomínio/terreno citada antes —
// o extrairArea genérico leu 6.629,9 m² (o condomínio) no apartamento de Bertioga (13/10).
import { numeroMatriculaDoTexto, extrairAreaM2 } from '../../api/_texto-imovel.js';

export const TENANTS = {
  picelli: {
    fonte: 'PICELLI', leiloeiro: 'Picelli Leilões', site: 'https://www.picellileiloes.com.br',
    base: 'https://api.picellileiloes.com.br', headers: { apikey: 'sb_publishable_Ekokc-7yTyPVUHWzAqQkGw_M6l6jAnj' },
  },
  shiokawa: {
    fonte: 'SHIOKAWA', leiloeiro: 'Shiokawa Leilões', site: 'https://www.shiokawaleiloes.com.br',
    base: 'https://api.shiokawaleiloes.com.br', headers: { apikey: 'sb_publishable_eBr5iSp_7jKGIj_8XO-lpw_68HjspXC' },
  },
  // 18/10 (pendência 38): mesma plataforma — o backlog os listava como "SPA React PostgREST" junto com
  // Picelli/Shiokawa. Chave publishable tirada do bundle público de cada site (é pública por desenho).
  zaccarino: {
    fonte: 'ZACCARINO', leiloeiro: 'Zaccarino Leilões', site: 'https://www.zaccarino.com.br',
    base: 'https://api.zaccarino.com.br', headers: { apikey: 'sb_publishable_yk1zTg31VCifVk4AHuZIbQ_9G_N8qiH' },
  },
  cunha: {
    fonte: 'CUNHA', leiloeiro: 'Cunha Leiloeiro', site: 'https://www.cunhaleiloeiro.com.br',
    base: 'https://api.cunhaleiloeiro.com.br', headers: { apikey: 'sb_publishable_-9Hgjbq1X_N614naMFSPHA_h1LMqujK' },
  },
  // 22/10 (triagem, #292): Savoy — "Agência Ares" no rodapé do bundle, mesma API e mesmo SELECT (testado pelo
  // banco: 2.391 lotes vivos, 994 de cada 1.000 veículos de pátio/Detran). Rota do site: /lote/:lotId.
  savoy: {
    fonte: 'SAVOY', leiloeiro: 'Savoy Leilões', site: 'https://www.savoyleiloes.com.br',
    base: 'https://api.savoyleiloes.com.br', headers: { apikey: 'sb_publishable__NGN6fHZ_XB-PWeVqYDgjA_nHEmpnNB' },
  },
};
const SITE_POR_API = new Map(Object.values(TENANTS).map(t => [t.base, t.site]));

export const SELECT = [
  'id', 'slug', 'title', 'description', 'status', 'evaluation_value', 'address', 'latitude', 'longitude',
  'judicial_process_number', 'judicial_court', 'featured_image_url',
  'cities(name)', 'states(code)', 'categories(slug,name)', 'auctions!fk_lots_auction_id(title,auction_type,status)',
  'lot_phases(phase_order,end_date,initial_value)', 'lot_images(image_url,display_order)', 'lot_documents(title,file_url,document_type)',
  'lot_attributes(value,category_attributes(name))',
].join(',');
export const CATALOGO = `/rest/v1/lots?select=${SELECT}&status=in.(aberto,futuro)&hidden=eq.false&order=created_at.desc&limit=1000`;

const num = v => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
const stripHtml = s => String(s || '').replace(/<br\s*\/?>|<\/p>/gi, '\n').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
  .replace(/&amp;/gi, '&').replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
const ehImovelCat = slug => /^(imove|imovei|areas|terren|casa|apart|rura|galp|sala|predi)/i.test(String(slug || ''));
const urlLote = (base, id) => `${SITE_POR_API.get(base) || base.replace('//api.', '//www.')}/lote/${id}`;

function lotes(txt) {
  try { const j = JSON.parse(String(txt || '')); return Array.isArray(j) ? j : []; } catch { return []; }
}

export function idDaUrl(url) {
  return (String(url).match(/\/lote\/([0-9a-f-]{36})(?:[/?#]|$)/i) || [])[1] || null;
}

// APURAÇÃO PELA API (20/10). O catálogo só pede `aberto,futuro`: lote encerrado SOME da coleta e
// ninguém grava o resultado — o cron de apuração descarta "venda direta" e a Ares é quase toda
// venda direta COM prazo. Achado: SHIOKAWA Piracicaba (16/10) ativo 4 dias depois do fim, alarme
// crítico `resultado_leilao_atrasado`. A mesma API diz o desfecho sem abrir página:
//   status vendido → vendido · cancelado/cancelled_at → cancelado · encerrado com bid_count 0 e
//   highest_bid_value 0 → sem_lance · encerrado COM lance → não decide (pode ser lance abaixo do
//   mínimo, condicional) · aberto/futuro → ainda corre, não é resultado.
// Devolve `achado` no formato de api/_resultado-leilao.js (`patchDaApuracao`). Falha da API LANÇA:
// "não consegui ler" não pode virar "nenhum resultado" (forma nº 2 do CLAUDE.md).
export function desfechoAres(lote) {
  const st = String(lote?.status || '').toLowerCase();
  const lances = Number(lote?.bid_count) || 0;
  const maior = Number(lote?.highest_bid_value) || 0;
  if (st === 'vendido') return { resultado: 'vendido', valor: maior >= 1000 ? maior : null };
  if (st === 'cancelado' || lote?.cancelled_at) return { resultado: 'cancelado', valor: null };
  if (st === 'encerrado' && !lances && !maior) return { resultado: 'sem_lance', valor: null };
  return null;
}

export async function apurarAusentes(candidatos, { fetchFonte, tenant }) {
  const porId = new Map(candidatos.map(c => [idDaUrl(c.url_lote), c]).filter(([k]) => k));
  if (!porId.size) return [];
  const url = `${tenant.base}/rest/v1/lots?id=in.(${[...porId.keys()].join(',')})&select=id,status,bid_count,highest_bid_value,cancelled_at`;
  const { html, via } = await fetchFonte(url);
  if (!html) throw new Error(`apuração Ares não leu a API: ${via}`);
  const lotes = JSON.parse(html);
  if (!Array.isArray(lotes)) throw new Error('apuração Ares: resposta não é lista');
  return lotes.map(l => ({ cand: porId.get(l.id), achado: desfechoAres(l), status: l.status })).filter(x => x.cand);
}

// O catálogo traz bens diversos e veículos junto: só categoria de imóvel entra na lista.
export function extrairUrlsDeLote(txt, base) {
  const urls = new Map();
  for (const l of lotes(txt)) if (l?.id && ehImovelCat(l.categories?.slug)) urls.set(l.id, urlLote(base, l.id));
  return urls;
}

export function detalhesDoCatalogo(txt, base) {
  const out = new Map();
  for (const l of lotes(txt)) if (l?.id && ehImovelCat(l.categories?.slug)) out.set(urlLote(base, l.id), detalheDoLote(l));
  return out;
}

// VEÍCULOS (21/10): o MESMO catálogo traz a categoria `veiculos` (Picelli 10, Cunha 1 — medido pelo banco).
const ehVeiculoCat = slug => /^veicul/i.test(String(slug || ''));
export function extrairUrlsDeVeiculo(txt, base) {
  const urls = new Map();
  for (const l of lotes(txt)) if (l?.id && ehVeiculoCat(l.categories?.slug)) urls.set(l.id, urlLote(base, l.id));
  return urls;
}
export function detalhesDoCatalogoVeiculo(txt, base) {
  const out = new Map();
  for (const l of lotes(txt)) if (l?.id && ehVeiculoCat(l.categories?.slug)) out.set(urlLote(base, l.id), detalheDoLote(l));
  return out;
}

const DIA = 864e5;
const semAcento = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
// Atributos ESTRUTURADOS do lote (category_attributes): "Matrícula", "Área privativa", "Área útil"…
// O valor vem em texto do jeito que o leiloeiro digitou ("136.514 ", "64,50").
function atributos(l) {
  const out = new Map();
  for (const a of Array.isArray(l.lot_attributes) ? l.lot_attributes : []) {
    const nome = semAcento(a?.category_attributes?.name), v = String(a?.value ?? '').trim();
    if (nome && v && !out.has(nome)) out.set(nome, v);
  }
  return out;
}
const areaDoAtributo = (v) => extrairAreaM2(`${v} m²`, { permitirSolta: true });
// Área tirada do TEXTO: em apartamento, número acima de 1.000 m² é o terreno do condomínio (Bertioga,
// 13/10: "Fração ideal de 0,78125% do TERRENO … área total de 6.629,90 m²" e nenhuma área da unidade).
// Área desconhecida é melhor que área do prédio inteiro — ela some do R$/m² em vez de distorcê-lo.
function areaDoTexto(titulo, desc, tipo) {
  const a = extrairAreaM2(titulo || '') || extrairAreaM2(desc || '') || 0;
  return tipo === 'apartamento' && a > 1000 ? 0 : a;
}
// Lote sem city_id/state_id (Picelli, Serra Negra): o endereço do Google traz "…, Cidade - UF, Brasil"
// ou "979M+XVW Serra Negra, SP" (Plus Code na frente — tirado antes).
export function cidadeDoEndereco(endereco) {
  const t = String(endereco || '').replace(/\b[0-9A-Z]{4,8}\+[0-9A-Z]{2,3}\b/g, ' ').replace(/,?\s*Brasil\s*$/i, '').trim();
  const ms = [...t.matchAll(/(?:^|[,\-–]\s*)([A-ZÀ-Ú][A-Za-zÀ-ú'. ]{1,40}?)\s*[,\-–]\s*([A-Z]{2})\b/g)];
  const m = ms[ms.length - 1];
  return m ? { cidade: m[1].trim(), uf: m[2] } : { cidade: null, uf: null };
}
// Ordem do que baliza R$/m²: privativa > útil > construída > total > terreno.
const AREAS = ['area privativa', 'area util', 'area construida', 'area construida (m2)', 'area construida (m²)', 'area total', 'area terreno'];
const diaBR = iso => { const d = new Date(iso); return Number.isNaN(+d) ? null : new Date(+d - 3 * 3600e3).toISOString().slice(0, 10); };

export function detalheDoLote(l, agora = Date.now()) {
  const fases = (Array.isArray(l.lot_phases) ? l.lot_phases : [])
    .filter(f => f?.end_date).sort((a, b) => num(a.phase_order) - num(b.phase_order));
  const ultima = fases.length ? Math.max(...fases.map(f => +new Date(f.end_date))) : NaN;
  // Vigente = a 1ª praça que ainda não fechou; a seguinte (se houver) vira a 2ª.
  const iVig = fases.findIndex(f => +new Date(f.end_date) >= agora - DIA / 24);
  const vig = iVig >= 0 ? fases[iVig] : null, prox = iVig >= 0 ? fases[iVig + 1] : null;
  const desc = stripHtml(l.description);
  const attrs = atributos(l);
  // A CATEGORIA da plataforma decide o que ela sabe dizer: "Áreas ou glebas" é terreno (o texto "gleba"
  // fazia o inferidor dizer rural — Campinas, 22.918 m², urbano); "Imóveis rurais" é rural. O resto
  // (residencial/comercial) o título detalha melhor: apartamento, casa, sala, galpão.
  const slugCat = String(l.categories?.slug || '');
  const tipo = /^areas_ou_glebas/.test(slugCat) && !/\b(fazenda|s[ií]tio|ch[áa]cara|rural)\b/i.test(l.title || '') ? 'terreno'
    : /^imoveis_rurais/.test(slugCat) ? 'rural'
    : (() => {
      const t = inferirTipo(`${l.categories?.name || ''} ${l.title || ''}`, '');
      // Título genérico ("Imóveis comerciais | Prox. Parque Municipal"): a categoria vira o padrão.
      return t !== 'outros' ? t : /^imoveis_comerciais/.test(slugCat) ? 'comercial' : t;
    })();
  const local = (l.cities?.name && l.states?.code) ? {} : cidadeDoEndereco(l.address);
  const avaliacao = plaus(num(l.evaluation_value)) || plaus(num(fases[0]?.initial_value));
  const minimo = plaus(num(vig?.initial_value)) || avaliacao;
  const minimo2 = prox ? plaus(num(prox.initial_value)) : 0;
  const tipoLeilao = String(l.auctions?.auction_type || '');
  const modalidade = /judicial/i.test(tipoLeilao) && !/extra/i.test(tipoLeilao) ? 'judicial'
    : /venda direta/i.test(tipoLeilao) ? 'venda_direta' : 'extrajudicial';
  const imagens = (Array.isArray(l.lot_images) ? l.lot_images : [])
    .sort((a, b) => num(a.display_order) - num(b.display_order)).map(i => i?.image_url).filter(Boolean);
  const fotos = [...new Set([l.featured_image_url, ...imagens].filter(Boolean))];
  const docs = (Array.isArray(l.lot_documents) ? l.lot_documents : []).filter(d => d?.file_url);
  const docDe = tipo => docs.find(d => d.document_type === tipo)?.file_url || null;
  const TIPO_ANEXO = { edital: 'edital', matricula: 'matricula', avaliacao: 'laudo' };
  const lat = num(l.latitude), lon = num(l.longitude);
  const coordOk = lat < 6 && lat > -34 && lon < -28 && lon > -74 && lat !== 0 && lon !== 0;
  return {
    id: l.id,
    titulo: String(l.title || '').trim() || null,
    descricao: desc.slice(0, 8000) || null,
    cidade: l.cities?.name || local.cidade, estado: l.states?.code || local.uf,
    endereco: String(l.address || '').trim() || null,
    latitude: coordOk ? lat : null, longitude: coordOk ? lon : null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    data_leilao: vig ? diaBR(vig.end_date) : null,
    data_leilao_2: prox?.end_date ? new Date(prox.end_date).toISOString() : null,
    valor_minimo_2: minimo2 && minimo2 !== minimo ? minimo2 : null,
    modalidade, tipo,
    tipo_hint: `${l.categories?.name || ''} ${l.title || ''}`,
    area_m2: AREAS.map(k => attrs.get(k)).filter(Boolean).map(areaDoAtributo).find(v => v > 0)
      || areaDoTexto(l.title, desc, tipo),
    numero_matricula: (attrs.get('matricula') || '').replace(/[^\d.]/g, '').replace(/^\.+|\.+$/g, '') || numeroMatriculaDoTexto(desc),
    numero_processo: String(l.judicial_process_number || '').trim() || null,
    link_foto: fotos[0] || null, fotos,
    link_edital: docDe('edital'), link_matricula: docDe('matricula'),
    anexos: docs.map(d => ({ tipo: TIPO_ANEXO[d.document_type] || 'documento', nome: String(d.title || d.document_type || 'Documento').trim().slice(0, 120), url: d.file_url })),
    // Lote de teste e "Leads" com praça vencida: fora (não é oferta viva, mesmo marcado `aberto`).
    encerrado: !Number.isFinite(ultima) || ultima < agora - DIA / 24 || /^leads?$/i.test(tipoLeilao.trim()),
  };
}

export function montarRow(url, det, tenant) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${det.id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro}`,
    tipo: det.tipo || inferirTipo(det.tipo_hint || det.titulo || '', url), modalidade: det.modalidade,
    cidade: det.cidade, estado: det.estado, endereco: det.endereco, bairro: null,
    ...(det.latitude != null ? { latitude: det.latitude, longitude: det.longitude, geocod_nivel: 'endereco' } : {}),
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url, url_lote: url, link_foto: det.link_foto,
    ...(det.fotos?.length ? { fotos: det.fotos } : {}),
    numero_matricula: det.numero_matricula || null, link_matricula: det.link_matricula,
    numero_processo: det.numero_processo,
    anexos: det.anexos || [],
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

// O det vem pronto do catálogo; o motor nunca chama este (contrato do runner pede a função).
export function parseDetalhe() { return null; }

export { checarQualidade };
