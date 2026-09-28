// ─── UF QUE FALTOU NA EXTRAÇÃO — só com prova do IBGE (23/09) ─────────────────────────────
// Achado pelo invariante `estado_fora_do_padrao` (96 lotes ativos sem sigla de UF — e lote sem
// UF SOME de /leiloes). O caso grande: 50 da SUPERBID em modo loja, onde `product.location` vem
// como OBJETO sem `state`/`uf` — mas o título traz "Campinas-SP" em todo lote. Outras fontes
// (BIASI "São Paulo/SP", LEILOTECH…) têm o mesmo padrão no texto.
//
// Regra: nunca chutar. Uma UF só é aceita se o par (UF, cidade) EXISTE no dataset do IBGE:
//   1. "Cidade-UF" / "Cidade/UF" / "Cidade - UF" no título/endereço/descrição, com a cidade
//      conferida contra aquela UF (a cidade do lote, quando existe, tem de ser a mesma);
//   2. senão, a cidade do lote quando ela existe em UMA só UF ("Campo Grande" é AL e MS —
//      ambígua, fica sem UF; "Campinas" só SP).
// Devolve { uf, cidade?, via } ou null. `cidade` só vem quando o lote não tinha nenhuma.
import MUNICIPIOS from '../../api/_municipios.js';

export const normCidade = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

