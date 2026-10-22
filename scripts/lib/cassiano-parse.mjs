/**
 * Parser puro — GLENER BRASIL CASSIANO (leiloesbrasilcassiano.com.br, Django "smartweb"; leilões da Justiça do
 * Trabalho de Uberlândia, Ituiutaba, Uberaba, Araxá, Frutal + particulares). Triagem 22/10 (#292). HTML do servidor.
 *
 * ESTRUTURA (medida pelo banco em 22/10):
 *   • home: os leilões vigentes em `/leiloes/leilao/<slug>-<n>/` (a agenda pagina 130+ páginas de HISTÓRICO).
 *   • leilão: tabela "Todos os lotes do leilão" — cada linha abre `window.open('/leiloes/lote/<slug>/')`; o nome
 *     do lote é o PROCESSO ("PROCESSO Nº … AUTOR … RÉU …"), não o bem. Leilões mistos (imóvel, veículo, móveis):
 *     o motor descarta o que não é imóvel.
 *   • lote: "Descrição" (<h1 class="barra-interna">) com o bem por extenso (matrícula, área, "Comarca de X"),
 *     "Lanço Inicial: R$ …", "O leilão iniciará em: <span id="dia"> 05/11/2026", status em `#showstatus` e o
 *     edital em `/media/arquivos/lote/…pdf` ("Regulamento - Edital"). Sem avaliação na página.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, montarRowDom, cidadeUFBare, semPrefixoCidade, RE_IMG_DESCARTA } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const TENANTS = {
  cassiano: { fonte: 'CASSIANO', leiloeiro: 'Glener Brasil Cassiano', base: 'https://www.leiloesbrasilcassiano.com.br', catalogo: '/' },
};

export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href=["'](?:https?:\/\/[^/"']+)?(\/leiloes\/leilao\/([a-z0-9-]+)\/)["']/gi)) {
    try { out.set(m[2], new URL(m[1], base).href); } catch { /* url inválida: ignora */ }
  }
  return out;
}

export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/(?:window\.open\(\s*'|href=["'])(\/leiloes\/lote\/([a-z0-9-]+)\/)/gi)) {
    try { out.set(m[2], new URL(m[1], base).href); } catch { /* url inválida: ignora */ }
  }
  return out;
}
// O slug sai do texto do lote (processo/descrição) e passa de 200 caracteres: o id é o fim dele.
export const idDaUrl = (url) => { const m = String(url).match(/\/leiloes\/lote\/([a-z0-9-]+)/); return m ? m[1].slice(-60) : null; };

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const dataBr = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// "Comarca de Uberlândia.", "COMARCA DE TIROS (MG)", "SITUADO EM TIROS – MG", "Uberlândia/MG".
function cidadeUf(desc) {
  const d = String(desc || '');
  const m1 = d.match(/(?:comarca|munic[íi]pio|cidade)\s+de\s+([A-Za-zÀ-ÿ']+(?:\s+(?:de|do|da|dos|das)?\s*[A-Za-zÀ-ÿ']+){0,3}?)\s*(?:[/(–-]\s*([A-Z]{2})\b|[,.;)]|$)/i);
  if (m1) return { cidade: titleCase(m1[1].trim()), estado: m1[2] || 'MG' };
  const m2 = d.match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)\s*[/–-]\s*(MG|GO|SP)\b/);
  if (m2) return { cidade: titleCase(semPrefixoCidade(m2[1])), estado: m2[2] };
  return cidadeUFBare(d);
}

export function parseDetalhe(html, url) {
  const h = String(html || '');
  const raiz = `${new URL(url).origin}/`;
  const txt = decodificarEntidades(textoDe(h));
  const descricao = limpo((h.match(/Descri[çc][ãa]o\s*<\/h1>\s*<div[^>]*>([\s\S]*?)<\/div>/i) || [])[1]).slice(0, 4000) || null;
  // Não há título do bem: a 1ª oração da descrição faz esse papel ("imóvel matrícula nº 45.699, situado na…").
  const frase = (descricao || '').split(/(?<=[a-zà-ÿ\d)])[.;](?:\s|$)/)[0] || '';
  // Texto TODO em maiúsculas (comum nos editais) vira "Título Assim" — o card não grita.
  const fr = frase && frase === frase.toUpperCase() ? titleCase(frase) : frase;
  // Até a última vírgula antes de 90 caracteres: "Imóvel Rural Denominado Fazenda São Félix, Situado em Tiros – Mg".
  const corte = fr && fr.length > 90 ? (fr.slice(0, 90).lastIndexOf(', ') > 30 ? fr.slice(0, fr.slice(0, 90).lastIndexOf(', ')) : fr.slice(0, 90)) : fr;
  const titulo = corte ? (corte.charAt(0).toUpperCase() + corte.slice(1)).replace(/\s+[–-]\s+Mg\b/, '/MG') : null;
  const { cidade, estado } = cidadeUf(descricao);
  const minimo = plaus(num((txt.match(/Lan[çc]o Inicial\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const avaliacao = plaus(num((String(descricao || '').match(/avaliad[oa]s?\s+(?:em|por)\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const data = dataBr((h.match(/id=["']dia["'][^>]*>\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]);
  const status = limpo((h.match(/id=["']showstatus["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
  const mat = (String(descricao || '').match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const anexos = [];
  for (const m of h.matchAll(/<a\b[^>]*href=["']?([^"'\s>]+\.(?:pdf|docx?))["']?[^>]*?(?:title=["']?([^"'>]*))?[^>]*>/gi)) {
    let u; try { u = new URL(m[1], raiz).href; } catch { continue; }
    if (anexos.some((a) => a.url === u)) continue;
    const rot = String(m[2] || '').trim();
    anexos.push({ tipo: /matr/i.test(rot) ? 'matricula' : /laudo|avalia/i.test(rot) ? 'laudo' : 'edital', nome: rot || 'Edital', url: u });
  }
  const fotos = [...new Set([...h.matchAll(/src=["'](\/media\/[^"']+\.(?:jpe?g|png|webp))["']/gi)].map((m) => m[1]))]
    .filter((s) => !/inconestatus|logo/i.test(s) && !RE_IMG_DESCARTA.test(s)).map((s) => new URL(s, raiz).href);
  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao || minimo, valor_minimo: minimo || avaliacao,
    modalidade: /processo|justi[çc]a|vara/i.test(`${url} ${txt.slice(0, 3000)}`) ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(titulo || '', descricao || ''),
    descricao, data_leilao: data, numero_matricula: mat, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_foto: fotos[0] || null,
    encerrado: /encerrad|arrematad|vendid|cancelad|suspens|retirad/i.test(status),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
