/**
 * Parser puro do EMILIOMATOS (Superbid/MBV SSR) — SEM deps de supabase/brightdata, para
 * ser importado TANTO pelo scraper de produção QUANTO pelo validador de recon (mesma lógica
 * nos dois; nada de parser divergente entre o que valida e o que grava).
 *
 * PREÇO (mapeado no recon de 20/08, lote 98857): a página NÃO tem rótulo "Avaliação".
 * Mostra "OFERTA INICIAL À Vista R$ X" por PRAÇA (1ª praça ≈ avaliação; 2ª praça ≈ 50-60%)
 * e "Entrada de: R$ Y" / "+N Parcelas de R$ Z" (plano de pagamento — NÃO é o valor do lote).
 *   valor_avaliacao = maior OFERTA INICIAL (1ª praça)  |  valor_minimo = menor OFERTA (praça vigente)
 *   Se houver rótulo "Avaliação" explícito, ele tem prioridade.
 * STATUS: só ingerimos lote com praça ABERTA. "Praça Encerrada"/arrematado/deserto sem
 * nenhuma praça aberta/agendada = leilão morto → o scraper pula (não polui o acervo do cliente).
 */
import { extrairGenerico, extrairData, checarQualidade } from './scraper-core.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const FONTE = 'EMILIOMATOS';
export const LEILOEIRO = 'Emílio Matos Leilões';
export const BASE = 'https://emiliomatosleiloes.com.br';

const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;
const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;

export function inferirTipo(titulo = '', url = '') {
  const t = (titulo + ' ' + url).toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/fazenda|s[íi]tio|ch[áa]cara|rural/.test(t)) return 'rural';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio|andar|industrial/.test(t)) return 'comercial';
  if (/terreno|lote|gleba|[áa]rea/.test(t)) return 'terreno';
  return 'outros';
}

