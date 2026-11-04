/**
 * Parser puro — plataforma TRIACCA (triacca.com.br, "Desenvolvido por TRIACCA Design Digital"; PHP, server-rendered,
 * sem anti-bot). Leiloeiros do RS (Marau / Getúlio Vargas). Fila #380. Recon 30/10:
 *
 *   • Home lista TODOS os bens (`leilao-virtual/<slug>`, relativo) — imóvel, veículo e máquina juntos; não há categoria
 *     na URL. O que não é imóvel sai pelo texto (`naoImovel` + classificador do motor).
 *   • Lote: "Leilões / <TÍTULO> Desenvolvido por TRIACCA … <VARA> praça voltar … <PROCESSO> <situação> <descrição>
 *     ATENÇÃO: …", `<span class="data_leilao">1ª praça<b>17/12/2026 14:30:00</b>` (e 2ª), preço em
 *     `<div class="ultimolance">` — "último lance: R$ X" quando já há lance, "avaliação: R$ X" quando não há.
 *     "Bem não disponível para leilão" = suspenso. Matrícula `arquivos/matriculas/*.pdf`, edital `fotos/editais/*.pdf`,
 *     fotos `fotos/produtos/originais/*.jpg`.
 *   • ⚠️ "em leilão" fica na página mesmo depois da praça (casa de set/2026 ainda dizia "em leilão" em 30/10): encerrado
 *     é a ÚLTIMA praça no passado.
 *   • Cidade escrita "Getúlio Vargas-RS" (hífen, não barra).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

export const TENANTS = {
  laraforster: { fonte: 'LARAFORSTER', leiloeiro: 'Lara Forster Leilões', base: 'https://leiloeslaraforster.com.br' },
  alexsandro: { fonte: 'ALEXSANDROLEIL', leiloeiro: 'Alexsandro Leilões', base: 'https://alexsandroleiloes.com.br' },
  // 04/11: Lunelli Leilões (Bento Gonçalves/RS) — mesma plataforma (rodapé "TRIACCA FRAMEWORK"); home com 74 bens.
  lunelli: { fonte: 'LUNELLI', leiloeiro: 'Lunelli Leilões', base: 'https://www.lunellileiloes.com.br' },
};

export const idDaUrl = (url) => (String(url).match(/\/leilao-virtual\/([a-z0-9-]+)/i) || [])[1] || null;

// O slug do site COME o acento com a letra: "caminhão" → "caminho", "automóvel" → "automvel" (30/10).
const SLUG_VEICULO = /(^|-)(caminh|automvel|automov|moto|picape|caminhonete|onibus|nibus|trator|benz|ford|honda|hyundai|fiat|chevrolet|volkswagen|vw|gm)(-|$|[a-z])/i;

/** Home → Map slug → url absoluta (os links vêm relativos: `leilao-virtual/<slug>`). */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href="(?:https?:\/\/[^/"]+\/)?\/?leilao-virtual\/([a-z0-9-]+)"/gi)) {
    // "leilao-somente-para-teste-…" (Alexsandro, 30/10) é lote de teste do próprio leiloeiro.
    if (/teste/i.test(m[1])) continue;
    // Bem que o próprio slug diz ser veículo/máquina ("aparelhos-topograficos" nem tem praça) não é lido: virava
    // "sem detalhe" na saúde. Imóvel nunca casa aqui (VEICULO não tem palavra de imóvel).
    if (VEICULO.test(m[1].replace(/-/g, ' ')) || SLUG_VEICULO.test(m[1])) continue;
    out.set(m[1], `${String(base || '').replace(/\/$/, '')}/leilao-virtual/${m[1]}`);
  }
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

const texto = (html) => decodificarEntidades(String(html || '')
  .replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<!--[\s\S]*?-->/gi, ' ')
  .replace(/<[^>]+>/g, ' ')).replace(/&atilde/g, 'ã').replace(/\s+/g, ' ').trim();
