// Impressão de PDF via IFRAME OCULTO (não usa window.open → não é bloqueado por
// pop-up). O navegador abre o diálogo de impressão; "Salvar como PDF" gera o
// arquivo. Compartilhado pelos geradores (mercadológico/documental/laudo), pelo
// contrato assinado e pelo PDF combinado, para não repetir a mecânica em cada um.
//
// Nome do arquivo no "Salvar como PDF": o Chrome usa o <title> do documento PAI
// (a SPA). Setamos document.title antes de imprimir e só o RESTAURAMOS quando o
// diálogo fecha (evento afterprint). Antes restaurávamos logo após print(), mas o
// Chrome lê o título DEPOIS — então o arquivo saía com o nome do site em vez do
// nome do documento. Rede de segurança por tempo caso afterprint não dispare.
export function imprimirHtml(html, nomeArquivoBruto) {
  const nomeArquivo = String(nomeArquivoBruto || 'Documento').replace(/[\\/:*?"<>|]+/g, ' ').trim();
  const tituloAnterior = document.title;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  let restaurado = false;
  const restaurar = () => {
    if (restaurado) return; restaurado = true;
    document.title = tituloAnterior;
    setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 500);
  };
  try {
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const imprimir = () => {
      try {
        document.title = nomeArquivo;
        const w = iframe.contentWindow;
        // Restaura só quando o diálogo fecha (impresso, salvo ou cancelado).
        w.addEventListener('afterprint', restaurar, { once: true });
        window.addEventListener('afterprint', restaurar, { once: true });
        setTimeout(restaurar, 60000); // fallback: nunca deixa o título da SPA preso
        w.focus();
        w.print();
      } catch {
        // Fallback extremo: abre numa nova aba (pode pedir pop-up) e imprime.
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 600); }
        else alert('Não foi possível abrir a impressão. Verifique o bloqueador de pop-ups.');
        restaurar();
      }
    };
    // Espera o conteúdo/CSS assentar E as imagens carregarem (ex.: documento anexo em imagem
    // embutido) antes de imprimir — senão o print dispara com a imagem ainda em branco. Teto 4s.
    const imgs = Array.from(doc.images || []);
    const pend = imgs.filter((im) => !im.complete);
    if (!pend.length) { setTimeout(imprimir, 500); }
    else {
      let feito = false, restantes = pend.length;
      const go = () => { if (feito) return; feito = true; imprimir(); };
      pend.forEach((im) => {
        const done = () => { if (--restantes <= 0) go(); };
        im.addEventListener('load', done); im.addEventListener('error', done);
      });
      setTimeout(go, 4000);
    }
  } catch {
    restaurar();
    alert('Não foi possível gerar o PDF neste navegador.');
  }
}
