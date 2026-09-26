/**
 * ANO (E PLACA) DO VEÍCULO PELO EDITAL OU PELA PÁGINA DO LOTE — sob demanda, ao abrir a tela
 * (26/09, dono: "quase todos disponibilizam de alguma forma um edital, seja texto, PDF ou imagem").
 *
 * Sem ano não há FIPE. O gatilho `veiculo_ano_do_texto` já lê o texto da LISTAGEM; aqui vai um
 * degrau além, só para o veículo que alguém abriu (custo zero — PDF com camada de texto e HTML
 * público, sem Bright Data e sem IA):
 *   1. edital(is) em PDF do lote → acha o TRECHO do lote (placa/chassi/modelo) e lê o ano ali;
 *      documento de um lote só → o texto todo vale;
 *   2. senão, a página do lote (HTML) — é a página de UM lote, o texto todo vale.
 * Edital que é imagem/escaneado (sem camada de texto) fica de fora: ler exigiria OCR/IA (custo).
 * Mesmas regras de `extrair_ano_veiculo()` no banco (supabase/migrations/veiculo_ano_do_texto.sql)
 * — manter as duas em sincronia.
 */
import { carregarPDFParse } from './_pdf-safe.js';
import { urlDiretaDoDocumento } from './_anexo-nome.js';

const A = '(19[5-9]\\d|20[0-4]\\d)';
const RE = {
  barra: new RegExp(`${A}\\s*/\\s*${A}`),
  mod2: /ano\s*\/?\s*mod[a-z.]*\s*[:\-]?\s*(\d{2})\s*\/\s*(\d{2})\b/i,
  fabMod: new RegExp(`ano\\s*(?:de\\s*)?fab[a-zçãõ.]*\\s*[:\\-]?\\s*${A}[^0-9]{1,25}?mod[a-z.]*\\s*[:\\-]?\\s*${A}`, 'i'),
  anoModelo: new RegExp(`\\bano\\s*[:\\-]?\\s*${A}[\\s,;/]*modelo\\s*[:\\-]?\\s*${A}`, 'i'),
  anoBarraModelo: new RegExp(`ano\\s*(?:de\\s*)?(?:fabrica[çc][ãa]o\\s*)?/\\s*modelo\\s*[:\\-]?\\s*${A}`, 'i'),
  fab: new RegExp(`ano\\s*(?:de\\s*)?fab[a-zçãõ.]*\\s*[:\\-]?\\s*${A}`, 'i'),
  ano: new RegExp(`\\bano\\s*[:\\-]?\\s*${A}\\b`, 'i'),
};
const dois = (yy) => (Number(yy) <= 30 ? 2000 : 1900) + Number(yy);

/** Ano de fabricação/modelo num texto (mesma ordem da função do banco). null = não achou. */
export function extrairAnoTexto(texto) {
  const t = String(texto || '').replace(/&nbsp;|\s+/g, ' ');
  if (/lote com \d+|\b\d+ ve[ií]culos\b/i.test(t)) return null;
  let r = null, m;
  if ((m = t.match(RE.barra))) r = [+m[1], +m[2]];
  else if ((m = t.match(RE.mod2))) r = [dois(m[1]), dois(m[2])];
  else if ((m = t.match(RE.fabMod))) r = [+m[1], +m[2]];
  else if ((m = t.match(RE.anoModelo))) r = [+m[1], +m[2]];
  else if ((m = t.match(RE.anoBarraModelo))) r = [+m[1], +m[1]];
  else if ((m = t.match(RE.fab))) r = [+m[1], null];
  else if ((m = t.match(RE.ano))) r = [+m[1], null];
  if (!r) return null;
  const lim = new Date().getFullYear() + 1;
  if (r[0] > lim || (r[1] ?? r[0]) > lim || (r[1] != null && (r[1] < r[0] || r[1] - r[0] > 1))) return null;
  return r;
}

