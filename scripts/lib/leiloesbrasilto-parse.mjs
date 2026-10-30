/**
 * Parser puro — LEILÕES BRASIL TOCANTINS (leiloesbrasilto.com.br, Palmas/TO; Antônio Carlos Volpi Santana, JUCETINS 12).
 * Triagem 29/10: NÃO é LeilõesBR nem Roisoft — plataforma antiga própria (PHP, jQuery 1.4, popups `window.open`),
 * server-rendered, sem anti-bot → fetch direto, grátis. Recon 30/10:
 *
 *   • `/imoveis`: tabela "Bem · Valor · Leilão · Data" com UMA linha por imóvel, mas o link é do LEILÃO
 *     (`/leilao/<id>`), não do bem — por isso o catálogo é nível 2 (evento → bens). Em 30/10: 1 imóvel (leilão 487,
 *     TRT10, 01/12/2026 11:00). `/veiculos`, `/maquinas`, `/materiais` vazios.
 *   • Leilão `/leilao/<id>`: comitente, "DATA / HORA: 01/12/2026 11:00" (encerrado vem "- FINALIZADO"; sem data,
 *     "00/00/0000 00:00 - EM BREVE"; suspenso aparece no cabeçalho), edital em `/edital/<id>` (PDF), e os bens em
 *     tabelas por categoria (`<strong>Imóveis</strong>` → linhas "Bem · Valor Avaliado · Lance Inicial"), cada bem com
 *     `href="javascript:bem(<id>)"` — o popup é `/bem/<id>`.
 *   • Bem `/bem/<id>`: título, "Valor Avaliado", "Lançe Inicial", "Endereço" (vazio em 30/10) e "Descrição" (vara,
 *     processo CNJ, partes). NÃO traz data nem leilão — por isso a URL do lote é a do LEILÃO com o bem no fragmento
 *     (`/leilao/487#bem-6420`): o runner busca o leilão (o fragmento não vai ao servidor; `?bem=` dá 404), e o parser
 *     busca o popup do bem e a galeria. Fotos por AJAX em `/bem_galeria/<id>` ("Não há fotos para serem exibidas." em
 *     todos os bens conferidos, 483/480/470/487).
 *   • Só uma data por leilão (a praça corrente); a outra, quando houver, fica no edital.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';
import { tipoDaDescricao } from './parquedosleiloes-parse.mjs';

const BASE = 'https://leiloesbrasilto.com.br';
export const TENANTS = {
  leiloesbrasilto: { fonte: 'LEILOESBRASILTO', leiloeiro: 'Leilões Brasil Tocantins (Antônio Carlos Volpi Santana)', base: BASE },
};

export const idDaUrl = (url) => (String(url).match(/#bem-(\d+)/) || [])[1] || null;
const leilaoDaUrl = (url) => (String(url).match(/\/leilao\/(\d+)/) || [])[1] || null;

export const textoDe = (html) => decodificarEntidades(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** `/imoveis` → Map id do leilão → url do leilão (nível 2). */
export function extrairUrlsDeEvento(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/(?:www\.)?leiloesbrasilto\.com\.br)?\/leilao\/(\d+)\/?"/gi)) out.set(m[1], `${BASE}/leilao/${m[1]}`);
  return out;
}

/** Bloco de cada categoria do leilão: "<strong>Imóveis</strong>" até o próximo cabeçalho de categoria. */
function blocoImoveis(html) {
  const h = String(html || '');
  const partes = h.split(/<td[^>]*>\s*<strong>\s*([^<]{2,40}?)\s*<\/strong>\s*<\/td>/i);
  const out = [];
  for (let i = 1; i < partes.length; i += 2) if (/^im[óo]ve/i.test(decodificarEntidades(partes[i]))) out.push(partes[i + 1]);
  return out.join('\n');
}

