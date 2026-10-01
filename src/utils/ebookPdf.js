// PDF do eBook ESTRUTURADO (capítulos em ebook_capitulos, sem arquivo_url): monta o livro
// em HTML de impressão — CAPA na 1ª página (sangria total), sumário e os capítulos, cada um
// abrindo página nova — e entrega ao `imprimirHtml` ("Salvar como PDF"). Custo zero: os
// capítulos já chegaram pela RPC de entitlement (obter_capitulos_ebook), então só quem pode
// ler consegue baixar, sem arquivo novo no Storage para vazar ou envelhecer.
// As regras de parágrafo espelham o LeitorEstruturado: blocos separados por linha em branco,
// "## " = subtítulo (abre página nova, menos quando é o 1º bloco do capítulo), "- " sem recuo.
import { imprimirHtml } from '../components/pdfImprimir.js';
import { driveImage } from './driveUrl.js';
import { PREFIXO_SUBTITULO } from './parseDocx.js';

const esc = (s) => String(s ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function capituloHtml(cap, i) {
  const blocos = String(cap.conteudo_texto || '').split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const corpo = blocos.map((p, j) => {
    if (p.startsWith(PREFIXO_SUBTITULO)) {
      return `<h3 class="sub${j === 0 ? ' primeiro' : ''}">${esc(p.slice(PREFIXO_SUBTITULO.length))}</h3>`;
    }
    const semRecuo = j === 0 || p.startsWith('- ') || blocos[j - 1]?.startsWith(PREFIXO_SUBTITULO);
    return `<p${semRecuo ? ' class="sr"' : ''}>${esc(p)}</p>`;
  }).join('\n');
  return `<section class="cap" id="cap-${i + 1}"><h2>${esc(cap.titulo)}</h2>${corpo}</section>`;
}

export function montarHtmlEbook({ titulo, capaUrl, capitulos }) {
  const caps = (capitulos || []).filter((c) => c && (c.titulo || c.conteudo_texto));
  const capa = capaUrl ? driveImage(capaUrl, 'w2000') : '';
  const sumario = caps.map((c, i) =>
    `<li><a href="#cap-${i + 1}"><span class="n">${i + 1}</span>${esc(c.titulo)}</a></li>`).join('');

  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>${esc(titulo)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Literata:ital,opsz,wght@0,7..72,400;0,7..72,600;0,7..72,700;1,7..72,400&display=swap" rel="stylesheet">
<style>
  @page { size: A5; margin: 18mm 16mm 20mm; @bottom-center { content: counter(page); font: 9pt 'Literata', Georgia, serif; color: #888; } }
  @page capa { margin: 0; @bottom-center { content: none; } }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; background: #fff; }
  body { font-family: 'Literata', Georgia, 'Times New Roman', serif; font-size: 10.5pt; line-height: 1.6; color: #1d1d1d; }
  .capa { page: capa; width: 148mm; height: 210mm; overflow: hidden; background: #0b0d12;
          display: flex; align-items: center; justify-content: center; break-after: page; }
  .capa img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .capa .alt { color: #fff; font-size: 22pt; font-weight: 700; text-align: center; padding: 20mm; }
  .sumario { break-after: page; }
  .sumario h1 { font-size: 15pt; margin: 0 0 6mm; letter-spacing: .5px; }
  .sumario ol { list-style: none; padding: 0; margin: 0; }
  .sumario li { margin: 0 0 2.2mm; font-size: 9.5pt; }
  .sumario a { color: inherit; text-decoration: none; display: flex; gap: 3mm; }
  .sumario .n { min-width: 7mm; color: #999; font-variant-numeric: tabular-nums; }
  .cap { break-before: page; }
  .cap h2 { font-size: 15pt; line-height: 1.3; margin: 8mm 0 7mm; break-after: avoid; }
  .cap h3.sub { font-size: 11.5pt; margin: 0 0 3mm; break-before: page; break-after: avoid; }
  .cap h3.sub.primeiro { break-before: auto; }
  p { margin: 0 0 2.6mm; text-align: justify; text-indent: 1.4em; white-space: pre-line; orphans: 2; widows: 2; hyphens: auto; }
  p.sr { text-indent: 0; }
</style></head><body>
<div class="capa">${capa ? `<img src="${esc(capa)}" alt="${esc(titulo)}">` : `<div class="alt">${esc(titulo)}</div>`}</div>
<nav class="sumario"><h1>Sumário</h1><ol>${sumario}</ol></nav>
${caps.map(capituloHtml).join('\n')}
</body></html>`;
  return html;
}

export function baixarEbookPdf({ titulo, capaUrl, capitulos }) {
  const html = montarHtmlEbook({ titulo, capaUrl, capitulos });
  // Capa vem de URL externa (Storage/Drive) e a fonte do Google: mais folga que o padrão de 4 s.
  imprimirHtml(html, titulo || 'eBook', { esperaImagensMs: 8000 });
}
