/**
 * Parser puro — GUSTAVO TURANI LEILÕES (turanileiloes.com.br; Caxias do Sul/Porto Alegre/Novo Hamburgo, RS — varas da
 * Justiça Estadual e do TRT4, falências e vendas extrajudiciais). Plataforma própria (Laravel + Vue, "duo.studio"),
 * Cloudflare só como CDN (sem challenge) → fetch direto, grátis. Recon 30/10:
 *
 *   • `/imoveis?page=N` é server-rendered (o botão "VER MAIS" só pede a mesma rota com `page`): 8 cartões de lote
 *     `/imoveis/<id>-<slug>` por página, + 6 cartões de AUDITÓRIO (`/auditorio/<slug>`, ignorados — os lotes deles
 *     aparecem na própria lista). ~111 páginas em 30/10: os ABERTOS vêm primeiro, por data (≈ 270 lotes até a pág. 35,
 *     praças de nov/2026 a 2027) e depois ~600 encerrados (bandeira "LEILÃO / ENCERRADO", datas riscadas). O cartão
 *     encerrado NÃO é enumerado: a 1ª página só de encerrados não traz nada novo e o motor para ali sozinho.
 *   • A página do lote é casca (`<lote-component :lote-id="4652">`): tudo vem de `GET /lotes/<id>/atualiza-pagina`,
 *     JSON público (o mesmo que o Vue lê, sem token nem sessão). Por isso a lista devolve a URL do JSON e `montarRow`
 *     regrava `url_lote` com o `link` público que o próprio JSON traz.
 *   • JSON: `titulo`, `avaliacao` e `lance_inicial` ("160.000,00"), `incremento_minimo`, `data_primeiro_leilao` e
 *     `data_segundo_leilao` ("dd/mm/aaaa hh:mm:ss" — iguais = praça única), `aberto` (0 = encerrado; o lote encerrado
 *     antes da data, por acordo/suspensão, já sai com 0), `categoria.slug` ('imoveis'), `numero_processo` (CNJ, ou
 *     "VENDA DIRETA"/"EDITAL EXTRAJUDICIAL"), `edital` e `documentos` (PDF), `imagens[]` (caminho sob /uploads/lotes/),
 *     `informacoes[]` ({titulo, descricao}: "LOCALIZAÇÃO", "MATRÍCULA", "ÁREA…", "LANCE MÍNIMO 1º/2º LEILÃO") e
 *     `observacoes` (texto livre do lote).
 *   • O LANCE: o site aceita desde já o valor da 2ª praça — `lance_inicial + incremento` é o "Lance sugerido" do cartão
 *     e bate com o "LANCE MÍNIMO 2º LEILÃO" das informações (1095: 24.700 + 300 = 25.000). O valor da 1ª praça só
 *     existe quando as informações o publicam ("LANCE MÍNIMO 1º LEILÃO: R$ 50.000,00"); sem ele, não se inventa.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://www.turanileiloes.com.br';
export const TENANTS = {
  turani: { fonte: 'TURANI', leiloeiro: 'Gustavo Turani Leilões (Gustavo Turani)', base: BASE },
};

export const urlJson = (id) => `${BASE}/lotes/${id}/atualiza-pagina`;
export const idDaUrl = (url) => (String(url).match(/\/(?:imoveis|lotes)\/(\d+)/) || [])[1] || null;

/** Lista `/imoveis?page=N` → Map id → URL do JSON do lote. Cartão "LEILÃO ENCERRADO" fica de fora. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  const h = String(html || '');
  const re = /<a href="(?:https?:\/\/(?:www\.)?turanileiloes\.com\.br)?\/imoveis\/(\d+)-[^"]*"[^>]*class="cartao\b/gi;
  const cartoes = [...h.matchAll(re)];
  cartoes.forEach((m, i) => {
    const bloco = h.slice(m.index, cartoes[i + 1]?.index ?? m.index + 4000);
    if (/<small>\s*ENCERRADO\s*<\/small>/i.test(bloco)) return;
    out.set(m[1], urlJson(m[1]));
  });
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

const iso = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{1,2}):(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4].padStart(2, '0')}:${m[5]}:00-03:00` : null; };
const limpa = (s) => decodificarEntidades(String(s || '')).replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
const CNJ = /\d{7}-?\d{2}\.?\d{4}\.?\d\.?\d{2}\.?\d{3,4}/;

export function parseDetalhe(json, url, { agora = new Date() } = {}) {
  let d;
  try { d = typeof json === 'string' ? JSON.parse(json) : json; } catch { return null; } // padrao-ok: corpo que não é JSON = página não lida; o runner conta como "sem detalhe"
  if (!d || !d.id || !d.titulo) return null;
  const infos = (Array.isArray(d.informacoes) ? d.informacoes : []).filter((i) => i && i.titulo && !/^id$/i.test(i.titulo));
  const info = (re) => infos.find((i) => re.test(i.titulo))?.descricao || '';
  const infoTexto = infos.map((i) => `${i.titulo}: ${i.descricao || ''}`).join('\n');
  const obs = limpa(d.observacoes);
  const tituloBruto = limpa(d.titulo);

  // Cidade: LOCALIZAÇÃO → título ("… EM PELOTAS/RS") → resto das informações (CRI) → observações.
  const local = [info(/LOCALIZA|ENDERE[ÇC]O/i), tituloBruto, infoTexto, obs].map(cidadeDoTexto).find((c) => c.cidade)
    || { cidade: null, estado: null };

  const aval = num(d.avaliacao) || num(info(/^AVALIA/i));
  // Lance publicado pelo site (= mínimo da 2ª praça; ver cabeçalho). Informações explícitas têm precedência.
  const sugerido = (num(d.lance_inicial) + (Number(d.incremento_minimo_original) || num(d.incremento_minimo) || 0)) || 0;
  const v1Info = num(info(/LANCE M[ÍI]NIMO 1/i));
  const v2Info = num(info(/LANCE M[ÍI]NIMO 2|PRE[ÇC]O M[ÍI]NIMO/i)) || num(info(/^LANCE M[ÍI]NIMO$/i));
  const vAtual = v2Info || sugerido;

  let d1 = iso(d.data_primeiro_leilao), d2 = iso(d.data_segundo_leilao);
  if (d2 && d1 && d2 === d1) d2 = null;
  if (!d1) { d1 = d2; d2 = null; }
  let v1 = vAtual, v2 = null;
  if (d2 && Date.parse(d1) < agora) { d1 = d2; d2 = null; }   // entre as praças: vale a 2ª
  else if (d2 && v1Info && v1Info > vAtual) { v1 = v1Info; v2 = vAtual; }
  const fim = d2 || d1;

  const fotos = [...new Set([d.thumbnail_principal, ...(d.imagens || []).map((i) => i?.thumbnail_principal && `${BASE}/uploads/lotes/${i.thumbnail_principal}`)]
    .filter((u) => u && /^https?:\/\//.test(u) && !/aguarde_lote|avatar\.png/i.test(u)))];
  const edital = /^https?:\/\/.+\.pdf$/i.test(d.edital || '') ? d.edital : null;
  const docs = /^https?:\/\/.+\.pdf$/i.test(d.documentos || '') ? d.documentos : null;
  const anexos = [
    ...(edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : []),
    ...(docs && docs !== edital ? [{ tipo: 'documento', nome: 'Documentos do lote', url: docs }] : []),
  ];

  const matTxt = info(/MATR[ÍI]CULA/i);
  // "Nº 29.447 - CRI DE SÃO SEBASTIÃO DO CAÍ", "185.294 do CRI de Porto Alegre/RS", "9.387, 20.812 E 19.217 – …" (a 1ª).
  const numero_matricula = (matTxt && numeroMatriculaDoTexto(`matrícula ${matTxt}`))
    || (matTxt.match(/(\d{1,3}(?:\.\d{3})+|\d{3,7})(?:-[A-Z])?/) || [])[0]
    || numeroMatriculaDoTexto(obs) || null;
  const area = extrairAreaM2(infos.filter((i) => /[ÁA]REA|TERRENO|METRAGEM/i.test(i.titulo)).map((i) => `${i.titulo} ${i.descricao}`).join('. '))
    || extrairAreaM2(tituloBruto) || extrairAreaM2(obs) || 0;

  const titulo = titleCase(tituloBruto.toLowerCase()).replace(/\/([a-z]{2})\b/gi, (_, uf) => `/${uf.toUpperCase()}`)
    .replace(/\b(?:Ii|Iii|Iv|Vi|Vii|Viii|Ix|Xi|Xii)\b/g, (r) => r.toUpperCase());   // "Garden II", não "Garden Ii"
  // O título às vezes não diz o tipo ("Conjunto Nº 801 do Edifício Buchaim"); as informações dizem ("BEM: CONJUNTO
  // COMERCIAL…"). Só serve de reserva — `montarRow` usa quando o título dá 'outros'.
  // Só o rótulo, não a observação: a 1ª linha do 5685 termina em "junto à … Santa Casa" e virava tipo 'casa'.
  const tipoTexto = info(/^(?:BEM|TIPO|IM[ÓO]VEL|DESCRI)/i).slice(0, 200);
  const temCidade = local.cidade && titulo.toLowerCase().includes(local.cidade.toLowerCase());
  return {
    titulo: (local.cidade && !temCidade ? `${titulo} - ${local.cidade}/${local.estado}` : titulo).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval, valor_minimo: v1, valor_minimo_2: v2,
    modalidade: CNJ.test(String(d.numero_processo || '')) || String(d.numero_processo_normalizado || '').length >= 20 ? 'judicial' : 'extrajudicial',
    area_m2: area,
    descricao: (obs || infoTexto).slice(0, 8000) || null,
    data_leilao: d1, data_leilao_2: d2,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || docs || d.link || null,
    link_matricula: null,
    anexos,
    numero_matricula,
    tipoTexto,
    link_publico: /^https?:\/\//.test(d.link || '') ? d.link : `${BASE}/imoveis/${d.id}-${d.slug || ''}`,
    naoImovel: !!d.categoria?.slug && d.categoria.slug !== 'imoveis',
    encerrado: Number(d.aberto) === 0 || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => {
  const row = montarRowDom(det.link_publico || url, det, tenant, idDaUrl(url), inferirTipo);
  const tipoReserva = row.tipo === 'outros' && det.tipoTexto ? inferirTipo(det.tipoTexto, '') : null;
  return {
    ...row,
    ...(tipoReserva && tipoReserva !== 'outros' ? { tipo: tipoReserva } : {}),
    valor_minimo_2: det.valor_minimo_2 || null,
    ...(det.fotos?.length ? { fotos: det.fotos } : {}),
  };
};
export { checarQualidade };