/** Página do leilão → Map id do bem → url `/leilao/<id>#bem-<bem>`. Só os bens da categoria Imóveis. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  const leilao = (String(html || '').match(/href="\/edital\/(\d+)"/) || String(html || '').match(/leilaoOnline\((\d+)\)/) || [])[1];
  if (!leilao) return out;
  for (const m of blocoImoveis(html).matchAll(/javascript:bem\((\d+)\)/g)) out.set(m[1], `${BASE}/leilao/${leilao}#bem-${m[1]}`);
  return out;
}

const iso = (d, h) => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); if (!m || m[3] === '0000') return null; const t = String(h || '').match(/(\d{1,2}):(\d{2})/); return `${m[3]}-${m[2]}-${m[1]}T${t ? t[1].padStart(2, '0') : '00'}:${t ? t[2] : '00'}:00-03:00`; };
const FORA = /finalizad|encerrad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad/i;

/** Linha do bem na tabela do leilão: título, avaliado, lance inicial. */
function linhaDoBem(html, idBem) {
  const m = String(html || '').match(new RegExp(`javascript:bem\\(${idBem}\\)[^>]*>([\\s\\S]*?)<\\/a>\\s*<\\/td>\\s*<td[^>]*>\\s*([\\d.,]+)\\s*<\\/td>\\s*<td[^>]*>\\s*([\\d.,]+)\\s*<\\/td>`, 'i'));
  return m ? { titulo: textoDe(m[1]), aval: num(m[2]), lance: num(m[3]) } : null;
}

/** Popup `/bem/<id>`: descrição e endereço (valores repetem os da tabela). */
export function lerBem(html) {
  const h = String(html || '');
  const campo = (rot) => textoDe((h.match(new RegExp(`<td[^>]*>\\s*${rot}:?\\s*<\\/td>\\s*<td[^>]*>([\\s\\S]*?)<\\/td>`, 'i')) || [])[1]);
  return { titulo: textoDe((h.match(/<h2 id="titulo">([\s\S]*?)<\/h2>/i) || [])[1]), endereco: campo('Endere[çc]o'), descricao: campo('Descri[çc][ãa]o'), aval: num(campo('Valor Avaliado').replace(/R\$\s*/, '')) };
}

