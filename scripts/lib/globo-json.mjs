/**
 * GLOBOLEILOES pelo JSON da própria página (29/09). O site é Inertia.js: cada página traz os dados
 * num atributo `data-page` (JSON com entidades HTML). Medido pelo banco (pg_net) no mesmo dia:
 *   /leiloes?category_id=N&page=P → props.initialLots = {data[10], total, last_page, current_page}
 *     categorias de imóvel: 1 Residenciais · 2 Comerciais · 3 Rurais · 5 Imóveis (4 = Outros: sapato, impressora…)
 *     ⚠️ a 5 nasceu depois (medido 21/10: 18 lotes, áreas para incorporação) e ficava de fora.
 *   /leiloes/<slug>/<id>          → props.lot = {images[], files[], street, zip_code, process_number…}
 * O coletor antigo (fonte `dom`) procurava links `<a href=/leiloes/lote-…>` no HTML renderizado e
 * achava 0 — os lotes estão no JSON, não em links. Tinha 6 lotes gravados, com cidade/tipo errados
 * (casa de Ubatuba gravada como "apartamento em Votorantim"); o site lista ~780 imóveis.
 * A plataforma AGREGA parceiros: `url` preenchida aponta para o site do leiloeiro parceiro
 * (balbinoleiloes.com.br, mercado.bomvalor.com.br); `url` nula = lote da própria Globo.
 */
import { decodificarEntidades, extrairAreaM2 } from '../../api/_texto-imovel.js';

export const FONTE = 'GLOBOLEILOES';
export const BASE = 'https://globoleiloes.com.br';
export const CATEGORIAS_IMOVEL = [1, 2, 3, 5];
const CDN = 'https://d1etsb4iun2r36.cloudfront.net/auctions';

