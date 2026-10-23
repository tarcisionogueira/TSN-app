/**
 * Parser puro — LEILÃO ELETRÔNICO (leilaoeletronico.com.br; leiloeiros André Zalcman JUCESP 1590 e Felipe
 * Rodrigues de Souza JUCESP 1462). Plataforma "Sua Plataforma de Leilão" (Degrau), a mesma de MGL/Viva/Franco,
 * mas SEM Cloudflare: o feed e as páginas abrem pela via grátis (medido 23/10 pelo banco: HTTP 200). Pendência 307.
 *
 * DUAS FONTES DE DADO, porque nenhuma basta sozinha (medido 23/10 no lote 2653):
 *  - FEED `/sitemap.xml` (`<listing>`, ver lib/degrau-feed.mjs): cidade, estado, bairro, coordenadas, fotos,
 *    avaliação (`<price>`) e, POR PRAÇA, fim e lance mínimo (`<available_dates_price_config>`). Na página, as
 *    praças (abertura, fechamento, lance) são preenchidas por JavaScript e chegam VAZIAS no HTML.
 *  - PÁGINA do lote: título (breadcrumb), modalidade (h1), avaliação, área, descrição, documentos e endereço.
 *  A enumeração guarda o item do feed em FEED (por id) e o parseDetalhe junta os dois. Os dois rodam no
 *  mesmo processo (o runner sempre enumera antes de abrir o detalhe).
 *
 * ⚠️ O JSON-LD da página NÃO é deste lote: no 2653 (casa de R$ 18 mi em Santana de Parnaíba) ele descrevia o
 *    2219 (terreno em Itapecerica da Serra, R$ 2,7 mi) — bloco copiado entre páginas. Não é lido.
 * ⚠️ `<rate>` vem em DOIS formatos no mesmo feed: "15000000,00 BRL" (reais) e "169390200 BRL" (CENTAVOS —
 *    lote 2419: price 1693902,00, 1ª praça 169390200 = a avaliação, 2ª 84695100 = 50%). Sem vírgula = centavos.
 */
import { lotesDoFeed, ehFeedDegrau } from './degrau-feed.mjs';
import { naoImovelDoFeed } from './mgl-parse.mjs';
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, titleCase, montarRowDom, UF_POR_NOME } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const TENANTS = {
  leilaoeletronico: { fonte: 'LEILAOELETRONICO', leiloeiro: 'Leilão Eletrônico', base: 'https://www.leilaoeletronico.com.br', catalogo: '/sitemap.xml' },
};

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
  .replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim();
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const ufDoNome = (nome) => UF_POR_NOME[semAcento(nome).trim().replace(/\s+/g, '-')] || null;

// "15000000,00 BRL" → 15000000 · "169390200 BRL" → 1693902 (centavos).
export function valorDoFeed(s) {
  const t = String(s || '').replace(/[^\d,]/g, '');
  if (!t) return 0;
  return t.includes(',') ? num(t) : Number(t) / 100;
}

// Item do feed → dados por id. Guarda TODOS (abertos e encerrados): um lote do acervo que saiu do feed ou só tem
// praça vencida é "encerrado" no detalhe.
export function itensDoFeed(xml) {
  const out = new Map();
  for (const [, item] of String(xml || '').matchAll(/<listing>([\s\S]*?)<\/listing>/gi)) {
    const u = (item.match(/<url>\s*([^<\s]*\/lote\/[^<\s/]+\/(\d+)\/?)\s*<\/url>/i) || []);
    if (!u[2]) continue;
    const tag = (n) => limpo((item.match(new RegExp(`<${n}>([\\s\\S]*?)</${n}>`, 'i')) || [])[1]);
    const comp = (n) => limpo((item.match(new RegExp(`<component name="${n}">([\\s\\S]*?)</component>`, 'i')) || [])[1]);
    const lat = Number.parseFloat(tag('latitude')), lng = Number.parseFloat(tag('longitude'));
    const coordOk = lat < 6 && lat > -34 && lng < -28 && lng > -74 && lat !== 0 && lng !== 0;
    const pracas = [...item.matchAll(/<available_dates_price_config>([\s\S]*?)<\/available_dates_price_config>/gi)].map(([, p]) => ({
      fim: (p.match(/<end_date>\s*([\d-]+T[\d:]+)/i) || [])[1] || null,
      valor: valorDoFeed((p.match(/<rate>([^<]*)<\/rate>/i) || [])[1]),
    })).filter((p) => p.fim).sort((a, b) => a.fim.localeCompare(b.fim));
    out.set(u[2], {
      url: u[1], modalidade: tag('name'), cidade: comp('city') || null, estado: ufDoNome(comp('region')),
      bairro: tag('neighborhood') || null, latitude: coordOk ? lat : null, longitude: coordOk ? lng : null,
      fotos: [...new Set([...item.matchAll(/<image>\s*<url>\s*([^<\s]+)\s*<\/url>/gi)].map((m) => m[1]))],
      avaliacao: valorDoFeed(tag('price')), pracas,
    });
  }
  return out;
}

