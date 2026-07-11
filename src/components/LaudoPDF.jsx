// PDF do PARECER FINAL (Agente de Defesa / 3º documento). Consolida o veredito,
// pontos fortes/atenção, condições, diligências, controle de qualidade dos dois
// relatórios e o parecer de defesa num documento com a marca BidPro que o cliente
// baixa/apresenta. Espelha a mecânica de impressão do RelatorioPDF (iframe oculto
// → diálogo do navegador → "Salvar como PDF"), sem depender de pop-up.

// Escapa texto vindo da IA para não quebrar o HTML nem permitir injeção.
import { imprimirHtml } from './pdfImprimir';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// CSS do documento (exportado para o PDF combinado reaproveitar). As classes de
// bloco usam o prefixo `.blk` (e não `.bl`) para não colidir com o `.bl` de
// "texto azul" do relatório mercadológico quando os estilos são unidos no combinado.
export const ESTILOS_LAUDO = `
  body{font-family:'Inter',sans-serif;font-size:12px;color:#0f172a;padding:22px;line-height:1.65;background:white;margin:0;-webkit-font-smoothing:antialiased;}
  @media print{body{padding:0;}@page{margin:9mm;size:A4;}.av{page-break-inside:avoid;}}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111111;padding-bottom:12px;margin-bottom:16px;}
  h2{font-size:13px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:20px 0 8px;}
  h3{font-size:11.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#111827;margin:12px 0 4px;}
  pre{white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:12px;margin:0;line-height:1.75;color:#1e293b;}
  ul{margin:4px 0 0;padding-left:18px;}
  li{font-size:11.5px;color:#1e293b;line-height:1.65;margin-bottom:3px;}
  .blk{margin-top:12px;}
  .blk-t{font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;}
  .cq-row{display:flex;align-items:center;gap:8px;margin:5px 0;}
  .cq-lbl{width:110px;font-size:9.5px;font-weight:700;color:#475569;}
  .cq-track{flex:1;height:7px;background:#e2e8f0;border-radius:20px;overflow:hidden;}
  .cq-fill{height:100%;border-radius:20px;}
  .cq-val{width:34px;text-align:right;font-size:9.5px;color:#64748b;}
  .sec{margin-bottom:10px;}
  .foot{margin-top:22px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:8.5px;color:#94a3b8;line-height:1.5;}
`;

