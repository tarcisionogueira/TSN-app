// QUE DOCUMENTO É ESTE? — pelo CONTEÚDO, não pelo nome do link (05/10, resíduo da pendência 49).
// Vários leiloeiros publicam tudo como "Documento" (FERREIRA, FRANCO, JE, ROCHA, THAIS…): o espelho
// copiou ~900 PDFs como tipo 'outro' e o selo/relatório não sabiam que ali havia matrícula ou edital.
// Regra deliberadamente conservadora: na dúvida devolve null e o tipo fica como estava.
import { carregarPDFParse } from './_pdf-safe.js';

const CABECA = 2500; // o título do documento está no começo — o corpo do edital CITA a matrícula

export function classificarTipoPorTexto(texto) {
  const t = String(texto || '').replace(/\s+/g, ' ');
  if (t.length < 200) return null;
  const cabeca = t.slice(0, CABECA);
  // EDITAL primeiro e só pelo TÍTULO na cabeça: todo edital cita "matrícula nº X do Registro de
  // Imóveis", e testar matrícula antes faria o edital virar matrícula.
  if (/\bEDITAL\s+(?:DE\s+|D[EO]S?\s+)?(?:\d[ºo°]?\s*(?:E|\/)\s*\d[ºo°]?\s*)?(?:LEIL[ÃA]O|LEIL[ÕO]ES|PRA[ÇC]A|HASTA|ALIENA[ÇC][ÃA]O|VENDA|CONCORR)/i.test(cabeca)
    || (/\bEDITAL\b/i.test(cabeca.slice(0, 600)) && /\bleiloeir[oa]\b/i.test(cabeca))) return 'edital';
  const registro = /REGISTRO\s+DE\s+IM[ÓO]VEIS|OF[ÍI]CIO\s+DE\s+REGISTRO|\bCNM\s*[:\-]?\s*\d|LIVRO\s*(?:N[º°o.]?\s*)?2\b|REGISTRO\s+GERAL/i.test(cabeca);
  const matricula = /\bMATR[ÍI]CULA\s*(?:N[º°o.]*\s*)?[:\-–]?\s*\d{1,3}(?:\.?\d{3})*/i.test(cabeca);
  const atos = (t.match(/\b(?:R|AV)\s*[\.\-–]\s*\d{1,3}\s*[\/\-–\.]\s*\d/gi) || []).length;
  if (registro && (matricula || atos >= 1)) return 'matricula';
  if (matricula && atos >= 2) return 'matricula';
  if (/LAUDO\s+DE\s+AVALIA[ÇC][ÃA]O|PARECER\s+T[ÉE]CNICO\s+DE\s+AVALIA|AUTO\s+DE\s+AVALIA[ÇC][ÃA]O/i.test(cabeca)) return 'laudo';
  return null;
}

/** Lê só as 2 primeiras páginas de um PDF (rápido e barato). PDF escaneado → null. Nunca lança. */
export async function tipoPorConteudoPdf(buf) {
  try {
    const PDFParse = await carregarPDFParse();
    const parser = new PDFParse({ data: buf });
    try {
      const res = await parser.getText({ first: 2 });
      return classificarTipoPorTexto(res?.text || '');
    } finally { await parser.destroy().catch(() => {}); }
  } catch (e) { console.error('[doc-tipo] leitura do PDF falhou:', String(e?.message || e).slice(0, 80)); return null; }
}
