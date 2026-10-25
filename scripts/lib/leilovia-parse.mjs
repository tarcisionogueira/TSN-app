/**
 * PARSER plataforma LEILOVIA (ASP.NET WebForms, "Plataforma Leilovia" no rodapé) — pendência 356, 25/10.
 * Tenants (MS): Casa de Leilões (casadeleiloes.com.br — Tarcílio Leite / Gabriel Aude) e RP Leilões (rpleiloes.com.br —
 * Reinaldo Perdomo). Recon pelo servidor do banco: o IIS responde **400 "Invalid Header"** ao cabeçalho de navegador
 * da `pagina_pedir` e **200 sem cabeçalho** (`pagina_pedir_pelada`) — o motor já tenta a pelada depois de um 400
 * (lib/motor/fetch-fonte.mjs, #292).
 *
 * Três níveis, HTML estático:
 *   home                 → leilões   /leilao/<slug>/<id>
 *   leilão               → lotes     /lote/lote-001/<slug>/<id>
 *   lote                 → "Mais detalhes do lote": Lance inicial · Encerramento · Local (o ESTADO por extenso) ·
 *                          Status; "Descrição:" (o texto do edital do bem); "Dados do leilão": vara, 1ª/2ª praça,
 *                          "Leilão: Primeiro|Segundo"; anexos `/envios/leiloes_edital<N>.pdf` com o nome no botão
 *                          ("Ver edital MATRÍCULA IMOBILIÁRIA"); fotos `/envios/leilao_lote_imagem<N>p.jpg`.
 * A avaliação só existe no texto ("avaliado em R$ 85.000,00"); a cidade, idem ("na cidade de Gloria de Dourados/MS")
 * — conferida no IBGE para a UF do campo Local. Sem prova, sem cidade (a vara "DOURADOS (MS)" é comarca, não prova).
 * Os leilões de veículo/sucata (DETRAN, comissão de bens apreendidos) ficam pela metade já na enumeração: lote
 * "suspenso", sucata, "para circular" e placa nem são baixados; o resto passa pelo naoEhImovel do motor.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, montarRowDom, UF_POR_NOME } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2 } from '../../api/_texto-imovel.js';
import { normCidade } from './inferir-uf.mjs';
import { tipoDoTexto, tituloDe, matriculaDe, cidadeComAcento, ehTeste } from './leiloar-parse.mjs';
import MUNICIPIOS from '../../api/_municipios.js';

export const TENANTS = {
  casadeleiloes: { fonte: 'CASADELEILOES', leiloeiro: 'Casa de Leilões (Tarcílio Leite, JUCEMS 003)', base: 'https://www.casadeleiloes.com.br' },
  rpleiloes: { fonte: 'RPLEILOES', leiloeiro: 'Reinaldo Rodrigues Perdomo (JUCEMS 083)', base: 'https://www.rpleiloes.com.br' },
};

const limpar = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const existe = (uf, nome) => !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(nome)}`);
const ufDeNome = (s) => UF_POR_NOME[normCidade(s).replace(/\s+/g, '-')] || null;

// Leilão de veículo, sucata, simulador: nem entra (o acervo é imóvel; os veículos desta plataforma não estão no motor
// de veículos).
const EVENTO_FORA = /simulador|teste|ve[íi]culos?-|sucatas?|reciclagem|detran/i;
// Lote cujo slug já diz que não é imóvel (ou que está suspenso, sem descrição).
const LOTE_FORA = /^suspenso$|sucata|para-circular|placa-|vending|^\/?$/i;

export function extrairUrlsDeEvento(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](?:https?:\/\/[^/"']+)?\/leilao\/([a-z0-9-]+)\/(\d+)["']/gi)) {
    if (EVENTO_FORA.test(m[1]) || ehTeste(m[1])) continue;
    if (!urls.has(m[2])) urls.set(m[2], new URL(`/leilao/${m[1]}/${m[2]}`, base).href);
  }
  return urls;
}

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["'](?:https?:\/\/[^/"']+)?\/lote\/(lote-[a-z0-9-]+)\/([a-z0-9-]*)\/(\d+)["']/gi)) {
    if (LOTE_FORA.test(m[2]) || ehTeste(m[2])) continue;
    if (!urls.has(m[3])) urls.set(m[3], new URL(`/lote/${m[1]}/${m[2]}/${m[3]}`, base).href);
  }
  return urls;
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/[^/]+\/[^/]*\/(\d+)/) || [])[1] || null;

// "06/11/2026 11:03" (horário de Brasília) → ISO.
const dataHora = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(20\d{2})(?:\s+(\d{2}):(\d{2}))?/);
  return m ? `${m[3]}-${m[2]}-${m[1]}T${m[4] || '12'}:${m[5] || '00'}:00-03:00` : null;
};
// <dt>Rótulo:</dt><dd>valor</dd> do bloco "Dados do leilão".
const dd = (h, rot) => limpar((h.match(new RegExp(`<dt[^>]*>\\s*${rot}\\s*<\\/dt>\\s*<dd>([\\s\\S]*?)<\\/dd>`, 'i')) || [])[1]);
// <strong>Rótulo:</strong> valor<br /> do bloco "Mais detalhes do lote".
const forte = (h, rot) => limpar((h.match(new RegExp(`<strong>\\s*${rot}\\s*<\\/strong>([^<]*)`, 'i')) || [])[1]);

// Cidade do bem no texto, sempre conferida no IBGE para a UF do campo Local: "na cidade de Gloria de Dourados/MS",
// "município de X", "X/MS", e por último o cartório de uma matrícula "nesta cidade".
export function cidadeDoTexto(texto, uf) {
  const t = String(texto || '');
  const cands = [];
  for (const m of t.matchAll(/\b(?:cidade|munic[íi]pio|distrito)\s+de\s+([A-ZÀ-Ýa-zà-ÿ' ]{3,40}?)\s*(?:[/-]\s*([A-Z]{2})\b|\(([A-Z]{2})\)|[,.;:]|$)/g)) cands.push([m[1], m[2] || m[3]]);
  for (const m of t.matchAll(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ']+(?:\s+(?:d[aeo]s?|[A-ZÀ-Ý][A-Za-zÀ-ÿ']+)){0,4})\s*\/\s*([A-Z]{2})\b/g)) cands.push([m[1], m[2]]);
  for (const [nome, ufTexto] of cands) {
    if (ufTexto && uf && ufTexto !== uf) continue;
    const u = ufTexto || uf;
    // O maior sufixo que existe ("…na cidade de Gloria de Dourados" → "gloria de dourados").
    const p = nome.trim().split(/\s+/);
    for (let i = 0; i < p.length; i++) {
      const c = p.slice(i).join(' ');
      if (existe(u, c)) return { cidade: cidadeComAcento(c.toUpperCase(), t), estado: u };
    }
  }
  return { cidade: null, estado: uf || null };
}

// Avaliação só no texto: "foi avaliado em R$ 85.000,00", "VALOR DA AVALIAÇÃO: … R$ X", "Avaliação: R$ X". Primeiro
// valor PLAUSÍVEL (R$ 10 mil+): custas e taxas também aparecem com "R$".
// O TOTAL rotulado ganha: o auto de avaliação de Corumbá (66809) avalia "o terreno … em R$ 40.000,00" e "a construção
// … R$ 210.000,00" antes do "Valor da Avaliação Total: R$ 250.000,00".
function avaliacaoDoTexto(t) {
  for (const re of [/(?:valor\s+da\s+avalia[çc][ãa]o(?:\s+total)?|avalia[çc][ãa]o\s+total)[^\d]{0,80}?R\$\s*([\d.]{1,15},\d{2})/gi,
    /avalia(?:do|da|dos|das|[çc][ãa]o)[^\d]{0,80}?R\$\s*([\d.]{1,15},\d{2})/gi]) {
    for (const m of String(t || '').matchAll(re)) {
      const v = num(m[1]);
      if (v >= 10_000 && v <= 500_000_000) return v;
    }
  }
  return 0;
}

const TIPO_ANEXO = [[/edital/i, 'edital'], [/matr[íi]cula/i, 'matricula'], [/laudo|avalia/i, 'laudo']];

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  if (!/Mais detalhes do lote/i.test(h)) return null; // não é a página de lote (layout mudou / erro)
  const status = limpar((h.match(/Status:\s*([^<]+)/i) || [])[1]).toUpperCase();
  const vara = limpar((h.match(/Dados do leil[ãa]o\s*<\/h3>[\s\S]*?<h4>([\s\S]*?)<\/h4>/i) || [])[1]);
  if (ehTeste(vara)) return { encerrado: true, teste: true };
  const local = forte(h, 'Local:') || dd(h, 'Local:');
  const uf = ufDeNome(local) || (/^[A-Z]{2}$/.test(local) ? local : null);
  const descricao = limpar((h.match(/<h4>\s*Descri[çc][ãa]o:\s*<\/h4>([\s\S]*?)(?=Processo\s+n[º°o]|<\/div>\s*<\/div>\s*<\/div>\s*<div class="col-sm-6 box-dados">)/i) || [])[1])
    .replace(/^\d+\)\s*DESCRI[ÇC][ÃA]O DO\(S\) BEM\(NS\):\s*/i, '');
  const processo = limpar((h.match(/Processo\s+n[º°o]:?\s*([\d.\-/ ]{10,30})/i) || [])[1]) || null;

  const minimo = plaus(num(forte(h, 'Lance inicial:')));
  const encerra = dataHora(forte(h, 'Encerramento:') || dd(h, 'Encerramento:'));
  const segunda = dataHora(dd(h, '2ª praça:'));
  const qual = dd(h, 'Leil[ãa]o:'); // "Primeiro" | "Segundo" | "Único"
  // Na 1ª praça judicial o lance inicial É a avaliação; o texto do edital, quando traz, manda.
  const avaliacao = avaliacaoDoTexto(descricao) || (/primeiro/i.test(qual) ? minimo : 0);
  const { cidade, estado } = cidadeDoTexto(descricao, uf);

  const anexos = [];
  for (const m of h.matchAll(/href="(\/envios\/leiloes_edital\d+\.(?:pdf|docx?))"[^>]*>\s*Ver edital\s*([^<]*)/gi)) {
    const nome = limpar(m[2]) || 'Edital';
    anexos.push({ tipo: TIPO_ANEXO.find(([re]) => re.test(nome))?.[1] || 'documento', nome, url: new URL(m[1], url).href });
  }
  const edital = anexos.find((a) => a.tipo === 'edital')?.url || anexos[0]?.url || null;
  const matricula = anexos.find((a) => a.tipo === 'matricula')?.url || null;
  const fotos = [...new Set([...h.matchAll(/src=['"](\/envios\/leilao_lote_imagem\d+[a-z]?\.(?:jpe?g|png|webp))['"]/gi)].map((m) => new URL(m[1], url).href))];

  // Tipo pelo COMEÇO do texto do bem: o edital segue com regras gerais ("exclusivamente para Bens Imóveis e Veículos…",
  // "escritório da Casa de Leilões") que dariam tipo a um carro.
  const inicio = descricao.slice(0, 400);
  const tipo = /\bplaca\b|\bchassi\b|\brenavam\b/i.test(inicio) ? 'Bem' : tipoDoTexto(inicio);
  const dataFinal = Date.parse(segunda && segunda > (encerra || '') ? segunda : encerra || '');
  return {
    titulo: tituloDe(inicio, cidade, estado), cidade, estado,
    // Sem nenhum tipo de imóvel no texto ("madeiras serradas", "máquina vending") não é imóvel.
    naoImovel: tipo === 'Bem',
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade: /extrajudicial/i.test(vara) ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(descricao) || 0,
    descricao: [vara, descricao, processo ? `Processo nº ${processo}` : ''].filter(Boolean).join('. ').slice(0, 8000) || null,
    data_leilao: encerra,
    data_leilao_2: /primeiro/i.test(qual) && segunda && segunda !== encerra ? segunda : null,
    link_foto: fotos[0] || null, fotos,
    link_edital: edital || url, link_matricula: matricula, anexos,
    numero_matricula: matriculaDe(descricao),
    // "EM LEILÃO", "EM LOTEAMENTO", "AGUARDANDO" seguem; vendido, suspenso, cancelado, encerrado, retirado saem.
    encerrado: (!!status && !/EM LEIL|LOTEAMENTO|AGUARD|ABERT|BREVE|ANDAMENTO/.test(status)) || (Number.isFinite(dataFinal) && dataFinal < agora),
  };
}

export const montarRow = (url, det, tenant) => {
  const row = montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
  if (det.fotos?.length > 1) row.fotos = det.fotos;
  return row;
};
export { checarQualidade };
