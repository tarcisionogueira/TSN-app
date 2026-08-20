/**
 * Parser puro da plataforma "LeilãoPro Core" (artisticweb/leilaodetran, SSR) — usada por
 * leffaleiloes e oscarleiloes. SEM deps de supabase/brightdata: é importado TANTO pelo
 * scraper de produção QUANTO pelo validador de recon (mesma lógica nos dois lados).
 *
 * ESTRUTURA (recon 20/08, lote leffa 7208 — apto em Torres/RS, golden record):
 *   • Listagem por categoria: /leilao/lotes/imoveis (SSR, página única, sem ?pagina).
 *   • Lote:  /leilao/<slug>/lote_id/<ID>.
 *   • og:title / og:description = título COMPLETO com área e "…CIDADE DE <cidade>/<UF>".
 *   • og:image = foto.
 *   • PREÇO POR RÓTULO (não adivinhar — lição emiliomatos):
 *       "LANCE INICIAL"            → 1º leilão  = avaliação   (ex.: R$ 1.180.000,00)
 *       "LANCE INICIAL 2º LEILÃO"  → 2º leilão  = lance mínimo (ex.: R$ 590.000,00 ≈ 50%)
 *       "INCREMENTO MÍNIMO" (R$ 1.000) e a CAUÇÃO de 10% (R$ 118.000) → IGNORADOS.
 *     Sem 2º leilão → mínimo = avaliação (desconto 0).
 *   • Modalidade: "Processo"/"Judicial"/"Juiz" → judicial; "venda direta" → venda_direta.
 *   • Docs: /uploads/media/documentos_leilao/… (edital) e /documentos_bem/… (matrícula/laudo).
 */
import { extrairGenerico, checarQualidade } from './scraper-core.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

// Tenants da plataforma (fonte por LEILOEIRO — o monitor aprende baseline por fonte).
export const TENANTS = {
  leffa: { fonte: 'LEFFA', leiloeiro: 'Leffa Leilões', base: 'https://www.leffaleiloes.com.br' },
  oscar: { fonte: 'OSCAR', leiloeiro: 'Oscar Leilões', base: 'https://www.oscar.leilao.br' },
};

