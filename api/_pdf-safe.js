/**
 * Carrega o pdf-parse SOB DEMANDA com shims dos globals de navegador que o
 * pdfjs-dist legacy referencia já no import (DOMMatrix/ImageData/Path2D). No
 * runtime serverless esses globals não existem e o import ESTÁTICO derrubava a
 * função INTEIRA no boot — todo /api/gerar-analise respondia 500 ("Falha de
 * conexão ao gerar" na tela; incidente de 30/07 à noite). Aqui só extraímos
 * TEXTO — nada é renderizado — então stubs vazios bastam; se ainda assim o
 * parse falhar, o chamador recebe a rejeição no ponto de USO (dentro do seu
 * try/catch best-effort), nunca no boot do módulo.
 */
let ctorPromise = null;

export function carregarPDFParse() {
  if (!ctorPromise) {
    for (const k of ['DOMMatrix', 'ImageData', 'Path2D']) {
      if (typeof globalThis[k] === 'undefined') globalThis[k] = class {};
    }
    ctorPromise = import('pdf-parse').then(m => m.PDFParse);
    // Falhou de vez (dependência quebrada)? Não envenena para sempre — a próxima
    // chamada tenta de novo (cold start seguinte pode ter o módulo íntegro).
    ctorPromise.catch(() => { ctorPromise = null; });
  }
  return ctorPromise;
}