const UFS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const UFS_DA_CIDADE = new Map(); // "campinas" → Set(['SP'])
for (const k of Object.keys(MUNICIPIOS)) {
  const [uf, c] = k.split('|');
  if (!UFS_DA_CIDADE.has(c)) UFS_DA_CIDADE.set(c, new Set());
  UFS_DA_CIDADE.get(c).add(uf);
}
const existe = (uf, cidadeNorm) => Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${cidadeNorm}`);

// Até 5 palavras antes do separador — o candidato a cidade é o MAIOR sufixo que bate no IBGE
// ("Apto 72m² | São Paulo-SP" → testa "paulo", "sao paulo", … e fica com "sao paulo").
const RE_CIDADE_UF = /([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){0,5})\s*[-–/]\s*([A-Z]{2})(?![A-Za-z])/g;

function doTexto(texto, cidadeNorm) {
  if (!texto) return null;
  for (const m of String(texto).matchAll(RE_CIDADE_UF)) {
    const uf = m[2];
    if (!UFS.has(uf)) continue;
    const palavras = m[1].trim().split(/\s+/);
    for (let i = 0; i < palavras.length; i++) {
      const cand = normCidade(palavras.slice(i).join(' '));
      if (!cand || !existe(uf, cand)) continue;
      if (cidadeNorm && cidadeNorm !== cand) continue; // texto fala de OUTRA cidade — não serve
      return { uf, cidadeNorm: cand, cidadeTexto: palavras.slice(i).join(' ') };
    }
  }
  return null;
}

// ── Sinais extras (28/09) — os 20 lotes do invariante não tinham "Cidade-UF", mas tinham prova ──
// "Comarca de Campo Mourão-Pr": UF em caixa baixa (a regex acima exige maiúscula de propósito,
// para não ler "de" como UF; aqui só vale depois de "comarca/cidade de <X>").
const NOMES_UF = { acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', goias: 'GO', maranhao: 'MA', 'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO' };
// "nesta cidade de Joinville", "comarca de Santo André do Estado de São Paulo", "CRI de São Paulo",
// NUNCA "foro": "Foro Regional de Santo Amaro" é bairro de SP, e o município Santo Amaro só existe na BA.
// "Prefeitura Municipal de Joinville", "Registro de Imóveis de Joinville".
const RE_CIDADE_DE = /(?:comarca|cidade|munic[íi]pio|cri|registro de im[óo]veis|prefeitura municipal)\s+(?:de|da|do)\s+([A-Za-zÀ-ÿ'.]+(?:\s+[A-Za-zÀ-ÿ'.]+){0,4})(?:\s*[-–/]\s*([A-Za-z]{2})(?![A-Za-zÀ-ÿ])|\s+do\s+estado\s+(?:de|do|da)\s+([A-Za-zÀ-ÿ ]{4,22}))?/gi;
function daCidadeCitada(texto, cidadeNorm) {
  if (!texto) return null;
  // Casamentos SOBREPOSTOS: em "Registro de Imóveis da Comarca de Santo André" o 1º gatilho
  // engole "Comarca de Santo André do" e o "comarca de" de dentro nunca seria testado.
  const re = new RegExp(RE_CIDADE_DE.source, 'gi');
  for (let m = re.exec(texto); m; re.lastIndex = m.index + 1, m = re.exec(texto)) {
    // "…de Santo André do Estado de São Paulo": as até 5 palavras engolem "do Estado de" — o
    // estado é procurado no trecho logo depois do nome, não só no grupo opcional.
    const depois = String(texto).slice(m.index, m.index + m[0].length + 60);
    const est = depois.match(/do\s+estado\s+(?:de|do|da)\s+([A-Za-zÀ-ÿ]+(?:\s+(?:do|de)?\s*[A-Za-zÀ-ÿ]+){0,3})/i);
    const nomeEst = est ? normCidade(est[1]).split(' ') : [];
    let ufEst = null;
    for (let n = Math.min(4, nomeEst.length); n >= 1 && !ufEst; n--) ufEst = NOMES_UF[nomeEst.slice(0, n).join(' ')] || null;
    const ufDita = m[2] ? m[2].toUpperCase() : (ufEst || (m[3] ? NOMES_UF[normCidade(m[3])] : null));
    const palavras = m[1].trim().split(/\s+/);
    // do MAIOR prefixo para o menor: "Santo André do Estado" → "santo andre"
    for (let n = palavras.length; n >= 1; n--) {
      const cand = normCidade(palavras.slice(0, n).join(' '));
      if (!cand || (cidadeNorm && cidadeNorm !== cand)) continue;
      const ufs = UFS_DA_CIDADE.get(cand);
      if (!ufs) continue;
      const cidadeTexto = palavras.slice(0, n).join(' ').replace(/[.,;:]+$/, '');
      if (ufDita && UFS.has(ufDita)) { if (ufs.has(ufDita)) return { uf: ufDita, cidadeTexto }; continue; }
      if (!ufDita && ufs.size === 1) return { uf: [...ufs][0], cidadeTexto };
    }
  }
  return null;
}
// Número CNJ (…8.TR…) NÃO entra: medido em 28/09 sobre 1.186 lotes com UF gravada, o TJ do
// processo bate com a UF em só 93% (carta precatória corre em outro estado). O CEP, na mesma
// medição, bateu 895 de 901 (99,4%) — esse fica.
// CEP → UF pelas faixas dos Correios. Só com o rótulo "CEP" por perto (número solto não conta).
const FAIXAS_CEP = [[1000,19999,'SP'],[20000,28999,'RJ'],[29000,29999,'ES'],[30000,39999,'MG'],[40000,48999,'BA'],[49000,49999,'SE'],
  [50000,56999,'PE'],[57000,57999,'AL'],[58000,58999,'PB'],[59000,59999,'RN'],[60000,63999,'CE'],[64000,64999,'PI'],[65000,65999,'MA'],
  [66000,68899,'PA'],[68900,68999,'AP'],[69000,69299,'AM'],[69300,69399,'RR'],[69400,69899,'AM'],[69900,69999,'AC'],[70000,72799,'DF'],
  [72800,72999,'GO'],[73000,73699,'DF'],[73700,76799,'GO'],[76800,76999,'RO'],[77000,77999,'TO'],[78000,78899,'MT'],[79000,79999,'MS'],
  [80000,87999,'PR'],[88000,89999,'SC'],[90000,99999,'RS']];
function doCEP(texto) {
  const m = String(texto || '').match(/CEP[^0-9]{0,15}(\d{2})\.?(\d{3})-?\d{3}\b/i);
  if (!m) return null;
  const n = Number(m[1] + m[2]);
  const f = FAIXAS_CEP.find(([a, b]) => n >= a && n <= b);
  return f ? f[2] : null;
}

export function inferirUF({ cidade, titulo, endereco, descricao } = {}) {
  const cn = normCidade(cidade);
  for (const t of [titulo, endereco, descricao]) {
    const r = doTexto(t, cn || null);
    if (r) return cn ? { uf: r.uf, via: 'texto' } : { uf: r.uf, cidade: r.cidadeTexto, via: 'texto' };
  }
  if (cn) {
    const ufs = UFS_DA_CIDADE.get(cn);
    if (ufs && ufs.size === 1) return { uf: [...ufs][0], via: 'cidade_unica' };
  }
  for (const t of [titulo, endereco, descricao]) {
    const r = daCidadeCitada(t, cn || null);
    if (r) return cn ? { uf: r.uf, via: 'cidade_citada' } : { uf: r.uf, cidade: r.cidadeTexto, via: 'cidade_citada' };
  }
  // O CEP prova o ESTADO, não a cidade — com cidade já gravada, ela tem de existir nele.
  const uf = doCEP([titulo, endereco, descricao].filter(Boolean).join(' '));
  if (uf && (!cn || existe(uf, cn))) return { uf, via: 'cep' };
  return null;
}
