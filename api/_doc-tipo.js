// QUE DOCUMENTO É ESTE? — pelo CONTEÚDO, não pelo nome do link (05/10, resíduo da pendência 49).
// Vários leiloeiros publicam tudo como "Documento" (FERREIRA, FRANCO, JE, ROCHA, THAIS…): o espelho
// copiou ~900 PDFs como tipo 'outro' e o selo/relatório não sabiam que ali havia matrícula ou edital.
// Regra deliberadamente conservadora: na dúvida devolve null e o tipo fica como estava.
import { carregarPDFParse } from './_pdf-safe.js';

const CABECA = 2500; // o título do documento está no começo — o corpo do edital CITA a matrícula

export function classificarTipoPorTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 60) return null;
  const topo = t.slice(0, 400);      // título/cabeçalho de quem EMITIU o documento
  const cabeca = t.slice(0, CABECA);
  // 1) NÃO é documento do imóvel (medido na amostra de 05/10): formulário de proposta, contrato de
  //    adesão, termo de cadastro, cartilha, anexos de edital (discriminação de lotes), cálculos, croqui.
  if (/PROPONENTE|MODELO DE PROPOSTA|CONTRATO DE ADES[ÃA]O|TERMO DE CADASTRO|CARTILHA|\bANEXO\s+[IVX]{1,4}\b|C[ÁA]LCULO DE ATUALIZA|\bCROQUI\b|AN[ÁA]LISE T[ÉE]CNICA COMERCIAL/i.test(topo)) return null;
  // 2) LAUDO pelo TÍTULO — antes da matrícula: auto de avaliação cita matrícula e registro de imóveis.
  if (/LAUDO\s+DE\s+AVALIA|PARECER\s+T[ÉE]CNICO\s+DE\s+AVALIA|AUTO\s+DE\s+(?:RE)?AVALIA[ÇC][ÃA]O|AUTO\s+DE\s+PENHORA\s+E\s+AVALIA/i.test(topo)) return 'laudo';
  // 3) EDITAL pelo TÍTULO na cabeça — antes da matrícula: todo edital cita "matrícula nº X do Registro
  //    de Imóveis", e testar matrícula antes faria o edital virar matrícula.
  if (/\bEDITAL\s+(?:DE\s+|D[EO]S?\s+)?(?:\d[ºo°]?\s*(?:E|\/)\s*\d[ºo°]?\s*)?(?:LEIL[ÃA]O|LEIL[ÕO]ES|PRA[ÇC]A|HASTA|ALIENA[ÇC][ÃA]O|VENDA|CONCORR)/i.test(cabeca)
    || (/\bEDITAL\b/i.test(cabeca.slice(0, 600)) && /\bleiloeir[oa]\b/i.test(cabeca))) return 'edital';
  // 4) MATRÍCULA emitida pelo CARTÓRIO: o cabeçalho é do registro de imóveis (certidão de inteiro teor,
  //    RI Digital, Assinador do RI). A 1ª página costuma ser imagem — só o cabeçalho vira texto.
  if (/ASSINADOR\s+REGISTRO\s+DE\s+IM|RI\s*DIGITAL|RIDIGITAL|OF[ÍI]CIO\s+D[EO]\s+REGISTRO\s+DE\s+IM|SERVI[ÇC]O\s+REGISTRAL\s+IMOBILI|CART[ÓO]RIO\s+D[EO]\s+REGISTRO\s+DE\s+IM|\bREGISTRO\s+DE\s+IM[ÓO]VEIS\b/i.test(topo)) return 'matricula';
  const registro = /REGISTRO\s+DE\s+IM[ÓO]VEIS|OF[ÍI]CIO\s+DE\s+REGISTRO|\bCNM\s*[:\-]?\s*\d|LIVRO\s*(?:N[º°o.]?\s*)?2\b|REGISTRO\s+GERAL/i.test(cabeca);
  const matricula = /\bMATR[ÍI]CULA\s*(?:N[º°o.]*\s*)?[:\-–]?\s*\d{1,3}(?:\.?\d{3})*/i.test(cabeca);
  const atos = (t.match(/\b(?:R|AV)\s*[\.\-–]\s*\d{1,3}\s*[\/\-–\.]\s*\d/gi) || []).length;
  if (registro && matricula && atos >= 1) return 'matricula';
  if (matricula && atos >= 2) return 'matricula';
  return null;
}

/** Lê só as 2 primeiras páginas de um PDF (rápido e barato). PDF escaneado → null. Nunca lança. */
export async function tipoPorConteudoPdf(buf, { comTexto = false } = {}) {
  try {
    const PDFParse = await carregarPDFParse();
    const parser = new PDFParse({ data: buf });
    try {
      const res = await parser.getText({ first: 2 });
      const tipo = classificarTipoPorTexto(res?.text || '');
      return comTexto ? { tipo, cabeca: String(res?.text || '').replace(/\s+/g, ' ').trim().slice(0, 160) } : tipo;
    } finally { await parser.destroy().catch(() => {}); }
  } catch (e) { console.error('[doc-tipo] leitura do PDF falhou:', String(e?.message || e).slice(0, 80)); return comTexto ? { tipo: null, cabeca: '(falha de leitura)' } : null; }
}