const iso = (d, h) => { const m = String(d).match(/(\d{2})\/(\d{2})\/(\d{4})/); const t = String(h || '').match(/(\d{1,2}):(\d{2})/); return m ? `${m[3]}-${m[2]}-${m[1]}T${t ? t[1].padStart(2, '0') : '00'}:${t ? t[2] : '00'}:00-03:00` : null; };
// "Getúlio Vargas-RS" → "Getúlio Vargas/RS" para o validador de município.
const comBarra = (s) => String(s || '').replace(/([A-Za-zÀ-ÿ])\s*-\s*([A-Z]{2})\b/g, '$1/$2');
const VEICULO = /\b(motocicleta|motoneta|caminh[ãa]o|caminhonete|autom[óo]vel|ve[íi]culo|placa\s+[a-z]{3}|ponte rolante|aparelhos?|m[áa]quina|trator|ecosport|honda|picape)\b/i;

// MODELO NOVO DA PÁGINA DE LOTE (04/11, Lunelli). Mesma plataforma, outro template: as praças vêm em
// `<div class="pracas_novas">` (pílula "1º Leilão"/"2º Leilão"/"Praça Única" + `data_praca`; "Lance Mínimo" é uma
// pílula com R$ no lugar da data), os preços em `precos_principais` ("avaliação:", "segunda praça:", "último lance:"),
// a descrição em `<div class="descricao">`, o fórum no `<h2>` com `img#forma` e os PDFs em `arquivos/produtos/*.pdf`
// com o nome no atributo `download` ("Edital de Leilao", "Matricula 70.329"). Arrematado: "Este bem já foi arrematado".
const NAO_IMOVEL_BEM = /\b(cabines?|tear(es)?|m[áa]quinas?|equipamentos?|torno|prensa|janelas|portas|m[óo]veis|compressor|empilhadeira|estoque|mercadorias?)\b/i;
function parseDetalheNovo(h, url, { agora, tenant }) {
  const plano = h.replace(/\s+/g, ' ');
  const direita = plano.slice(Math.max(0, plano.indexOf('class="direita"')));
  const tituloBruto = texto((direita.match(/<h2>([\s\S]*?)<\/h2>/i) || [])[1]);
  if (!tituloBruto) return null;
  const linhas = [...plano.matchAll(/class="pill_praca">([^<]+)<\/span>\s*<span class="data_praca">([^<]+)<\/span>/gi)].map((m) => [texto(m[1]), texto(m[2])]);
  // "00/00/0000" = praça sem data (Lunelli: 2º leilão não marcado).
  const datas = linhas.filter(([, v]) => /\d{2}\/\d{2}\/\d{4}/.test(v) && !/^00\/00\/0000/.test(v)).map(([p, v]) => ({ p, iso: iso(v, (v.match(/\d{1,2}:\d{2}/) || [])[0]) }));
  if (!datas.length) return null;
  const d1 = datas.find((d) => /^1/.test(d.p)) || datas[0];
  const d2 = datas.find((d) => /^2/.test(d.p) && d !== d1) || null;
  const lanceMinimoPill = num(((linhas.find(([p]) => /lance m[íi]nimo/i.test(p)) || [])[1] || '').match(/([\d.]+,\d{2})/)?.[1]);
  const precos = texto((plano.match(/class="precos_principais">([\s\S]*?)class="(?:arrematante_info|ver_local)/i) || [])[1]);
  const aval = num((precos.match(/avalia[çc][ãa]o:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const segunda = num((precos.match(/segunda pra[çc]a:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const ultimo = num((precos.match(/[úu]ltimo lance:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const arrematado = /Este bem j[áa] foi arrematado/i.test(plano);
  const desc = texto((plano.match(/<div class="descricao">([\s\S]*?)<\/section>/i) || [])[1]).slice(0, 8000);
  const vara = texto((plano.match(/<h2>\s*<img id="forma"[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
  const processo = (`${tituloBruto} ${desc}`.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/) || [])[0] || null;
  const base = tenant?.base || (String(url).match(/^https?:\/\/[^/]+/) || [''])[0];
  const abs = (p) => `${base}/${String(p).replace(/^\//, '')}`;
  const fotos = [...new Set([...plano.matchAll(/(?:src|href)="([^"]*fotos\/produtos\/md_[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => abs(m[1])))];
  const pdfs = [...plano.matchAll(/href="([^"]*arquivos\/produtos\/[^"]+\.pdf)"[^>]*download="([^"]*)"/gi)].map((m) => ({ url: abs(m[1]), nome: texto(m[2]).replace(/\.pdf$/i, '') }));
  const edital = pdfs.find((p) => /edital/i.test(p.nome));
  const matricula = pdfs.find((p) => /matr[íi]cula/i.test(p.nome));
  // "A.15: PROCESSO Nº … ▬ Um terreno urbano…" → o bem é o que vem depois do "▬"; o código do lote e o processo ficam na descrição.
  const bem = (tituloBruto.split('▬').pop() || tituloBruto).replace(/^[A-Z]\.?\d+\s*:\s*/, '').trim();
  const local = [cidadeDoTexto(comBarra(bem)), cidadeDoTexto(comBarra(desc)), cidadeDoTexto(comBarra(vara.replace(/^.*F[óo]rum de\s+/i, '')))].find((c) => c.cidade)
    || { cidade: null, estado: null };
  const tit = bem.charAt(0).toUpperCase() + bem.slice(1);
  const ultimaPraca = d2?.iso || d1.iso;
  const primeiraFutura = d1.iso && Date.parse(d1.iso) >= agora;
  return {
    titulo: (local.cidade && !tit.includes(local.cidade) ? `${tit} - ${local.cidade}/${local.estado}` : tit).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval,
    // Com lance dado, o último lance é o piso; senão a 1ª praça é pela avaliação (ou o "Lance Mínimo" da praça única) e a 2ª pelo valor da "segunda praça".
    valor_minimo: ultimo || (primeiraFutura || !segunda ? (lanceMinimoPill || aval) : segunda),
    valor_minimo_2: primeiraFutura && segunda ? segunda : null,
    modalidade: processo || /\bVara\b|F[óo]rum/i.test(`${vara} ${desc}`) ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(`${bem} ${desc}`) || 0,
    descricao: [desc, vara && `${vara}.`, processo && !desc.includes(processo) && `Processo ${processo}.`].filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: primeiraFutura || !d2 ? d1.iso : d2.iso,
    data_leilao_2: primeiraFutura && d2 ? d2.iso : null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital ? edital.url : url,
    link_matricula: matricula ? matricula.url : null,
    anexos: [...(edital ? [{ tipo: 'edital', nome: 'Edital', url: edital.url }] : []), ...(matricula ? [{ tipo: 'matricula', nome: matricula.nome || 'Matrícula', url: matricula.url }] : [])],
    numero_matricula: numeroMatriculaDoTexto(`${bem} ${desc}`) || null,
    // Lunelli leiloa maquinário judicial ao lado do imóvel ("Cabines de pintura", "Um tear", "Janelas e portas").
    naoImovel: (VEICULO.test(bem) || NAO_IMOVEL_BEM.test(bem)) && !/im[óo]vel|terreno|casa|apartamento|sala|pr[ée]dio|[áa]rea de terra|fra[çc][ãa]o de terras/i.test(bem),
    encerrado: arrematado || (ultimaPraca ? Date.parse(ultimaPraca) < agora : false),
  };
}

export function parseDetalhe(html, url, { agora = new Date(), tenant } = {}) {
  const h = String(html || '');
  if (/class="pracas_novas"/i.test(h)) return parseDetalheNovo(h, url, { agora, tenant });
  const corpo = texto(h.slice(h.search(/<body/i)));
  // `<title>Lara Forster Leilões / <TÍTULO></title>`: o "Leilões" pode vir com byte Latin-1 solto ("Leil�es" — a página
  // é mista, ver decodificarHtml), então vale o que vem depois da ÚLTIMA barra.
  const titulo = (texto((h.match(/<title>([\s\S]*?)<\/title>/i) || [])[1]).split('/').pop() || '').trim() || null;
  const pracas = [...h.matchAll(/class="data_leilao">\s*([12])\s*ª\s*pra[çc]a\s*<b>\s*(\d{2}\/\d{2}\/\d{4})\s*(\d{1,2}:\d{2})?/gi)];
  if (!titulo || !pracas.length) return null;
  const vara = (corpo.match(/TRIACCA Design Digital\s+(.+?)\s+pra[çc]a voltar/i) || [])[1] || '';
  const processo = (corpo.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/) || [])[0] || null;
  // Descrição: do processo (ou do título repetido) até o aviso padrão "ATENÇÃO:" / "Matricula do imóvel".
  const iniDesc = processo ? corpo.indexOf(processo) + processo.length : Math.max(0, corpo.indexOf("voltar") + 6);
  const desc = corpo.slice(iniDesc).replace(/^\S*\s*(?:em leil[ãa]o\s+)?/i, '').split(/\s+ATEN[ÇC][ÃA]O:|\s+Matr[íi]cula do im[óo]vel:/i)[0].trim();
  const d1 = pracas.find((p) => p[1] === '1'), d2 = pracas.find((p) => p[1] === '2');
  const data1 = d1 ? iso(d1[2], d1[3]) : null, data2 = d2 ? iso(d2[2], d2[3]) : null;
  const fim = data2 || data1;
  const bloco = texto((h.match(/class="ultimolance">([\s\S]{0,1500}?)<\/div>\s*<\/div>/i) || h.match(/class="ultimolance">([\s\S]{0,800})/i) || [])[1]);
  const ultimo = num((bloco.match(/[úu]ltimo lance:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const aval = num((bloco.match(/avalia[çc][ãa]o:?\s*R\$\s*([\d.]+,\d{2})/i) || corpo.match(/avaliad[oa]\s+em\s+R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const indisponivel = /Bem n[ãa]o dispon[íi]vel para leil[ãa]o/i.test(corpo);
  const base = tenant?.base || (String(url).match(/^https?:\/\/[^/]+/) || [''])[0];
  const abs = (p) => `${base}/${String(p).replace(/^\//, '')}`;
  const fotos = [...new Set([...h.matchAll(/src="([^"]*fotos\/produtos\/originais\/[^"]+\.(?:jpe?g|png|webp))"/gi)].map((m) => abs(m[1])))];
  const matricula = (h.match(/href="([^"]*arquivos\/matriculas\/[^"]+\.pdf)"/i) || [])[1];
  const edital = (h.match(/href="([^"]*fotos\/editais\/[^"]+\.pdf)"/i) || [])[1];
  const local = [cidadeDoTexto(comBarra(desc)), cidadeDoTexto(comBarra(titulo)), cidadeDoTexto(comBarra(vara.replace(/^.*Comarca de\s+/i, '')))].find((c) => c.cidade)
    || { cidade: null, estado: null };
  const tit = titleCase(titulo.toLowerCase()).replace(/-([a-z]{2})$/i, (_, uf) => `/${uf.toUpperCase()}`);
  return {
    titulo: (local.cidade && !tit.includes(local.cidade) ? `${tit} - ${local.cidade}/${local.estado}` : tit).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    // Com lance dado, o "último lance" é o piso da próxima oferta; sem lance, a página mostra a avaliação.
    valor_avaliacao: aval, valor_minimo: ultimo || aval, valor_minimo_2: null,
    modalidade: processo || /\bVara\b/i.test(vara) ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(`${titulo} ${desc}`) || 0,
    descricao: [desc, vara && `${vara}.`, processo && `Processo ${processo}.`].filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: data1 && data2 && Date.parse(data1) < agora ? data2 : data1,
    data_leilao_2: data1 && data2 && Date.parse(data1) >= agora && data2 !== data1 ? data2 : null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital ? abs(edital) : url,
    link_matricula: matricula ? abs(matricula) : null,
    anexos: [...(edital ? [{ tipo: 'edital', nome: 'Edital', url: abs(edital) }] : []), ...(matricula ? [{ tipo: 'matricula', nome: 'Matrícula', url: abs(matricula) }] : [])],
    numero_matricula: numeroMatriculaDoTexto(desc) || null,
    naoImovel: VEICULO.test(titulo) && !/im[óo]vel|terreno|casa|apartamento|[áa]rea de terra/i.test(titulo),
    encerrado: indisponivel || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