const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
const titleCase = s => String(s || '').toLowerCase().replace(/(^|\s|'|-)([a-zà-ú])/g, (_, a, b) => a + b.toUpperCase())
  .replace(/\b(De|Do|Da|Dos|Das|E)\b/g, m => m.toLowerCase()).replace(/^\w/, c => c.toUpperCase());

export function inferirTipo(titulo = '', url = '') {
  const t = (titulo + ' ' + url).toLowerCase();
  if (/apartament|apto|flat|kitnet|studio|cobertura/.test(t)) return 'apartamento';
  if (/fazenda|s[íi]tio|ch[áa]cara|rural|gleba/.test(t)) return 'rural';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/sala|loja|comercial|gal[pã]|pr[ée]dio|escrit[óo]rio|andar|industrial|barrac/.test(t)) return 'comercial';
  if (/terreno|lote|[áa]rea\s+de\s+terra|\bterra\b/.test(t)) return 'terreno';
  return 'outros';
}

// Links de lote na listagem: /leilao/<slug>/lote_id/<ID>. Retorna Map id→url absoluta.
export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of html.matchAll(/href=["'](\/leilao\/[^"']*?\/lote_id\/(\d+))["']/gi)) {
    try { urls.set(m[2], new URL(decodificarEntidades(m[1]), base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lote_id\/(\d+)/) || [])[1] || null;

// Cidade/UF do TÍTULO. Formato LeilãoPro: "…CIDADE DE <cidade>/<UF>" ou "…MUNICÍPIO DE <cidade>/<UF>".
// Fallback: último "<Cidade>/<UF>" solto (1–3 palavras), sem conector inicial. O foro ("Comarca…/UF")
// é raro no título (mora no corpo), mas o filtro abaixo o evita mesmo assim.
export function cidadeUF(titulo = '', descricao = '') {
  // Classe de palavra de cidade inclui HÍFEN — senão "Xangri-Lá/RS" capturava só "Lá" (20/08).
  const fontes = [titulo, descricao];
  for (const s of fontes) {
    const m = String(s || '').match(/(?:cidade|munic[íi]pio)\s+de\s+([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+[A-Za-zÀ-ÿ'.\-]+){0,4}?)\s*\/\s*([A-Z]{2})\b/i);
    if (m) return { cidade: titleCase(m[1].trim()).slice(0, 60), estado: m[2].toUpperCase() };
  }
  for (const s of fontes) {
    const limpo = String(s || '').replace(/\b(?:comarca|vara|tribunal|foro|ju[íi]zo)[^/]{0,40}?\/\s*[A-Z]{2}\b/gi, ' ');
    const ms = [...limpo.matchAll(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+(?:de|do|da|dos|das|e|[A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+)){0,3})\s*\/\s*([A-Z]{2})\b/g)];
    if (ms.length) {
      const m = ms[ms.length - 1];
      return { cidade: titleCase(m[1].trim().replace(/^(?:de|do|da|dos|das|e)\s+/i, '')).slice(0, 60), estado: m[2].toUpperCase() };
    }
  }
  return { cidade: null, estado: null };
}

// Área: primeiro m² do título/descrição ("ÁREA REAL PRIVATIVA DE 103,250M²", "MEDINDO 1.575,00m²",
// "ÁREA DE 300M²"). Comma = decimal; ponto = milhar (num() cuida das duas).
export function extrairArea(titulo = '', descricao = '') {
  const s = `${titulo} ${descricao}`;
  // Sem \b no fim: "²" é não-palavra, então \b nunca assertaria após "m²" e a área saía 0.
  const m = s.match(/([\d]{1,3}(?:\.\d{3})*(?:,\d+)?|\d+(?:,\d+)?)\s*m\s*[²2]/i);
  return m ? num(m[1]) : 0;
}

const limparTitulo = t => decodificarEntidades(t || '')
  .replace(/\s*[-–|]\s*(?:LEFFA|OSCAR)\s+LEIL[ÕO]ES.*$/i, '')
  .replace(/\s+/g, ' ').trim();

// Datas de praça (dd/mm/20aa) para o status. (Só 20xx — evita "1º"/CEPs.)
function datasPraca(txt) {
  const ds = [];
  for (const m of txt.matchAll(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/g)) {
    const d = new Date(+m[3], +m[2] - 1, +m[1]); if (!isNaN(d)) ds.push(d);
  }
  return ds;
}
// true = leilão morto. DATA MANDA: praça futura → vivo (ainda que a 1ª já tenha passado).
export function estaEncerrado(txt, agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const datas = datasPraca(txt);
  if (datas.some(d => d >= hoje)) return false;
  const arrematado = /arrematad|vendido|deserto|cancelad|suspenso/i.test(txt);
  const temAberto = /recebendo\s*lances|em\s*andamento|aberto\s*para\s*lances|aceita(?:ndo)?\s*lances|agendad/i.test(txt);
  if (arrematado && !temAberto) return true;
  if (datas.length && !datas.some(d => d >= hoje)) return true;
  return /encerrad/i.test(txt) && !temAberto;
}
// Data do próximo leilão: a mais próxima no futuro; se todas passadas, a mais recente.
function proximaData(txt, agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const datas = datasPraca(txt).sort((a, b) => a - b);
  if (!datas.length) return null;
  const fut = datas.find(d => d >= hoje);
  const d = fut || datas[datas.length - 1];
  return d.toISOString().slice(0, 10);
}

export function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  const titulo = limparTitulo(base.titulo);
  const descricao = decodificarEntidades(base.descricao || '');
  const txt = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  // PREÇO POR RÓTULO: "LANCE INICIAL" (1º) e "LANCE INICIAL 2º LEILÃO" (2º). Nunca max/min cego.
  const precos = [];
  for (const m of txt.matchAll(/lance\s*inicial(?:\s*(\d)\s*[º°ª]?\s*leil[ãa]o)?[^R]{0,30}R\$\s*([\d.]+,\d{2})/gi)) {
    precos.push({ leilao: m[1] ? Number(m[1]) : 1, valor: num(m[2]) });
  }
  const p1 = precos.find(p => p.leilao === 1);
  const p2 = precos.find(p => p.leilao === 2);
  let avaliacao = plaus(p1?.valor || 0);
  // Rótulo "Avaliação" explícito tem prioridade sobre o lance inicial do 1º leilão, se existir.
  const avalExpl = plaus(num((txt.match(/avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  if (avalExpl) avaliacao = avalExpl;
  let minimo = plaus(p2?.valor || 0) || avaliacao;
  if (!avaliacao && minimo) avaliacao = minimo;

  const modalidade = /processo\s*n|\bju[íi]z\b|judicial/i.test(txt) && !/extrajudicial/i.test(txt) ? 'judicial'
    : /extrajudicial/i.test(txt) ? 'extrajudicial'
    : /venda\s*direta/i.test(txt) ? 'venda_direta' : 'extrajudicial';
  const area = extrairArea(titulo, descricao) || extrairArea(txt.slice(0, 400));
  const { cidade, estado } = cidadeUF(titulo, descricao);
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{4,})/i) || [])[1] || null;

  // Docs: PDFs de /uploads/media/documentos_leilao (edital) e /documentos_bem (matrícula/laudo).
  const anexos = [];
  let link_edital = null, link_matricula = null;
  for (const m of html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)) {
    let abs; try { abs = new URL(decodificarEntidades(m[1]), url).href; } catch { continue; }
    const low = abs.toLowerCase();
    const tipo = /documentos_leilao|edital/.test(low) ? 'edital'
      : /documentos_bem|matr[íi]cula|laudo/.test(low) ? 'matricula' : 'outro';
    if (anexos.some(a => a.url === abs)) continue;
    anexos.push({ tipo, nome: tipo === 'edital' ? 'Edital' : tipo === 'matricula' ? 'Matrícula / Laudo do bem' : 'Documento', url: abs });
    if (tipo === 'edital' && !link_edital) link_edital = abs;
    if (tipo === 'matricula' && !link_matricula) link_matricula = abs;
  }

  return {
    titulo: titulo.slice(0, 180) || null,
    cidade, estado, link_foto: base.link_foto || null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: (descricao || '').slice(0, 500) || null,
    data_leilao: proximaData(txt),
    numero_matricula: mat,
    link_edital, link_matricula, anexos,
    encerrado: estaEncerrado(txt),
  };
}

export function montarRow(url, det, tenant) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url) || String(url).split('/').filter(Boolean).pop();
  return {
    fonte: tenant.fonte, fonte_id: `${tenant.fonte.toLowerCase()}_${id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro} ${id}`,
    tipo: inferirTipo(det.titulo || '', url),
    modalidade: det.modalidade,
    cidade: det.cidade || null, estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url, url_lote: url, link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula, link_matricula: det.link_matricula, anexos: det.anexos,
    leiloeiro: tenant.leiloeiro, data_leilao: det.data_leilao || null, forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

export { checarQualidade };
