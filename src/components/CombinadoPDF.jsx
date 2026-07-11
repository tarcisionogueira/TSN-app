// PDF COMBINADO — os três relatórios (Mercadológico + Viabilidade Financeira,
// Documental + Jurídico e Relatório de Conclusão) num único arquivo, na ordem, com
// quebra de página entre eles. Reaproveita os MESMOS estilos e corpos dos
// geradores individuais (não duplica marcação), então o combinado fica sempre
// idêntico ao que o cliente vê ao baixar cada relatório separado.
//
// Só entram no PDF os relatórios efetivamente prontos (os ausentes são pulados),
// para nunca imprimir uma seção vazia.

import { imprimirHtml } from './pdfImprimir';
import { ESTILOS_MERCADOLOGICO, corpoMercadologico } from './RelatorioPDF';
import { ESTILOS_DOCUMENTAL, corpoDocumental } from './DocumentalPDF';
import { ESTILOS_LAUDO, corpoLaudo } from './LaudoPDF';

// Estilos unidos. Seletores repetidos entre os três (h2/pre/.av/.foot…) têm
// valores quase iguais — a última definição vence, diferença apenas cosmética. O
// único conflito real (.bl) já foi resolvido: o parecer usa .blk. Por fim, um
// bloco próprio garante o body canônico e a quebra entre seções.
const ESTILOS_COMBINADO = `
${ESTILOS_MERCADOLOGICO}
${ESTILOS_DOCUMENTAL}
${ESTILOS_LAUDO}
  body{padding:22px;}
  @media print{body{padding:0;}.quebra{page-break-before:always;}}
  .quebra{margin-top:26px;}
`;

export function gerarCombinadoPDF({ mercado = null, documental = null, laudo = null } = {}) {
  const secoes = [];
  if (mercado) secoes.push(corpoMercadologico(mercado));
  if (documental) secoes.push(corpoDocumental(documental));
  if (laudo) secoes.push(corpoLaudo(laudo));
  if (!secoes.length) { alert('Nenhum relatório pronto para exportar ainda.'); return; }

  // O primeiro relatório abre o documento; os seguintes começam em nova página.
  const corpo = secoes
    .map((s, i) => (i === 0 ? s : `<div class="quebra">${s}</div>`))
    .join('\n');

  // Nome do imóvel para o arquivo — vem de qualquer um dos relatórios presentes.
  const d = mercado?.d || documental?.imovel || laudo?.imovel || {};
  const nome = d.nome || d.endereco || 'Imovel';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatorios BidPro Brasil, ${nome}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${ESTILOS_COMBINADO}</style></head><body>${corpo}</body></html>`;

  imprimirHtml(html, `Relatorios BidPro - ${nome}`);
}
