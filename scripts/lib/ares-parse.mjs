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
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';

export const TENANTS = {
  picelli: {
    fonte: 'PICELLI', leiloeiro: 'Picelli Leilões', site: 'https://www.picellileiloes.com.br',
    base: 'https://api.picellileiloes.com.br', headers: { apikey: 'sb_publishable_Ekokc-7yTyPVUHWzAqQkGw_M6l6jAnj' },
  },
  shiokawa: {
    fonte: 'SHIOKAWA', leiloeiro: 'Shiokawa Leilões', site: 'https://www.shiokawaleiloes.com.br',
    base: 'https://api.shiokawaleiloes.com.br', headers: { apikey: 'sb_publishable_eBr5iSp_7jKGIj_8XO-lpw_68HjspXC' },
  },
};
const SITE_POR_API = new Map(Object.values(TENANTS).map(t => [t.base, t.site]));

export const SELECT = [
  'id', 'slug', 'title', 'description', 'status', 'evaluation_value', 'address', 'latitude', 'longitude',
  'judicial_process_number', 'judicial_court', 'featured_image_url',
  'cities(name)', 'states(code)', 'categories(slug,name)', 'auctions!fk_lots_auction_id(title,auction_type,status)',
  'lot_phases(phase_order,end_date,initial_value)', 'lot_images(image_url,display_order)', 'lot_documents(title,file_url,document_type)',
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

const DIA = 864e5;
const diaBR = iso => { const d = new Date(iso); return Number.isNaN(+d) ? null : new Date(+d - 3 * 3600e3).toISOString().slice(0, 10); };

export function detalheDoLote(l, agora = Date.now()) {
  const fases = (Array.isArray(l.lot_phases) ? l.lot_phases : [])
    .filter(f => f?.end_date).sort((a, b) => num(a.phase_order) - num(b.phase_order));
  const ultima = fases.length ? Math.max(...fases.map(f => +new Date(f.end_date))) : NaN;
  // Vigente = a 1ª praça que ainda não fechou; a seguinte (se houver) vira a 2ª.
  const iVig = fases.findIndex(f => +new Date(f.end_date) >= agora - DIA / 24);
  const vig = iVig >= 0 ? fases[iVig] : null, prox = iVig >= 0 ? fases[iVig + 1] : null;
  const desc = stripHtml(l.description);
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
    cidade: l.cities?.name || null, estado: l.states?.code || null,
    endereco: String(l.address || '').trim() || null,
    latitude: coordOk ? lat : null, longitude: coordOk ? lon : null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    data_leilao: vig ? diaBR(vig.end_date) : null,
    data_leilao_2: prox?.end_date ? new Date(prox.end_date).toISOString() : null,
    valor_minimo_2: minimo2 && minimo2 !== minimo ? minimo2 : null,
    modalidade,
    tipo_hint: `${l.categories?.name || ''} ${l.title || ''}`,
    area_m2: extrairArea(`${l.title || ''} ${desc}`) || 0,
    numero_matricula: numeroMatriculaDoTexto(desc),
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
    tipo: inferirTipo(det.tipo_hint || det.titulo || '', url), modalidade: det.modalidade,
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