const FEED = new Map();

export function extrairUrlsDeLote(html, base) {
  if (!ehFeedDegrau(html)) return new Map();
  for (const [id, it] of itensDoFeed(html)) FEED.set(id, it);
  return lotesDoFeed(html, base, { descartar: naoImovelDoFeed });
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/[^/]+\/(\d+)/) || [])[1] || null;

// Praça vigente = a primeira que ainda não fechou; a seguinte vira a 2ª (mesmo critério do ares-parse).
// O feed traz hora local de Brasília sem fuso.
function pracasVigentes(pracas, agoraISO) {
  const i = pracas.findIndex((p) => p.fim >= agoraISO);
  const vig = i >= 0 ? pracas[i] : pracas[pracas.length - 1] || null;
  const prox = i >= 0 ? pracas[i + 1] || null : null;
  return { vig, prox, encerrado: pracas.length > 0 && i < 0 };
}

function modalidadeDe(s) {
  const t = semAcento(s);
  if (/venda direta/.test(t)) return 'venda_direta';
  if (/extrajudicial|particular/.test(t)) return 'extrajudicial';
  if (/judicial/.test(t)) return 'judicial';
  return 'extrajudicial';
}

const secao = (h, id) => (h.match(new RegExp(`<section[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)</section>`, 'i')) || [])[1] || '';

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const id = idDaUrl(url);
  const feed = FEED.get(id) || null;

  // Título = último item do breadcrumb ("Leilão de Casa de Alto Padrão, em Santana de Parnaíba/SP EXTRAJUDICIAL").
  // O 1º <nav> da página é o menu do topo: o breadcrumb é a lista que começa em "Home".
  const bc = [...((h.match(/>\s*Home\s*<\/a>\s*<\/li>([\s\S]*?)<\/ul>/i) || [])[1] || '').matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map((m) => limpo(m[1]));
  const tituloCru = bc.length ? bc[bc.length - 1] : '';
  const titulo = tituloCru.replace(/\s+(EXTRAJUDICIAL|JUDICIAL|VENDA DIRETA|PARTICULAR)\s*$/i, '')
    .replace(/^Leil+[ãa]o\s+(de|do|da)\s+/i, '').replace(/^\w/, (c) => c.toUpperCase()).slice(0, 180) || null;
  const h1 = limpo((h.match(/<h1[^>]*>\s*<span[^>]*>([\s\S]*?)<\/span>/i) || [])[1]);

  const avalPagina = plaus(num((h.match(/Avalia[çc][ãa]o:\s*<\/span>\s*<strong[^>]*>\s*R\$\s*([\d.,]+)/i) || [])[1]));

  // Área: os cartões de "Informações" (title="ÁREA CONSTRUÍDA" / "ÁREA ÚTIL" / "ÁREA DO TERRENO"…). Construída/útil
  // antes de terreno; sem cartão, o extrator central lê a descrição.
  const cards = [...secao(h, 'dg-lote-informacoes').matchAll(/title=["']([^"']+)["'][\s\S]*?<span>\s*<span[^>]*>([^<]+)<\/span>/gi)]
    .map(([, t, v]) => ({ t: semAcento(decodificarEntidades(t)), v: decodificarEntidades(v).trim() }));
  const areaCard = ['construida', 'util', 'privativa', 'total', 'terreno']
    .map((k) => cards.find((c) => c.t.includes('area') && c.t.includes(k))).filter(Boolean)
    .map((c) => extrairArea(`${c.v.replace(/m\s*$/i, 'm²')}`, '')).find((v) => v > 0) || 0;

  const descricao = limpo(secao(h, 'dg-lote-descricao').replace(/<h2[\s\S]*?<\/h2>/i, '')).slice(0, 8000) || null;
  const endereco = limpo((secao(h, 'dg-lote-local').replace(/<h3[\s\S]*?<\/h3>/i, '').match(/<div[^>]*>\s*([^<]{6,200}?)\s*<\/div>/) || [])[1]) || null;

  const anexos = [...secao(h, 'dg-lote-documentos').matchAll(/<li[^>]*>\s*([^<]+?)\s*<a[\s\S]*?<\/li>/gi)].flatMap(([bloco, nome]) => {
    const dl = (bloco.match(/href=["']([^"']*\/download\/[^"']+)["']/i) || [])[1];
    if (!dl) return [];
    const n = limpo(nome);
    const tipo = /matr[íi]cula/i.test(n) ? 'matricula' : /edital/i.test(n) ? 'edital' : /laudo|avalia/i.test(n) ? 'laudo' : 'outro';
    let abs; try { abs = new URL(dl, url).href; } catch { return []; }
    return [{ tipo, nome: n.slice(0, 120) || 'Documento', url: abs }];
  });

  const mat = (String(descricao || '').match(/matr[íi]cula(?:\s+imobili[áa]ria)?\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const proc = (String(descricao || '').match(/\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/) || [])[1] || null;

  // Datas e lances só do feed (na página vêm vazios). Lote fora do feed lido nesta rodada = saiu do site.
  const agoraISO = new Date(+agora - 3 * 3600e3).toISOString().slice(0, 19);
  const { vig, prox, encerrado } = pracasVigentes(feed?.pracas || [], agoraISO);
  const avaliacao = avalPagina || plaus(feed?.avaliacao) || plaus(feed?.pracas?.[0]?.valor);
  const minimo = plaus(vig?.valor) || avaliacao;
  const minimo2 = prox ? plaus(prox.valor) : 0;

  // Cidade/UF: o feed (campos próprios) vence o texto; sem feed, o "Cidade/UF" do título.
  const doTitulo = (tituloCru.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)\s*\/\s*([A-Z]{2})\b/) || []);
  const cidade = feed?.cidade || (doTitulo[1] ? titleCase(doTitulo[1].replace(/^.*\bem\s+/i, '')) : null);
  const estado = feed?.estado || doTitulo[2] || null;

  return {
    titulo, cidade, estado, endereco, bairro: feed?.bairro || null,
    latitude: feed?.latitude ?? null, longitude: feed?.longitude ?? null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    valor_minimo_2: minimo2 && minimo2 !== minimo ? minimo2 : null,
    data_leilao: vig?.fim ? vig.fim.slice(0, 10) : null,
    data_leilao_2: prox?.fim ? new Date(`${prox.fim}-03:00`).toISOString() : null,
    modalidade: modalidadeDe(h1 || feed?.modalidade || tituloCru),
    area_m2: areaCard || extrairArea(titulo || '', descricao || ''),
    descricao, numero_matricula: mat, numero_processo: proc, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: feed?.fotos?.[0] || null, fotos: feed?.fotos || [],
    encerrado: FEED.size > 0 && (!feed || encerrado),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  endereco: det.endereco || null, bairro: det.bairro || null, numero_processo: det.numero_processo || null,
  valor_minimo_2: det.valor_minimo_2 || null,
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
  ...(det.latitude != null ? { latitude: det.latitude, longitude: det.longitude, geocod_nivel: 'endereco' } : {}),
});
export { checarQualidade };
