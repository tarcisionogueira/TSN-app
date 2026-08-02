// Carregamento LAZY e ÚNICO do pdf.js. Dois leitores usam (o rolável e o paginado); se cada um
// importasse por conta própria, a lib entraria duas vezes no grafo e o worker seria configurado
// duas vezes. Aqui é um singleton — e o import dinâmico mantém a lib FORA do bundle inicial
// (ela só desce quando alguém abre um PDF de verdade).
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let _pdfjs = null;
let _carregando = null;

export async function getPdfjs() {
  if (_pdfjs) return _pdfjs;
  if (!_carregando) {
    _carregando = import('pdfjs-dist').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
      _pdfjs = pdfjs;
      return pdfjs;
    }).catch((e) => { _carregando = null; throw e; });
  }
  return _carregando;
}