// Placa COMPLETA (antiga ou Mercosul). Mascarada ("J*****2", "final 88") não casa, de propósito.
const RE_PLACA = /\bplacas?\s*[:\-]?\s*([A-Z]{3}[\s-]?\d[A-Z0-9]\d{2})\b/i;
export function extrairPlacaCompleta(texto) {
  const m = String(texto || '').match(RE_PLACA);
  return m ? m[1].replace(/[\s-]/g, '').toUpperCase() : null;
}

const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

function ancorasDoLote(v) {
  const ancoras = [];
  if (v.placa) ancoras.push(String(v.placa).replace(/[^A-Za-z0-9]/g, ''));
  if (v.chassi) ancoras.push(String(v.chassi));
  // Modelo pelo título, sem a palavra genérica do começo ("Carro Fiat Uno" → "Fiat Uno").
  const base = String(v.modelo || v.titulo || '').replace(/^.*?\//, '').replace(/^(carro|moto(cicleta)?|ve[ií]culo|caminh[ãa]o|caminhonete|carca[çc]a de carro|carca[çc]a)\s+/i, '');
  const modelo = base.split(/[-–,|(]/)[0].trim().split(/\s+/).slice(0, 2).join(' ');
  if (modelo.length >= 4) ancoras.push(modelo);
  return ancoras;
}

// PÁGINA DO LOTE (26/09, seco): a página da MEGA mostra OUTROS lotes (carrossel/relacionados) e o
// 1º "ano" da página era de outro lote — 14 lotes diferentes saíram "2003, placa CYA8653". Aqui
// só vale o texto em volta do NOSSO lote (cada ocorrência da âncora), e só se todas as janelas
// que têm ano concordarem. Divergiu ou não achou âncora → não usa.
function anoNaPagina(texto, v) {
  const tn = norm(texto);
  for (const a of ancorasDoLote(v)) {
    const an = norm(a);
    const achados = [];
    for (let i = tn.indexOf(an), n = 0; i >= 0 && n < 6; i = tn.indexOf(an, i + an.length), n++) {
      const jan = trechoAPartir(texto, i);
      const ano = extrairAnoTexto(jan);
      if (ano) achados.push({ ano, placa: extrairPlacaCompleta(jan) });
    }
    if (!achados.length) continue;
    const chave = (x) => x.ano.join('/');
    if (achados.every((x) => chave(x) === chave(achados[0]))) return achados[0];
    return { divergente: true };
  }
  return null;
}

// Trecho do LOTE: começa um pouco antes da âncora e vai só até onde começa o PRÓXIMO lote (seco
// de 26/09: com ±700 caracteres a janela pegava o lote vizinho do edital — a mesma placa saiu em
// dois lotes diferentes, "Gol 1.0L" e "Spin"). Marcador de lote: "Lote 12", "LOTE: 3", "\n 07 ".
const RE_PROXIMO_LOTE = /\blote\s*(?:n[º°o.]*\s*)?:?\s*\d{1,4}\b|\s\d{2,3}\s+(?=[A-Z]{3}\d[A-Z0-9]\d{2}\b)/gi;
export function trechoAPartir(texto, i) {
  const ini = Math.max(0, i - 60);
  RE_PROXIMO_LOTE.lastIndex = i + 40;
  const m = RE_PROXIMO_LOTE.exec(texto);
  const fim = Math.min(texto.length, i + 450, m ? m.index : Infinity);
  return texto.slice(ini, fim);
}

// Janela do texto em volta do lote, achada pela âncora mais forte que existir.
function janelaDoLote(texto, v) {
  const tn = norm(texto);
  for (const a of ancorasDoLote(v)) {
    const i = tn.indexOf(norm(a));
    if (i >= 0 && tn.split(norm(a)).length - 1 === 1) return trechoAPartir(texto, i); // âncora única no documento
  }
  return null;
}

async function textoDoPdf(url, PDFParse) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) return { erro: `pdf http_${r.status}` };
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.subarray(0, 5).toString() !== '%PDF-') return { erro: 'nao_e_pdf' };
  if (buf.length > 10 * 1024 * 1024) return { erro: 'pdf > 10 MB' };
  const p = new PDFParse({ data: buf });
  try {
    const t = String((await p.getText())?.text || '').replace(/\s+/g, ' ');
    return t.replace(/\s/g, '').length < 200 ? { erro: 'pdf sem camada de texto (imagem)' } : { t };
  } finally { await p.destroy().catch(() => {}); }
}

