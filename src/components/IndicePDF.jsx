// PDF do RELATÓRIO DO ÍNDICE BIDPRO — peça COMERCIAL (advogados, peritos, corretores):
// a referência de preço por m² (venda e locação) por microrregião + a valorização por
// ano, com IDENTIFICAÇÃO COMPLETA da BidPro. Mesma mecânica de impressão dos demais PDFs
// (iframe oculto → diálogo "Salvar como PDF"), reusando o cabeçalho padrão da marca.

import { imprimirHtml } from './pdfImprimir';
import { cabecalhoBidPro, ESTILOS_CABECALHO } from './pdfCabecalho';

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (v) => 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 });

const TIPO_LABEL = { apartamento: 'Apartamento', casa: 'Casa / condomínio', terreno: 'Terreno / área', comercial: 'Comercial / industrial' };

export const ESTILOS_INDICE = `
  body{font-family:'Inter',sans-serif;font-size:12px;color:#0f172a;padding:22px;line-height:1.6;background:white;margin:0;-webkit-font-smoothing:antialiased;}
  @media print{body{padding:0;}@page{margin:9mm;size:A4;}.av{page-break-inside:avoid;}}
  h2{font-size:13px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:18px 0 10px;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .card{border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;background:#f8fafc;}
  .big{font-size:26px;font-weight:900;line-height:1.1;margin-top:4px;}
  pre{white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:11.5px;color:#334155;margin:0;line-height:1.7;}
  table{width:100%;border-collapse:collapse;margin-top:6px;}
  th,td{font-size:11px;text-align:right;padding:6px 8px;border-bottom:1px solid #eef2f7;}
  th:first-child,td:first-child{text-align:left;}
  th{color:#475569;font-weight:800;text-transform:uppercase;font-size:9.5px;letter-spacing:.5px;}
  .foot{margin-top:22px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9.5px;color:#94a3b8;line-height:1.55;}
` + ESTILOS_CABECALHO;

// Corpo (conteúdo do <body>). form = { cidade, uf, bairro, condominio, tipo }; reg =
// { venda_m2, aluguel_m2, n_amostras, nivel, nivel_label, bairro_norm }; vz = valorização.
export function corpoIndice({ form = {}, reg = {}, vz = null, solicitante = {} }) {
  const tipoLabel = TIPO_LABEL[form.tipo] || form.tipo || '';
  const local = [form.condominio, form.bairro, form.cidade].filter(Boolean).join(' · ') + (form.uf ? `/${form.uf}` : '');
  const nivelLabel = reg.nivel_label || (reg.nivel === 'bairro' ? 'bairro' : reg.nivel === 'grid' ? 'microrregião (~1 km)' : 'cidade');
  const venda = Number(reg.venda_m2) || 0;
  const aluguel = Number(reg.aluguel_m2) || 0;
  const yieldAa = (venda > 0 && aluguel > 0) ? (aluguel * 12 / venda * 100) : null;

  const valorHtml = (Array.isArray(vz?.serie) && vz.serie.length >= 2) ? `
<h2>Valorização (venda R$/m²)</h2>
<div class="av" style="font-size:11.5px;color:#334155;margin-bottom:4px;">Período ${esc(vz.ano_inicial)}–${esc(vz.ano_final)}: <b style="color:${Number(vz.valorizacao_periodo_pct) >= 0 ? '#166534' : '#991b1b'};">${Number(vz.valorizacao_periodo_pct) >= 0 ? '+' : ''}${Number(vz.valorizacao_periodo_pct).toFixed(1)}%</b> no total · ${Number(vz.valorizacao_aa_pct).toFixed(1)}% ao ano.</div>
<table class="av"><thead><tr><th>Ano</th><th>R$/m² (venda)</th><th>Amostras</th></tr></thead><tbody>
${vz.serie.map(p => `<tr><td>${esc(p.ano)}</td><td>${brl(p.m2)}</td><td>${esc(p.n)}</td></tr>`).join('')}
</tbody></table>` : '';

  return `
${cabecalhoBidPro({
  titulo: 'Relatório do Índice BidPro',
  subtitulo: `Referência de mercado · ${tipoLabel}`,
  imovel: { tipo: '', endereco: local, cidade: form.cidade, estado: form.uf },
  solicitante,
})}

<div class="av" style="border:1px solid #c7d2fe;background:#eef2ff;border-radius:12px;padding:12px 16px;margin-bottom:14px;">
  <div style="font-size:13px;font-weight:800;color:#111;">${esc(local || `${form.cidade}/${form.uf}`)}</div>
  <div style="font-size:11px;color:#64748b;">Nível ${esc(nivelLabel)} · ${esc(reg.n_amostras || 0)} amostras · Tipo: ${esc(tipoLabel)}</div>
</div>

<div class="grid2 av">
  <div class="card">
    <div style="font-size:11px;font-weight:800;color:#0D63DB;">VENDA</div>
    <div class="big" style="color:#0D63DB;">${venda > 0 ? brl(venda) + '<span style="font-size:13px;font-weight:700;">/m²</span>' : '—'}</div>
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:800;color:#7c3aed;">LOCAÇÃO</div>
    <div class="big" style="color:#7c3aed;">${aluguel > 0 ? brl(aluguel) + '<span style="font-size:13px;font-weight:700;">/m²·mês</span>' : 'em formação'}</div>
  </div>
</div>
${yieldAa != null ? `<div class="av" style="font-size:12px;color:#334155;margin-top:10px;">Rentabilidade bruta de locação estimada: <b>${yieldAa.toFixed(2)}% ao ano</b> (aluguel/m² × 12 ÷ preço de venda/m²).</div>` : ''}

${valorHtml}

<h2>O que é o Índice BidPro</h2>
<pre class="av">O Índice BidPro é a referência própria de preço por metro quadrado (venda e locação) por microrregião, consolidada das análises de mercado da plataforma: anúncios ativos com data e revendas confirmadas, ponderados por recência e proximidade (rua/condomínio, microrregião de cerca de 1 km ou cidade). Não inclui preços de leilão/arremate, para não contaminar a base. É uma referência de mercado para orientar a decisão, não uma avaliação formal.</pre>

<div class="foot av">
  BidPro Brasil · O ecossistema completo para investidores em leilões. Relatório do Índice gerado em ${new Date().toLocaleDateString('pt-BR')}.
  Referência de mercado com base própria; não substitui avaliação formal (perito/engenheiro) nem análise jurídica.
</div>
`;
}

export function gerarIndicePDF(props) {
  const f = (props && props.form) || {};
  const nome = [f.condominio, f.bairro, f.cidade].filter(Boolean).join(' - ') || f.cidade || 'Regiao';
  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Indice BidPro Brasil, ${esc(nome)}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${ESTILOS_INDICE}</style></head><body>${corpoIndice(props)}</body></html>`;
  imprimirHtml(html, `Indice BidPro - ${nome}`);
}
