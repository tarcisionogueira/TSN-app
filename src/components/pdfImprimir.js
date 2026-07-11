// Impressão de PDF via IFRAME OCULTO (não usa window.open → não é bloqueado por
// pop-up). O navegador abre o diálogo de impressão; "Salvar como PDF" gera o
// arquivo. Compartilhado pelos geradores (mercadológico/documental/laudo) e pelo
// PDF combinado, para não repetir a mesma mecânica em cada arquivo.
//
// Nome do arquivo no "Salvar como PDF": o Chrome usa o <title> do documento PAI
// (a SPA), não o do iframe. Por isso setamos document.title antes de imprimir e
// restauramos depois.
export function imprimirHtml(html, nomeArquivoBruto) {
  const nomeArquivo = String(nomeArquivoBruto || 'Documento').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  const tituloAnterior = document.title;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const limpar = () => { document.title = tituloAnterior; setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 1000); };
  try {
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const imprimir = () => {
      try {
        document.title = nomeArquivo;
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        // Fallback extremo: abre numa nova aba (pode pedir pop-up) e imprime.
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 600); }
        else alert('Não foi possível abrir a impressão. Verifique o bloqueador de pop-ups.');
      } finally { limpar(); }
    };
    // Espera o conteúdo/CSS assentar antes de chamar print.
    setTimeout(imprimir, 500);
  } catch {
    limpar();
    alert('Não foi possível gerar o PDF neste navegador.');
  }
}