async function textoDaPagina(url) {
  const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0', 'Accept-Language': 'pt-BR' }, redirect: 'follow', signal: AbortSignal.timeout(7000) });
  if (!r.ok) return { erro: `pagina http_${r.status}` };
  const html = await r.text();
  return { t: html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ') };
}

/**
 * @param v veículo com {id, titulo, modelo, placa, chassi, anexos, link_lote}
 * @param lotesPorDoc (url) => quantos veículos do acervo usam aquele PDF (1 = documento do lote)
 * O chamador ainda confere a placa contra o acervo (placa de OUTRO veículo = leitura errada).
 * @returns {Promise<{ano: number[]|null, placa: string|null, fonte: string|null, motivos: string[]}>}
 */
export async function anoPorDocumento(v, lotesPorDoc = async () => 2) {
  const motivos = [];
  // O próprio TÍTULO com ano ("KOMATSU PC 200 SÉRIE 8 2011-NO ESTADO") vence qualquer documento.
  const doTitulo = String(v.titulo || '').match(/(?:^|[\s\-–(])(19[6-9]\d|20[0-4]\d)(?=$|[\s\-–,|)/])/);
  if (doTitulo && +doTitulo[1] <= new Date().getFullYear() + 1) return { ano: [+doTitulo[1], null], placa: null, fonte: 'titulo', motivos };
  const pdfs = (Array.isArray(v.anexos) ? v.anexos : [])
    .filter((a) => a?.url && (a.tipo === 'edital' || /\.pdf(?:[?#]|$)/i.test(a.url)))
    .sort((a, b) => (b.tipo === 'edital') - (a.tipo === 'edital'))
    .slice(0, 2);
  if (pdfs.length) {
    const PDFParse = await carregarPDFParse().catch((e) => { motivos.push(`pdf-parse indisponível: ${String(e?.message || e).slice(0, 60)}`); return null; });
    for (const a of PDFParse ? pdfs : []) {
      const url = urlDiretaDoDocumento(a.url);
      try {
        const { t, erro } = await textoDoPdf(url, PDFParse);
        if (!t) { motivos.push(erro); continue; }
        const janela = janelaDoLote(t, v) || ((await lotesPorDoc(a.url)) <= 1 ? t : null);
        if (!janela) { motivos.push('lote não localizado no edital'); continue; }
        const ano = extrairAnoTexto(janela);
        if (ano) return { ano, placa: extrairPlacaCompleta(janela), fonte: 'edital', motivos };
        motivos.push('edital sem ano no trecho do lote');
      } catch (e) { motivos.push(`pdf: ${String(e?.message || e).slice(0, 60)}`); }
    }
  }
  if (v.link_lote) {
    try {
      const { t, erro } = await textoDaPagina(v.link_lote);
      if (t) {
        const achado = anoNaPagina(t, v);
        if (achado?.ano) return { ano: achado.ano, placa: achado.placa, fonte: 'pagina_do_lote', motivos };
        motivos.push(achado?.divergente ? 'página do lote com anos divergentes (outros lotes na página)' : 'página do lote sem ano no trecho do lote');
      } else motivos.push(erro);
    } catch (e) { motivos.push(`página: ${String(e?.message || e).slice(0, 60)}`); }
  }
  return { ano: null, placa: null, fonte: null, motivos };
}
