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
    // WORKER DO PDF.JS (13/10). No Node o pdf.js roda o worker "falso" no mesmo processo e o
    // carrega com `import(workerSrc)` DINÂMICO — o rastreador de arquivos da Vercel não segue esse
    // import, o pdf.worker.mjs não ia para o pacote e TODA leitura de PDF em produção falhava com
    // "Setting up fake worker failed: Cannot find module …" (35 de 35 PDFs do documental com
    // charsTexto nulo desde 22/09; 58 falhas do espelho de documentos só na última semana — os
    // outros pontos engoliam o erro). Registrado em `globalThis.pdfjsWorker`, o pdf.js usa o
    // handler já carregado e pula o import dinâmico; o caminho LITERAL abaixo é o que faz a Vercel
    // empacotar o arquivo. É o pdfjs ANINHADO no pdf-parse (5.x) — o da raiz (4.x) é do front e a
    // versão do worker tem que ser a mesma da API, senão o pdf.js recusa.
    ctorPromise = (async () => {
      if (!globalThis.pdfjsWorker?.WorkerMessageHandler) {
        try { globalThis.pdfjsWorker = await import('../node_modules/pdf-parse/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs'); }
        catch (e) { console.error('[pdf-safe] worker do pdf.js não carregou:', String(e?.message || e).slice(0, 120)); }
      }
      return (await import('pdf-parse')).PDFParse;
    })();
    // Falhou de vez (dependência quebrada)? Não envenena para sempre — a próxima
    // chamada tenta de novo (cold start seguinte pode ter o módulo íntegro).
    ctorPromise.catch(() => { ctorPromise = null; });
  }
  return ctorPromise;
}
