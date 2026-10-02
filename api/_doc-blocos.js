// QUALQUER ARQUIVO → BLOCOS PARA A IA (02/10). Os leitores de anexo fixavam
// `media_type: 'application/pdf'` para tudo (processar-analise, validar-anexos-arremate) ou mandavam
// "não-PDF" como imagem (saque-nf): matrícula enviada como FOTO subia normalmente e chegava à IA
// rotulada de PDF — leitura falha com cara de documento lido. Aqui o formato é detectado pelos bytes
// e convertido pelo mesmo leitor do documental (api/_doc-normalizar.js): PDF → `document`, foto
// (inclusive HEIC/TIFF, convertidos) → `image`, Word/texto → `text`, ZIP → cada arquivo de dentro.
// O que não abre volta em `falhas`, COM motivo — nunca some calado.
import { normalizarDocumento } from './_doc-normalizar.js';

/**
 * @returns {Promise<{ blocos: object[], falhas: string[] }>}
 */
export async function blocosDoArquivo(buf, { nome = 'documento', contentType = '', maxTexto = 60000 } = {}) {
  const blocos = [];
  const falhas = [];
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const um = (d, rotulo) => {
    if (d?.kind === 'pdf' && d.base64) blocos.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: d.base64 }, title: String(rotulo).slice(0, 200) });
    else if (d?.kind === 'imagem' && d.base64) blocos.push({ type: 'image', source: { type: 'base64', media_type: d.mediaType, data: d.base64 } });
    else if (d?.kind === 'texto' && d.texto) blocos.push({ type: 'text', text: `=== ${rotulo} ===\n${String(d.texto).slice(0, maxTexto)}` });
    else falhas.push(`${rotulo}: ${d?.motivo || 'não foi possível ler'}`);
  };
  try {
    const doc = await normalizarDocumento(b, { url: nome, contentType });
    if (doc.kind === 'pacote') {
      for (const it of doc.itens || []) um(it, it.nome || nome);
      falhas.push(...(doc.falhas || []));
    } else um(doc, nome);
  } catch (e) {
    console.warn('[doc-blocos] conversão falhou:', nome, e?.message || e);
    falhas.push(`${nome}: ${String(e?.message || e).slice(0, 100)}`);
  }
  return { blocos, falhas };
}