/** Galeria `/bem_galeria/<id>` → URLs absolutas das imagens (vazio quando "Não há fotos"). */
export function fotosDaGaleria(html) {
  return [...new Set([...String(html || '').matchAll(/(?:href|src)="([^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => m[1]))]
    .filter((u) => !/\/img\/(?:ico|ajax|logo)/i.test(u))
    .map((u) => (/^https?:/i.test(u) ? u : `${BASE}${u.startsWith('/') ? '' : '/'}${u}`));
}

export async function parseDetalhe(html, url, { fetchFonte = null, agora = new Date() } = {}) {
  const h = String(html || '');
  const idBem = idDaUrl(url), idLeilao = leilaoDaUrl(url);
  if (!idBem || !idLeilao) return null;
  const linha = linhaDoBem(h, idBem);
  const dh = h.match(/DATA \/ HORA:\s*<\/strong>\s*<\/td>\s*<td>([\s\S]*?)<\/td>/i);
  if (!linha || !dh) return null;
  const dataTxt = textoDe(dh[1]);
  const dm = dataTxt.match(/(\d{2}\/\d{2}\/\d{4})\s+(\d{1,2}:\d{2})/);
  const data = dm ? iso(dm[1], dm[2]) : null;
  const situacao = (dataTxt.match(/-\s*([A-ZÀ-Úa-zà-ú ]{3,30})$/) || [])[1]?.trim() || null;
  // "Suspenso" vem no cabeçalho do leilão, ao lado de "Online"/"Presencial" (leilão 253).
  const cabecalho = textoDe((h.match(/Detalhes do Leil[ãa]o[\s\S]*?COMITENTE:/i) || [''])[0]);
  const comitente = textoDe((h.match(/COMITENTE:<\/strong>[\s\S]*?<td style="vertical-align: middle;[^>]*>([\s\S]*?)<\/td>/i) || [])[1]);

  // Popup do bem (descrição/processo) e galeria — falha aqui não derruba o lote: fica sem a descrição, com o motivo.
  let bem = { titulo: '', endereco: '', descricao: '' }, fotos = [], aviso = null;
  if (fetchFonte) {
    const rb = await fetchFonte(`${BASE}/bem/${idBem}`, { semBD: true });
    if (rb?.html) bem = lerBem(rb.html); else aviso = `popup do bem não abriu (${rb?.via || 'sem resposta'})`;
    const rg = await fetchFonte(`${BASE}/bem_galeria/${idBem}`, { semBD: true });
    if (rg?.html) fotos = fotosDaGaleria(rg.html); else aviso = [aviso, `galeria não abriu (${rg?.via || 'sem resposta'})`].filter(Boolean).join('; ');
  }
  const tituloBem = (bem.titulo || linha.titulo).replace(/^\s*\d+\s*[.)-]\s*/, '');
  const texto = [tituloBem, bem.endereco, bem.descricao].filter(Boolean).join(' ');
  // "Palmas-TO" (registro) e "PALMAS/TO" (fim do título): o cidadeDoTexto só lê a forma com barra.
  const local = [cidadeDoTexto(tituloBem), cidadeDoTexto(bem.endereco), cidadeDoTexto(texto.replace(/\b([A-Za-zÀ-ÿ]+)\s*-\s*([A-Z]{2})\b/g, '$1/$2'))]
    .find((c) => c.cidade) || { cidade: null, estado: null };
  // Título = o que o bem é + endereço: "Imóvel urbano registrada no Registro de Imóveis de Palmas-TO matrícula nº 104.572,
  // QUADRA 1003 SUL ARSO 101, …, PALMAS/TO" → "Imóvel urbano - Quadra 1003 Sul Arso 101, Alameda 12, Lote 04-A - Palmas/TO".
  const oQue = (tituloBem.match(/^(.{3,40}?)\s+(?:registrad|situad|localizad|matr[íi]cula|,)/i) || [])[1] || null;
  const depoisMatricula = tituloBem.split(/matr[íi]cula\s+n?[º°o.]*\s*[\d.]+(?:-[A-Z])?\s*,?\s*/i)[1];
  let endereco = (bem.endereco || depoisMatricula || tituloBem).replace(/,?\s*[A-Za-zÀ-ÿ ]+\/[A-Z]{2}\s*\.?\s*$/, '').trim();
  const tipoDesc = tipoDaDescricao(tituloBem);
  const rotulo = oQue && !/^\d/.test(oQue) ? oQue : (tipoDesc || 'Imóvel');
  if (endereco === tituloBem) endereco = '';
  const base = titleCase(`${rotulo}${endereco ? ` - ${endereco}` : ''}`.toLowerCase()).replace(/^im[óo]vel/i, (s) => s[0].toUpperCase() + s.slice(1));
  const titulo = (local.cidade ? `${base} - ${local.cidade}/${local.estado}` : base).slice(0, 200);
  const judicial = /tribunal|\bvara\b|escrivania|comarca|ju[íi]zo/i.test(comitente) || /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(bem.descricao);
  const edital = /href="\/edital\/\d+"/i.test(h) ? `${BASE}/edital/${idLeilao}` : null;
  const descricao = [tituloBem, bem.descricao && `Descrição: ${bem.descricao}`, comitente && `Comitente: ${comitente}`].filter(Boolean).join('\n');
  return {
    titulo,
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: linha.aval || bem.aval || 0, valor_minimo: linha.lance, valor_minimo_2: null,
    modalidade: judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(texto) || 0,
    descricao: descricao.slice(0, 8000) || null,
    data_leilao: data, data_leilao_2: null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: null,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : [],
    numero_matricula: numeroMatriculaDoTexto(texto) || null,
    situacao: /suspens/i.test(cabecalho) ? 'Suspenso' : situacao,
    aviso,
    naoImovel: false,
    encerrado: FORA.test(`${situacao || ''} ${/suspens/i.test(cabecalho) ? 'suspenso' : ''}`) || (data ? Date.parse(data) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
