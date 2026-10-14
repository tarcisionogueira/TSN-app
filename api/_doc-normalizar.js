// LEITURA INDEPENDENTE DE FORMATO (01/10, regra do dono): "precisa sempre ler o arquivo que foi
// fornecido pelo leiloeiro independente de formato". `classificarDocumento` (_doc-leitura.js)
// só reconhece o que a IA lê nativamente — PDF até 18 MB e JPEG/PNG/GIF/WebP — e devolvia
// `desconhecido` para o resto: DOCX, TIFF/BMP/HEIC, imagem ou PDF grande demais. Esses arquivos
// eram DESCARTADOS em silêncio e o relatório saía com o que sobrou. Aqui cada um deles ganha uma
// rota de conversão com as dependências que o projeto já tem (mammoth, sharp, pdf-parse); o que
// nenhuma rota abrir volta com `motivo`, para o gerador NÃO liberar o relatório sem ele.
import { classificarDocumento, MAX_BYTES_VISAO } from './_doc-leitura.js';
import { carregarPDFParse } from './_pdf-safe.js';

const TEXTO_MAX = 60000;      // texto convertido (DOCX, PDF grande): matrícula longa cabe inteira

// ── Planilhas e ODF (14/10) ─────────────────────────────────────────────────────────────────
const desescapar = (t) => String(t || '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// XLSX = ZIP com xl/sharedStrings.xml (textos) + xl/worksheets/sheetN.xml (células). Cada linha vira
// "A | B | C" — a IA lê tabela de débitos/cronograma como lê um texto, e o valor numérico vem cru.
async function planilhaXlsxParaTexto(zip) {
  const sharedXml = zip.file('xl/sharedStrings.xml') ? await zip.file('xl/sharedStrings.xml').async('string') : '';
  const shared = [...sharedXml.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => desescapar([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const abas = Object.keys(zip.files).filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n)).sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  const partes = [];
  for (const nome of abas.slice(0, 10)) {
    const xml = await zip.file(nome).async('string');
    const linhas = [];
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cels = [...row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)].map((c) => {
        const tipo = (c[1].match(/\bt="([^"]+)"/) || [])[1];
        const v = (c[2].match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        if (tipo === 's') return shared[Number(v)] ?? '';
        if (tipo === 'inlineStr') return desescapar([...c[2].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join(''));
        return desescapar(v ?? '');
      }).map((x) => String(x).trim());
      if (cels.some(Boolean)) linhas.push(cels.join(' | '));
      if (linhas.length >= 2000) break;
    }
    if (linhas.length) partes.push(`=== Planilha: aba ${partes.length + 1} ===\n${linhas.join('\n')}`);
  }
  return partes.join('\n\n').trim();
}
// ODT/ODS: content.xml — parágrafos e células viram linhas; tags de estilo somem.
function xmlOdfParaTexto(xml) {
  return desescapar(String(xml || '')
    .replace(/<text:tab\/>/g, '\t').replace(/<text:line-break\/>/g, '\n')
    .replace(/<\/table:table-cell>/g, ' | ').replace(/<\/table:table-row>/g, '\n')
    .replace(/<\/text:p>|<\/text:h>/g, '\n')
    .replace(/<[^>]+>/g, '')).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const IMG_LADO_MAX = 2400;    // px: legível para a visão e bem abaixo do teto de bytes

const ascii = (buf, i, f) => buf.slice(i, f).toString('latin1');
const ehHeic = (buf) => buf.length > 12 && ascii(buf, 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(ascii(buf, 8, 12));

async function imagemParaJpeg(buf) {
  const sharp = (await import('sharp')).default;
  const out = await sharp(buf, { failOn: 'none' }).rotate()
    .resize({ width: IMG_LADO_MAX, height: IMG_LADO_MAX, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 82 }).toBuffer();
  return { kind: 'imagem', mediaType: 'image/jpeg', base64: out.toString('base64'), convertido: 'imagem→jpeg' };
}

async function pdfParaTexto(buf) {
  const PDFParse = await carregarPDFParse();
  const parser = new PDFParse({ data: buf });
  try {
    const texto = String((await parser.getText())?.text || '').replace(/[ \t]+/g, ' ').trim();
    return texto;
  } finally { await parser.destroy().catch(() => {}); }
}

/**
 * Lê qualquer arquivo recebido. → `{ kind: 'pdf'|'imagem'|'texto', ... }`, `{ kind: 'pacote', itens }`
 * (ZIP com vários documentos) ou
 * `{ kind: 'ilegivel', motivo }`. Nunca lança: falha de conversão vira `motivo`.
 */
export async function normalizarDocumento(buf, { url = '', contentType = '', profundidade = 0 } = {}) {
  const base = classificarDocumento(buf, { url, contentType });
  if (base.kind !== 'desconhecido') return base;
  const motivoOriginal = base.motivo || 'formato não reconhecido';
  try {
    // ZIP: DOCX (edital/regulamento em Word, comum em leiloeiro pequeno) ou PACOTE de documentos
    // ("documentos do lote.zip"). A distinção é pela LISTA DE ENTRADAS — procurar o nome
    // `word/document.xml` nos bytes confundia um ZIP que CONTÉM um .docx com o próprio .docx.
    if (ascii(buf, 0, 4) === 'PK\x03\x04') {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(buf);
      if (zip.file('word/document.xml')) {
        const mammoth = (await import('mammoth')).default;
        const { value } = await mammoth.extractRawText({ buffer: buf });
        const texto = String(value || '').replace(/\s+\n/g, '\n').trim();
        if (texto.length >= 80) return { kind: 'texto', mediaType: 'text/plain', texto: texto.slice(0, TEXTO_MAX), convertido: 'docx→texto' };
        return { kind: 'ilegivel', motivo: 'DOCX sem texto extraível' };
      }
      // PLANILHA (.xlsx) e ODF (.odt/.ods) — 14/10, pedido do dono: "ler arquivos, imagens, planilhas, tudo o
      // que o leiloeiro forneça". Antes caíam no ramo de PACOTE abaixo e cada XML interno virava "texto" cru
      // (tags, estilos), com cara de documento lido. Aqui viram texto TABULAR legível, sem dependência nova.
      if (zip.file('xl/workbook.xml')) {
        const texto = await planilhaXlsxParaTexto(zip);
        if (texto.length >= 40) return { kind: 'texto', mediaType: 'text/plain', texto: texto.slice(0, TEXTO_MAX), convertido: 'xlsx→texto' };
        return { kind: 'ilegivel', motivo: 'planilha XLSX sem conteúdo legível' };
      }
      if (zip.file('content.xml') && zip.file('mimetype')) {
        const tipoOdf = String(await zip.file('mimetype').async('string')).trim();
        const xml = await zip.file('content.xml').async('string');
        const texto = xmlOdfParaTexto(xml);
        if (texto.length >= 40) return { kind: 'texto', mediaType: 'text/plain', texto: texto.slice(0, TEXTO_MAX), convertido: `${/spreadsheet/.test(tipoOdf) ? 'ods' : 'odt'}→texto` };
        return { kind: 'ilegivel', motivo: 'documento ODF sem texto extraível' };
      }
      if (profundidade >= 1) return { kind: 'ilegivel', motivo: 'ZIP dentro de ZIP não é aberto' };
      // Pacote: lê CADA arquivo interno pela mesma rota (teto de 8 itens).
      const entradas = Object.values(zip.files).filter((f) => !f.dir && !/^(__MACOSX|\.)/.test(f.name.split('/').pop() || '')).slice(0, 8);
      const itens = [];
      const falhas = [];
      for (const f of entradas) {
        const conteudo = await f.async('nodebuffer');
        const d = await normalizarDocumento(conteudo, { url: f.name, profundidade: profundidade + 1 });
        if (d.kind === 'ilegivel' || d.kind === 'desconhecido') falhas.push(`${f.name}: ${d.motivo || 'ilegível'}`);
        else itens.push({ ...d, nome: f.name });
      }
      if (itens.length) return { kind: 'pacote', itens, falhas, convertido: `zip→${itens.length} arquivo(s)` };
      return { kind: 'ilegivel', motivo: `ZIP sem documento legível${falhas.length ? ` (${falhas.join('; ').slice(0, 160)})` : ''}` };
    }
    // WORD ANTIGO (.doc, contêiner OLE2) — 05/10, pendência 49: 119 dos 158 editais do Leilão
    // Brasil são .doc e caíam aqui como "formato não reconhecido". O mammoth só abre .docx.
    if (buf.length > 8 && buf.readUInt32BE(0) === 0xD0CF11E0 && buf.readUInt32BE(4) === 0xA1B11AE1) {
      const WordExtractor = (await import('word-extractor')).default;
      const doc = await new WordExtractor().extract(buf);
      const texto = String(doc.getBody() || '').replace(/\r/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
      if (texto.length >= 80) return { kind: 'texto', mediaType: 'text/plain', texto: texto.slice(0, TEXTO_MAX), convertido: 'doc→texto' };
      return { kind: 'ilegivel', motivo: 'DOC (Word antigo) sem texto extraível' };
    }
    // Imagem que a IA não aceita (TIFF, BMP, HEIC…) ou grande demais → JPEG reduzido.
    if (String(base.mediaType || '').startsWith('image/') || ehHeic(buf)) {
      return await imagemParaJpeg(buf);
    }
    // PDF acima do teto da visão → texto extraído (camada de texto). Escaneado gigante não
    // tem texto: aí não há como ler sem dividir o arquivo, e volta ilegível COM motivo.
    if (base.mediaType === 'application/pdf' && buf.length > MAX_BYTES_VISAO) {
      const texto = await pdfParaTexto(buf);
      if (texto.length >= 400) return { kind: 'texto', mediaType: 'text/plain', texto: texto.slice(0, TEXTO_MAX), convertido: 'pdf grande→texto' };
      return { kind: 'ilegivel', motivo: `${motivoOriginal}; sem camada de texto (escaneado)` };
    }
  } catch (e) {
    return { kind: 'ilegivel', motivo: `${motivoOriginal}; conversão falhou: ${String(e?.message || e).slice(0, 80)}` };
  }
  return { kind: 'ilegivel', motivo: motivoOriginal };
}