// Corpo (conteúdo do <body>) do parecer final — exportado para o PDF combinado.
export function corpoLaudo({ imovel: d = {}, laudo: L = {} }) {
  const V = {
    aprovado:    { txt: 'APROVADO, VIÁVEL',                     cor: '#065f46', bg: '#d1fae5', bd: '#10b981', ic: '✓' },
    condicional: { txt: 'CONDICIONAL, VIÁVEL COM RESSALVAS',    cor: '#92400e', bg: '#fef3c7', bd: '#f59e0b', ic: '!' },
    reprovado:   { txt: 'REPROVADO, NÃO RECOMENDADO',           cor: '#b91c1c', bg: '#fee2e2', bd: '#ef4444', ic: '✗' },
  };
  const v = V[L.veredito] || V.condicional;

  // Lista simples → <li>. Retorna '' quando vazia (o chamador oculta o bloco).
  const itens = (arr) => (Array.isArray(arr) ? arr.filter(Boolean) : []);
  const listaHtml = (arr) => itens(arr).map(x => `<li>${esc(x)}</li>`).join('');
  const bloco = (titulo, arr, cor = '#111111') => {
    const li = listaHtml(arr);
    if (!li) return '';
    return `<div class="av blk"><div class="blk-t" style="color:${cor};">${esc(titulo)}</div><ul>${li}</ul></div>`;
  };

  // Barra de confiança (controle de qualidade). n em 0–100 ou null.
  const barra = (label, n) => {
    const val = Number(n);
    const ok = Number.isFinite(val) ? Math.max(0, Math.min(100, val)) : null;
    const cor = ok == null ? '#94a3b8' : ok >= 70 ? '#16a34a' : ok >= 50 ? '#d97706' : '#dc2626';
    return `<div class="cq-row">
      <div class="cq-lbl">${esc(label)}</div>
      <div class="cq-track"><div class="cq-fill" style="width:${ok == null ? 0 : ok}%;background:${cor};"></div></div>
      <div class="cq-val">${ok == null ? '—' : ok + '%'}</div>
    </div>`;
  };

  const q = L.controleQualidade || null;
  const cqHtml = q ? `
<div class="av" style="border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;padding:12px 14px;margin:14px 0;">
  <div style="font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1px;color:#475569;margin-bottom:8px;">
    Controle de qualidade dos relatórios${q.recomendaRevisao ? ' <span style="color:#b91c1c;">· revisar antes do lance</span>' : ''}
  </div>
  ${barra('Mercadológico', q.confiancaMercadologico)}
  ${barra('Documental', q.confiancaDocumental)}
  ${bloco('Contradições encontradas', q.contradicoes, '#b91c1c')}
  ${bloco('Lacunas críticas', q.lacunasCriticas, '#92400e')}
</div>` : '';

  // Parecer de defesa: divide por "§ SEÇÃO:" em blocos titulados.
  const parecerHtml = (() => {
    const txt = String(L.parecer || '').trim();
    if (!txt) return '';
    const partes = txt.split(/§\s*SEÇÃO:/i).map(s => s.trim()).filter(Boolean);
    const secoes = partes.map(p => {
      const nl = p.indexOf('\n');
      const titulo = nl < 0 ? p : p.slice(0, nl);
      const corpo = nl < 0 ? '' : p.slice(nl);
      return `<div class="sec av"><h3>${esc(titulo.trim())}</h3><pre>${esc(corpo.trim())}</pre></div>`;
    }).join('');
    return `<h2>Parecer de Defesa</h2>${secoes}`;
  })();

  const local = [d.cidade, d.estado].filter(Boolean).join('/');
  const geradoEm = (() => { try { return new Date(L.geradoEm || Date.now()).toLocaleDateString('pt-BR'); } catch { return new Date().toLocaleDateString('pt-BR'); } })();

  return `
<div class="hdr av">
  <div>
    <div style="font-size:22px;font-weight:900;text-transform:uppercase;margin-bottom:3px;">BidPro Brasil</div>
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Aquisição em Leilão &amp; Investimentos Estratégicos</div>
    <div style="font-size:13px;font-weight:900;margin-bottom:3px;">PARECER FINAL DE VIABILIDADE, LAUDO DE DEFESA</div>
    <div style="font-size:10px;color:#475569;">${esc((d.tipo || '').toUpperCase())}${d.endereco ? ', ' + esc(d.endereco) : ''}${local ? ' · ' + esc(local) : ''}</div>
    ${d.leiloeiro ? `<div style="font-size:9px;color:#64748b;margin-top:3px;">Leiloeiro: ${esc(d.leiloeiro)}${d.dataLeilao ? ' · ' + esc(d.dataLeilao) : ''}</div>` : ''}
  </div>
  <div style="text-align:right;flex-shrink:0;">
    <div style="font-size:10px;font-weight:700;margin-bottom:3px;">Data: ${geradoEm}</div>
    <div style="font-size:9px;color:#64748b;">Documento 3 de 3</div>
    <div style="font-size:9px;color:#64748b;">Síntese Mercadológico + Documental</div>
  </div>
</div>

<div class="av" style="border:2px solid ${v.bd};background:${v.bg};border-radius:8px;padding:14px 16px;text-align:center;margin-bottom:14px;">
  <div style="font-size:16px;font-weight:900;color:${v.cor};">${v.ic} VEREDITO: ${v.txt}</div>
  ${L.resumoExecutivo ? `<div style="font-size:11px;color:${v.cor};margin-top:6px;line-height:1.6;">${esc(L.resumoExecutivo)}</div>` : ''}
</div>

${bloco('Pontos fortes', L.pontosFortes, '#15803d')}
${bloco('Pontos de atenção', L.pontosDeAtencao, '#92400e')}
${bloco('Condições para aprovação', L.condicoes, '#b45309')}
${bloco('Diligências pendentes (confirmar antes do lance)', L.diligenciasPendentes, '#0369a1')}

${cqHtml}

${parecerHtml}

<div class="foot av">
  Este parecer final é um documento de apoio à decisão, gerado com apoio de inteligência artificial a partir dos relatórios Mercadológico + Viabilidade Financeira e Documental + Jurídico. Não substitui a análise de um profissional nem a verificação presencial do imóvel. Recomendamos agendar a reunião com um analista BidPro para validar o veredito antes de qualquer lance.
  <div style="margin-top:4px;">BidPro Brasil · Documento gerado em ${geradoEm}.</div>
</div>
`;
}

export function gerarLaudoPDF(props) {
  const d = (props && props.imovel) || {};
  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Parecer Final BidPro Brasil, ${esc(d.nome || d.endereco || 'Imóvel')}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${ESTILOS_LAUDO}</style></head><body>${corpoLaudo(props)}</body></html>`;
  imprimirHtml(html, `Parecer Final - ${(d.nome || d.endereco || 'Imovel')}`);
}
