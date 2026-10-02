// QUE ARQUIVO É ESTE — pelo CONTEÚDO, não pelo que o navegador declarou (02/10, pedido do dono:
// "em qualquer campo do sistema poder assimilar foto, PDF ou arquivo de texto").
//
// Os porteiros de upload (api/upload-anexo.js, api/doc-pessoal.js) só deixavam passar PDF/JPG/PNG,
// enquanto a tela de cada campo oferecia uma lista diferente — o cliente escolhia um arquivo que o
// campo aceitava e o servidor recusava. Esta é a lista ÚNICA do lado do servidor, espelho de
// `ACEITA_DOCUMENTO` (src/utils/arquivo.js). Quem LÊ o arquivo depois usa api/_doc-blocos.js, que
// converte o que a IA não lê nativamente (Word, HEIC, TIFF, texto).
//
// Segurança: o tipo vem dos BYTES (o content-type do cliente é forjável) e o arquivo é gravado com
// o tipo detectado — texto vira `text/plain` (nunca `text/html`), então HTML/JS disfarçado não é
// servido como página. Sem dependência de Node: roda no Edge.

const ascii = (b, i, f) => String.fromCharCode(...b.subarray(i, Math.min(f, b.length)));

/** Texto de verdade: sem NUL e com pouquíssimo caractere de controle na amostra. */
function pareceTexto(b) {
  const amostra = b.subarray(0, 8192);
  if (!amostra.length) return false;
  let controle = 0;
  for (const c of amostra) { if (c === 0) return false; if (c < 9 || (c > 13 && c < 32)) controle++; }
  return controle <= amostra.length * 0.02;
}

/**
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} nome nome original (só para desempatar ZIP: .docx × outro zip)
 * @returns {{ ok: true, mime: string, ext: string } | { ok: false, motivo: string }}
 */
export function detectarArquivoAceito(buffer, nome = '') {
  const b = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (!b.length) return { ok: false, motivo: 'arquivo vazio' };
  const n = String(nome).toLowerCase();
  if (ascii(b, 0, 5) === '%PDF-') return { ok: true, mime: 'application/pdf', ext: 'pdf' };
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ok: true, mime: 'image/jpeg', ext: 'jpg' };
  if (ascii(b, 0, 8) === '\x89PNG\r\n\x1a\n') return { ok: true, mime: 'image/png', ext: 'png' };
  if (ascii(b, 0, 4) === 'GIF8') return { ok: true, mime: 'image/gif', ext: 'gif' };
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 12) === 'WEBP') return { ok: true, mime: 'image/webp', ext: 'webp' };
  if (ascii(b, 0, 4) === 'II*\0' || ascii(b, 0, 4) === 'MM\0*') return { ok: true, mime: 'image/tiff', ext: 'tif' };
  if (ascii(b, 4, 8) === 'ftyp' && /^(heic|heix|hevc|mif1|msf1|heim|heis)$/.test(ascii(b, 8, 12))) return { ok: true, mime: 'image/heic', ext: 'heic' };
  if (ascii(b, 0, 4) === 'PK\x03\x04') {
    // Word moderno é um ZIP com `word/document.xml` — o nome da entrada aparece em claro no arquivo.
    // (TextDecoder, não fromCharCode(...bytes): espalhar MB de bytes como argumentos estoura a pilha.)
    if (new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 4_000_000)).includes('word/document.xml')) {
      return { ok: true, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: 'docx' };
    }
    if (/\.zip$/.test(n)) return { ok: true, mime: 'application/zip', ext: 'zip' };
    return { ok: false, motivo: 'arquivo compactado que não é Word (.docx) nem .zip' };
  }
  if (b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0) {
    return { ok: false, motivo: 'Word antigo (.doc) não é lido — salve como .docx ou PDF e envie de novo' };
  }
  if (pareceTexto(b)) return { ok: true, mime: 'text/plain; charset=utf-8', ext: /\.md$/.test(n) ? 'md' : 'txt' };
  return { ok: false, motivo: 'formato não reconhecido (envie foto, PDF, Word .docx ou texto)' };
}

export const FORMATOS_ACEITOS_TXT = 'foto (JPG, PNG, WEBP, HEIC), PDF, Word (.docx) ou texto (.txt)';
