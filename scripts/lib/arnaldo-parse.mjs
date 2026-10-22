/**
 * Parser puro — ARNALDO LEILÕES (arnaldoleiloes.com.br, Arnaldo Colombarolli, JUCEMG 813; TJMG/TRT-MG em BH).
 * Triagem 22/10 (#292). PHP; o HTML traz título, descrição, fotos e documentos, mas valores e datas chegam
 * por AJAX (`POST /app/Ajax/Leiloes/atualizar_leiloes.php`, `lotes=<id>-<id>-` → `item[<id>]` com
 * `lance.ini`, `data.fim`, `praca1`/`praca2`) — buscados no `enriquecerProntos` da fonte, num POST só.
 *
 * ESTRUTURA (medida pelo banco em 22/10):
 *   • catálogo: `/lotes/?&cate[]=111` (categoria IMÓVEIS) lista os lotes `/lote/<slug>/<id>/` de todos os leilões.
 *   • lote: `<title>LOTE 08 - Área 5.005m² Lagoa Santa - PROCESSO 0010259-53.2024-42ª BH</title>`, descrição no
 *     `#box_info_1` ("…Lagoa Santa/MG… Matrícula Nº 24.433… Total da avaliação: R$550.000,00"), documentos como
 *     âncoras `/web/fotos/lotes_<id>_…pdf` rotuladas (Edital, MATRÍCULA, AUTO DE PENHORA, IPTU…), fotos
 *     `/web/fotos/lotes_<id>_….png|jpg`.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, montarRowDom, cidadeUFBare, semPrefixoCidade } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const TENANTS = {
  arnaldo: { fonte: 'ARNALDO', leiloeiro: 'Arnaldo Leilões', base: 'https://www.arnaldoleiloes.com.br', catalogo: '/lotes/?&cate[]=111' },
};

export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/(?:href|value)=["'](\/lote\/[^"']+\/(\d+)\/)["']/gi)) {
    try { out.set(m[2], new URL(m[1], base).href); } catch { /* url inválida: ignora */ }
  }
  return out;
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/[^/]+\/(\d+)\/?/) || [])[1] || null;

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const dataBr = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

export function parseDetalhe(html, url) {
  const h = String(html || '');
  const raiz = `${new URL(url).origin}/`;
  const id = idDaUrl(url);
  const bruto = limpo((h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]);
  // "LOTE 08 - Área 5.005m² Lagoa Santa - PROCESSO 0010259-53.2024-42ª BH" → "Área 5.005m² Lagoa Santa"
  const processo = (bruto.match(/PROCESSO\s+([\d.\-]{15,30})/i) || [])[1] || null;
  const titulo = bruto.replace(/^LOTE\s+\d+\s*-\s*/i, '').replace(/\s*-\s*PROCESSO[\s\S]*$/i, '').trim().slice(0, 180) || null;
  const txt = decodificarEntidades(textoDe(h));
  // A descrição é o 1º painel do lote (`<li class="box__ box__1"><div class="editor">`).
  const descricao = limpo((h.match(/class=["'][^"']*box__1[^"']*["'][^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>\s*<\/li>/i) || [])[1]).slice(0, 4000) || null;
  let cidade = null, estado = null;
  const cu = String(descricao || '').match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)\s*\/\s*(MG|SP|RJ|GO|ES|BA|DF)\b/);
  if (cu) { cidade = titleCase(semPrefixoCidade(cu[1])); estado = cu[2]; }
  else ({ cidade, estado } = cidadeUFBare(`${titulo || ''} ${descricao || ''}`));
  const avaliacao = plaus(num((String(descricao || '').match(/(?:Total da\s+)?avalia[çc][ãa]o[^R]{0,40}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const mat = (String(descricao || '').match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const anexos = [];
  for (const m of h.matchAll(/<a\b[^>]*href=["']([^"']+\.(?:pdf|docx?))["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], raiz).href; } catch { continue; }
    if (anexos.some((a) => a.url === u)) continue;
    const rot = limpo(m[2]);
    const tipo = /edital/i.test(rot) ? 'edital' : /matr[íi]cula/i.test(rot) ? 'matricula' : /laudo|avalia/i.test(rot) ? 'laudo' : 'outro';
    anexos.push({ tipo, nome: rot || 'Documento', url: u });
  }
  // Foto principal `lotes_<id>_…` + "mais fotos" da galeria do próprio lote (`mais-fotos_…`).
  const fotos = id ? [...new Set([...h.matchAll(new RegExp(String.raw`(?:src|href)=["'](/web/fotos/(?:lotes_${id}_|mais-fotos_)[^"']+\.(?:jpe?g|png|webp))["']`, 'gi'))].map((m) => m[1]))]
    .map((s) => new URL(s, raiz).href) : [];
  return {
    titulo, cidade, estado,
    // Provisório: o lance inicial real vem do AJAX no enriquecimento (o checador de qualidade roda antes).
    valor_avaliacao: avaliacao, valor_minimo: avaliacao,
    modalidade: processo ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(titulo || '', descricao || ''),
    descricao, data_leilao: dataBr((txt.match(/Data de T[ée]rmino\s*:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]),
    numero_matricula: mat, numero_processo: processo, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: fotos[0] || null, fotos,
    encerrado: false,
  };
}

/** Puro (testável): aplica `item[<id>]` do AJAX nas linhas. Devolve quantas mudaram. */
export function aplicarValores(rows, item) {
  let n = 0;
  for (const r of rows) {
    const v = item?.[idDaUrl(r.url_lote)];
    if (!v) continue;
    const ini = plaus(num(v.lance?.ini));
    const fim = dataBr(v.data?.fim) || dataBr(v.praca1?.data?.ini);
    const fim2 = dataBr(v.praca2?.data?.fim) || dataBr(v.praca2?.data?.ini);
    if (ini) r.valor_minimo = ini;
    if (!r.valor_avaliacao) r.valor_avaliacao = ini;
    if (fim) r.data_leilao = fim;
    if (fim2) r.data_leilao_2 = fim2;
    const va = r.valor_avaliacao || 0, vm = r.valor_minimo || 0;
    r.desconto_percentual = va > 0 ? Math.round((1 - vm / va) * 100) : null;
    r.viavel = va > 0 ? (1 - vm / va) >= 0.3 : null;
    r.score_viabilidade = va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30;
    if (ini || fim) n++;
  }
  return n;
}

export const montarRow = (url, det, tenant) => ({ ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo), numero_processo: det.numero_processo || null, ...(det.fotos?.length ? { fotos: det.fotos } : {}) });
export { checarQualidade };