// Só lote INDIVIDUAL: /imoveis/<tipo>/<slug>-<ID> (exige subpath após /imoveis/).
// /imoveis-<slug>-<id> (sem barra) é carteira/rede (agrupa vários) → ignorado.
export function extrairUrlsDeLote(html, base = BASE) {
  const urls = new Map();
  for (const m of html.matchAll(/href=["'](\/imoveis\/[^"']+?-(\d{4,}))["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/-(\d{4,})(?:[/?#]|$)/) || [])[1] || String(url).replace(/[?#].*/, '').split('/').filter(Boolean).pop();

// Cidade/UF. Palavra de cidade = Capitalizada OU conector minúsculo (de/do/da/dos/das/e),
// para pegar "Águas Lindas de Goiás", "Três Corações". PRIORIDADE ao TÍTULO (formato
// Superbid "<desc>, Cidade/UF"): pega o ÚLTIMO "Cidade/UF" do título — o corpo tem "Comarca
// de Brasília/DF" (foro), que NÃO é a cidade do imóvel e enganava o parser antigo.
const RE_CIDADE_UF = /([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+(?:de|do|da|dos|das|e|[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+)){0,4})\s*\/\s*([A-Z]{2})\b/g;
function pegaCidade(str) {
  const ms = [...String(str || '').matchAll(RE_CIDADE_UF)];
  if (!ms.length) return null;
  const m = ms[ms.length - 1];   // no título, o par cidade/UF fica no fim
  return { cidade: m[1].trim().replace(/\s+/g, ' ').replace(/^(?:de|do|da|dos|das|e)\s+/i, '').slice(0, 60), estado: m[2].toUpperCase() };
}
function cidadeUF(txt, titulo = '') {
  // 1) do TÍTULO (fonte confiável da cidade do IMÓVEL)
  const noTitulo = pegaCidade(titulo);
  if (noTitulo) return noTitulo;
  // 2) fallback: corpo, ignorando o foro ("Comarca/Vara/Tribunal … de Cidade/UF")
  const limpo = String(txt || '').replace(/\b(?:comarca|vara|tribunal|foro|ju[íi]zo)[^.]{0,40}?\/\s*[A-Z]{2}\b/gi, ' ');
  const m = limpo.match(/\b(?:em|de|no|na)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+(?:de|do|da|dos|das|e|[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+)){0,4})\s*\/\s*([A-Z]{2})\b/);
  if (m) return { cidade: m[1].trim().replace(/\s+/g, ' ').replace(/^(?:de|do|da|dos|das|e)\s+/i, '').slice(0, 60), estado: m[2].toUpperCase() };
  // 2b) último recurso: 1º "Cidade/UF" solto no corpo já sem o foro
  RE_CIDADE_UF.lastIndex = 0;
  const bare = RE_CIDADE_UF.exec(limpo);
  if (bare) return { cidade: bare[1].trim().replace(/\s+/g, ' ').replace(/^(?:de|do|da|dos|das|e)\s+/i, '').slice(0, 60), estado: bare[2].toUpperCase() };
  return { cidade: null, estado: null };
}
const limparTitulo = t => (t || '').replace(/\s*[-–|]\s*(?:Lance Inicial|Avalia[çc][ãa]o|Valor|Emilio Matos|Emílio Matos).*$/i, '').replace(/\s+/g, ' ').trim();

const MESES = { jan: 0, fev: 1, mar: 2, abr: 3, mai: 4, jun: 5, jul: 6, ago: 7, set: 8, out: 9, nov: 10, dez: 11 };
// Datas de PRAÇA do texto (dd/mm/aaaa e "dd de mês de aaaa"). Foca no contexto de leilão/praça
// quando dá; senão pega todas. (Só 20xx — evita "1ª"/CEPs.)
function datasPraca(txt) {
  const ds = [];
  const push = (dd, mm, yy) => { const d = new Date(+yy, +mm - 1, +dd); if (!isNaN(d)) ds.push(d); };
  for (const m of txt.matchAll(/(\d{1,2})\/(\d{1,2})\/(20\d{2})/g)) push(m[1], m[2], m[3]);
  for (const m of txt.matchAll(/(\d{1,2})\s+de\s+([a-zç]{3,})\s+de\s+(20\d{2})/gi)) {
    const mes = MESES[m[2].toLowerCase().slice(0, 3)]; if (mes != null) push(m[1], mes + 1, m[3]);
  }
  return ds;
}
// true = leilão morto (NÃO ingerir). DATA MANDA: se há praça FUTURA, está vivo (ainda que a 1ª
// praça já tenha encerrado). Só é morto se todas as datas são passadas, ou arrematado/deserto
// sem sinal de praça aberta. (Bug de 20/08: lotes com 2ª praça em 08/09/2026 eram marcados
// encerrados porque a 1ª dizia "Praça Encerrada" — a data desempata.)
export function estaEncerrado(txt, agora = new Date()) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const datas = datasPraca(txt);
  if (datas.some(d => d >= hoje)) return false;            // praça futura → vivo
  const arrematado = /arrematad|vendido|deserto|cancelad|suspenso/i.test(txt);
  const temAberto = /recebendo\s*lances|em\s*andamento|aberto\s*para\s*lances|aceita(?:ndo)?\s*lances|agendad/i.test(txt);
  if (arrematado && !temAberto) return true;
  if (datas.length && !datas.some(d => d >= hoje)) return true;   // só datas passadas → morto
  // sem datas legíveis: cai no rótulo (conservador)
  const temMorto = /pra[çc]a\s*encerrada|leil[ãa]o\s*encerrado|encerrado/i.test(txt);
  return temMorto && !temAberto;
}

export function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  const txt = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  // OFERTAS INICIAIS (lance por praça). Exclui Entrada/Parcela por casar SÓ o rótulo "oferta".
  const ofertas = [];
  for (const m of txt.matchAll(/oferta\s*inicial[^R]{0,25}R\$\s*([\d.]+,\d{2})/gi)) ofertas.push(num(m[1]));
  if (!ofertas.length) for (const m of txt.matchAll(/lance\s*(?:inicial|m[íi]nimo|atual)[^R]{0,25}R\$\s*([\d.]+,\d{2})/gi)) ofertas.push(num(m[1]));
  const ofUnq = [...new Set(ofertas.map(plaus).filter(Boolean))];
  const aval = plaus(num((txt.match(/(?:avalia[çc][ãa]o|valor\s+de\s+avalia)[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const valor_avaliacao = aval || (ofUnq.length ? Math.max(...ofUnq) : 0);
  const valor_minimo = ofUnq.length ? Math.min(...ofUnq) : (aval || 0);

  const modalidade = /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : /extrajudicial/i.test(txt) ? 'extrajudicial'
    : /venda\s*direta/i.test(txt) ? 'venda_direta' : 'extrajudicial';
  const area = num((txt.match(/([\d.]+,\d{2}|\d+)\s*m[²2]\b/i) || [])[1]);
  const { cidade, estado } = cidadeUF(txt, base.titulo || '');
  const mat = (txt.match(/matr[íi]cula[^\d]{0,20}([\d.\-\/]{2,})/i) || [])[1] || null;

  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label)) {
      let abs; try { abs = new URL(href, url).href; } catch { continue; }
      docs.push({ url: abs, label: label.slice(0, 60) });
    }
  }
  const findDoc = re => (docs.find(d => re.test(d.label) || re.test(d.url)) || {}).url || null;
  const anexos = docs.map(d => ({ tipo: /matr[íi]cula/i.test(d.label + d.url) ? 'matricula' : (/edital/i.test(d.label + d.url) ? 'edital' : (/laudo/i.test(d.label + d.url) ? 'laudo' : 'outro')), nome: (d.label || 'Documento').slice(0, 80), url: d.url }));

  return {
    titulo: limparTitulo(base.titulo).slice(0, 180) || null,
    cidade, estado, link_foto: base.link_foto,
    valor_avaliacao, valor_minimo, ofertas: ofUnq,
    modalidade, area_m2: area,
    descricao: (base.descricao || '').slice(0, 500) || null,
    data_leilao: base.data_leilao || extrairData(html),
    numero_matricula: mat,
    link_edital: findDoc(/edital/i), link_matricula: findDoc(/matr[íi]cula/i),
    anexos,
    encerrado: estaEncerrado(txt),
  };
}

export function montarRow(url, det) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url);
  return {
    fonte: FONTE, fonte_id: `emiliomatos_${id}`,
    titulo: det.titulo || `Imóvel ${LEILOEIRO} ${id}`,
    tipo: inferirTipo(det.titulo || '', url),
    modalidade: det.modalidade,
    cidade: det.cidade || null, estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm, area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url, url_lote: url, link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula, link_matricula: det.link_matricula, anexos: det.anexos,
    leiloeiro: LEILOEIRO, data_leilao: det.data_leilao || null, forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

export { checarQualidade };
