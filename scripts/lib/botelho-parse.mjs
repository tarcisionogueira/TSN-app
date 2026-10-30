/**
 * Parser puro — PAULO BOTELHO LEILOEIRO (paulobotelholeiloeiro.com.br, Rio de Janeiro/RJ; varas do TRT1 e
 * extrajudiciais). Fila #380. Plataforma própria (Laravel, "Desenvolvido por @lstonon"), server-rendered, sem anti-bot.
 * Recon 30/10:
 *
 *   • `/lotes/imoveis?page=N`: só lotes de IMÓVEL (12 por página; 66 em 30/10, 6 páginas), link
 *     `/leiloes/<slug-do-leilão>/<id>`. O nome do leilão engana — "bens-moveis-0911-a-1611…" traz salas e apartamentos;
 *     a lista já vem filtrada pelo tipo, e a página do lote confirma.
 *   • Lote: cabeçalho "<ENDEREÇO> R$ X" → "1º Leilão Tipo: Online Abertura: 30/11/2026 11:00 Encerramento: 04/12/2026
 *     11:00:00 <situação>" ("Aguardando Abertura", …) → "Descrição do Lote Edital Completo <texto>", com "Avaliado em
 *     R$ …" e "Endereço: …, CAMPOS DOS GOYTACAZES/RJ". Fotos `/frontend/images/770x350/<id>_FOTO*.JPG` (placeholder
 *     `placehold-realestate.jpg` = sem foto); edital `/frontend/documents/<processo>….pdf`.
 *   • Só a praça corrente aparece na página; a outra fica no edital.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';
import { tipoDaDescricao } from './parquedosleiloes-parse.mjs';

const BASE = 'https://www.paulobotelholeiloeiro.com.br';
export const TENANTS = {
  botelho: { fonte: 'PAULOBOTELHO', leiloeiro: 'Paulo Botelho Leiloeiro (Paulo Augusto de Maria Botelho)', base: BASE },
};

const RE_LOTE = /href="(?:https:\/\/www\.paulobotelholeiloeiro\.com\.br)?(\/leiloes\/[a-z0-9-]+\/(\d+))"/gi;
export const idDaUrl = (url) => (String(url).match(/\/leiloes\/[^/]+\/(\d+)/) || [])[1] || null;

/** Lista `/lotes/imoveis` → Map id → url do lote. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(RE_LOTE)) out.set(m[2], `${BASE}${m[1]}`);
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

export const textoDe = (html) => decodificarEntidades(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const iso = (d, h) => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m) return null; const t = String(h || '').match(/(\d{1,2}):(\d{2})/); return `${m[3]}-${m[2]}-${m[1]}T${t ? t[1].padStart(2, '0') : '00'}:${t ? t[2] : '00'}:00-03:00`; };
const FORA = /encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad/i;

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const corpo = textoDe(h.slice(h.search(/<body/i)));
  // Cabeçalho do lote: depois do menu ("… Imóveis Veículos Diversos") até o aviso das imagens.
  // O endereço do cabeçalho pode vir vazio (16001: "Diversos R$ 1.900.000,00 * Imagens…") — aí vale o "Endereço:" do texto.
  const cab = corpo.match(/Diversos\s+(.{0,200}?)\s*R\$\s*([\d.]+,\d{2})\s*(?:-->\s*)?\*\s*Imagens ilustrativas/i);
  const praca = corpo.match(/([12])\s*º\s*Leil[ãa]o\s+Tipo:\s*\S+\s+Abertura:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2})\s+Encerramento:\s*(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2})(?::\d{2})?\s+(.{3,40}?)\s+(?:Fazer Login|Hist[óo]rico|Dar lance)/i);
  if (!cab || !praca) return null;
  const desc = (corpo.match(/Descri[çc][ãa]o do Lote\s+Edital Completo\s+(.*?)(?:\s+Informa[çc][õo]es sobre leil[õo]es\?|$)/i) || [])[1] || '';
  const endereco = (desc.match(/Endere[çc]o:\s*(.*?)(?:\.\s|$)/i) || [])[1] || '';
  const local = [cidadeDoTexto(endereco), cidadeDoTexto(desc)].find((c) => c.cidade) || { cidade: null, estado: null };
  const lance = num(cab[2]);
  const aval = num((desc.match(/Avaliad[oa]s?\s+(?:em|por)\s+R\$\s*([\d.]+,\d{2})/i) || [])[1]) || (praca[1] === '1' ? lance : 0);
  const fim = iso(praca[4], praca[5]);
  const situacao = praca[6].trim();
  const fotos = [...new Set([...h.matchAll(/src="(\/frontend\/images\/770x350\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1]))]
    .filter((u) => !/placehold/i.test(u)).map((u) => `${BASE}${u}`);
  const pdf = (h.match(/href="(\/frontend\/documents\/[^"]+\.pdf)"/i) || [])[1];
  const edital = pdf ? `${BASE}${encodeURI(decodeURI(pdf))}` : null;
  // O leilão diz no próprio nome quando é extrajudicial ("extrajudicial-cabiunas-macae-…"): alienação fiduciária
  // cita artigos do CPC e enganava o teste de texto.
  const judicial = !/\/leiloes\/[^/]*extrajudicial/i.test(url) && /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}|\bVARA\b|art(?:igo)?s?\.?\s*8[89]\d\b/i.test(`${desc} ${pdf || ''}`);
  // "50% RUA ALCOBAÇA Nº 1395" = metade do bem. O percentual fica na FRENTE ("50% do imóvel - …"), que é onde a regra de
  // fração do título (decisão do dono) o reconhece — com o tipo antes ("Loja - 50% …") a fatia passava.
  const pct = (cab[1].match(/^\s*(\d{1,3}(?:[.,]\d+)?\s*%)\s*(?:d[oa]s?\s+)?/) || []);
  const endCab = (pct[0] ? cab[1].slice(pct[0].length) : cab[1]).trim() || endereco.split(/,\s*(?=[^,]*\/[A-Z]{2}\b)/)[0]
    || desc.replace(/^\s*\d{1,2}\)\s*/, '').split(/[,;]|\.\s/)[0].slice(0, 90);
  const tituloBase = titleCase(endCab.toLowerCase()).replace(/\/([a-z]{2})\b/i, (_, uf) => `/${uf.toUpperCase()}`);
  // O cabeçalho é o ENDEREÇO ("Rua Santo Antonio, 269, Tapera"): o tipo vem da descrição ("prédio comercial", "Sala 201").
  const tipoDesc = inferirTipo(tituloBase, url) === 'outros' ? tipoDaDescricao(desc) : null;
  const comTipo = `${pct[1] ? `${pct[1].replace(/\s+/g, '')} do imóvel - ` : ''}${tipoDesc ? `${tipoDesc} - ` : ''}${tituloBase}`;
  return {
    titulo: (local.cidade && !comTipo.includes(local.cidade) ? `${comTipo} - ${local.cidade}/${local.estado}` : comTipo).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval, valor_minimo: lance, valor_minimo_2: null,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(desc) || 0,
    descricao: desc.slice(0, 8000) || null,
    data_leilao: fim, data_leilao_2: null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: null,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : [],
    // "matrícula sob o n.º 15.201", "matricula sob o nº 305-A" — formas que o extrator comum não pega.
    numero_matricula: numeroMatriculaDoTexto(desc)
      || desc.match(/matr[íi]cula\s+(?:m[ãa]e\s+)?(?:sob\s+)?(?:o\s+)?n[.º°o]*\s*([\d.]{1,9}(?:-[A-Z])?)\b/i)?.[1] || null,
    situacao,
    naoImovel: false,
    encerrado: FORA.test(situacao) || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