const brl = (s) => Number(String(s ?? '').replace(/\./g, '').replace(',', '.')) || 0;
// A descrição vem com as tags ESCAPADAS dentro do JSON (&lt;p&gt;, medido): decodifica antes de
// tirar as tags, e de novo depois (texto com &amp;nbsp; etc.).
const texto = (html) => decodificarEntidades(decodificarEntidades(String(html || '')).replace(/<br\s*\/?>|<\/p>|<\/li>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

/** JSON do atributo data-page (entidades HTML decodificadas). null se a página não tiver. */
export function dataPage(html) {
  const m = String(html || '').match(/data-page="([^"]*)"/);
  if (!m) return null;
  const bruto = m[1].replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try { return JSON.parse(bruto); } catch { return null; } // padrao-ok: JSON inválido = página sem dados; quem chama trata o null como falha
}

export function lerListagem(html) {
  const j = dataPage(html);
  const p = j?.props?.initialLots;
  if (!p || !Array.isArray(p.data)) return null;
  return { lotes: p.data, pagina: Number(p.current_page) || 1, ultima: Number(p.last_page) || 1, total: Number(p.total) || 0 };
}

export function lerDetalhe(html) {
  const lot = dataPage(html)?.props?.lot;
  if (!lot) return null;
  const fotos = (lot.images || []).sort((a, b) => (a.order ?? 0) - (b.order ?? 0)).map((i) => i?.name && `${CDN}/lots/images/intern_${i.name}`).filter(Boolean);
  const anexos = (lot.files || []).map((f) => f?.file && { nome: String(f.name || 'Documento').slice(0, 120), url: `${CDN}/lots/files/${f.file}`, tipo: tipoDoc(f.name) }).filter(Boolean);
  return {
    fotos, anexos,
    endereco: String(lot.street || '').trim(), cep: /^\d{8}$/.test(String(lot.zip_code || '').replace(/\D/g, '')) ? String(lot.zip_code).replace(/\D/g, '') : null,
    processo: lot.process_number || null,
  };
}

function tipoDoc(nome) {
  if (/matr[íi]cula/i.test(nome)) return 'matricula';
  if (/edital/i.test(nome)) return 'edital';
  if (/avalia|laudo/i.test(nome)) return 'laudo';
  return 'outro';
}

const TIPO = [[/apart|flat|kitnet|cobertura/i, 'apartamento'], [/casa|sobrado|resid[êe]ncia/i, 'casa'],
  [/terreno|lote/i, 'terreno'], [/fazenda|s[íi]tio|ch[áa]cara|gleba|rural|[áa]rea rural/i, 'rural'],
  [/sala|loja|galp[ãa]o|pr[ée]dio|comercial|industrial|hotel|posto|box|garagem/i, 'comercial'], [/^[áa]rea$/i, 'terreno']];
export function tipoGlobo(lot) {
  const sub = String(lot?.subcategory?.name || '');
  const hit = TIPO.find(([re]) => re.test(sub))?.[1];
  if (hit) return hit;
  return { 1: 'casa', 2: 'comercial', 3: 'rural' }[Number(lot?.category_id)] || 'imovel';
}

// Praça vigente: status 1 (aberta); se nenhuma aberta, a próxima futura (status 0). Encerradas (2)
// não servem — lance mínimo de praça que já passou é o erro que a WEBLEILOES cometia.
export function pracaAtual(lot) {
  const v = Array.isArray(lot?.values) ? lot.values : [];
  return v.find((x) => Number(x.status) === 1) || v.filter((x) => Number(x.status) === 0).sort((a, b) => Date.parse(a.start) - Date.parse(b.start))[0] || null;
}

// IDENTIDADE DO IMÓVEL (28/10, #374): a Globo REAPROVEITA o id do lote para outro imóvel. Com a chave `globoleiloes_<id>`
// o upsert trocava título/URL/valor e os gatilhos de preservação seguravam o resto do imóvel antigo (descrição, área,
// endereço, matrícula, anexos, pino) — 245 lotes ativos com imóvel fantasma. A URL do lote é a identidade: mudou, é
// outro imóvel. Normalizada para não confundir http×https, www, barra final e query com troca de imóvel.
export function identidadeLoteGlobo(url) {
  if (!url) return null;
  return String(url).trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

const LEILOEIROS = { 'balbinoleiloes.com.br': 'Balbino Leilões', 'bomvalor.com.br': 'Bom Valor', 'comprei.pgfn.gov.br': 'PGFN — Comprei' };
export function leiloeiroGlobo(lot) {
  if (!lot?.url) return 'Globo Leilões';
  let host = '';
  try { host = new URL(lot.url).hostname.replace(/^(www|mercado)\./, ''); } catch { return 'Globo Leilões'; }
  return LEILOEIROS[host] || host;
}

// Área total do slug BomValor: "-a-t-330-m-" = 330 m² · "-a-t-1-302-m-" = 1.302 m² (milhar) · "-a-t-45-99-m-" = 45,99 m².
export function areaDaUrlBomValor(url) {
  const m = String(url || '').match(/-a-t-(\d{1,3})(?:-(\d{1,3}))?-m(?:-|$)/);
  if (!m) return 0;
  if (!m[2]) return Number(m[1]);
  return m[2].length === 3 ? Number(m[1] + m[2]) : Number(`${m[1]}.${m[2]}`);
}

/** Linha de imoveis_leilao. `det` = lerDetalhe() do lote (só lotes próprios), ou null. */
export function montarRowGlobo(lot, det = null) {
  const praca = pracaAtual(lot);
  const titulo = String(lot.full_title || lot.title || '').replace(/^Lote\s+\d+\s*-\s*/i, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const descricao = texto(lot.description).slice(0, 8000);
  const extrajudicial = /extrajudicial/i.test(`${lot?.partner?.type?.slug || ''} ${descricao.slice(0, 3000)}`);
  const fotoParceiro = lot.photo ? [`${CDN}/partners/lots/${lot.photo}`] : [];
  const fotos = det?.fotos?.length ? det.fotos : fotoParceiro;
  const anexos = det?.anexos || [];
  const row = {
    fonte: FONTE, fonte_id: `globoleiloes_${lot.id}`,
    titulo, tipo: tipoGlobo(lot),
    modalidade: extrajudicial ? 'extrajudicial' : 'judicial',
    cidade: lot.city || null, estado: /^[A-Z]{2}$/.test(String(lot.uf || '')) ? lot.uf : null,
    bairro: lot.neighborhood || '', endereco: det?.endereco || '',
    // Avaliação ATUALIZADA: na 1ª praça judicial o lance mínimo é a avaliação corrigida, e `avaliation`
    // é o laudo original (dry-run 29/09: laudo R$ 121.000, 1ª praça R$ 127.424). Sem isto o catálogo
    // mostraria "desconto" negativo. Vale a maior entre o laudo e as praças.
    valor_avaliacao: Math.max(brl(lot.avaliation), ...(Array.isArray(lot.values) ? lot.values.map((x) => brl(x.price)) : [0])),
    valor_minimo: praca ? brl(praca.price) : 0,
    // Parceiro BomValor não manda descrição (250 de 250 em 28/10) e o título raramente tem m²: a URL tem ("-a-t-330-m-").
    area_m2: extrairAreaM2(titulo) || areaDaUrlBomValor(lot.url) || extrairAreaM2(descricao) || 0,
    descricao,
    url_lote: lot.url || `${BASE}/leiloes/${lot.slug}/${lot.id}`,
    leiloeiro: leiloeiroGlobo(lot),
    data_leilao: praca?.end || null, forma_pagamento: 'a_vista',
    ativo: true, suprimido_motivo: null, atualizado_em: new Date().toISOString(),
  };
  if (det?.cep) row.cep = det.cep;
  // Foto/anexos só entram quando lidos — lote não relido nesta rodada mantém os da anterior.
  if (fotos.length) { row.link_foto = fotos[0]; row.fotos = fotos; }
  if (anexos.length) {
    row.anexos = anexos;
    row.link_matricula = anexos.find((a) => a.tipo === 'matricula')?.url || null;
    row.link_edital = anexos.find((a) => a.tipo === 'edital')?.url || null;
  }
  return row;
}
