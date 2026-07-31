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
  body{font-family:'Inter',sans-serif;font-size:12px;color:#0f172a;padding:22px;line-height:1.6;background:white;margin:0;-webkit-font-smoothing:antialiased;-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  /* Sem print-color-adjust:exact o navegador NÃO imprime cor de fundo → as barras do gráfico
     (background) sumiam no PDF gerado. Força a impressão de fundos em TODOS os elementos. */
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact;}
  @media print{body{padding:0;}@page{margin:9mm;size:A4;}.av{page-break-inside:avoid;}}
  h2{font-size:13px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:18px 0 10px;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  .card{border:1px solid #e2e8f0;border-radius:12px;padding:16px 18px;background:#f8fafc;}
  .big{font-size:26px;font-weight:900;line-height:1.1;margin-top:4px;}
  pre{white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:11.5px;color:#334155;margin:0;line-height:1.7;}
  table{width:100%;border-collapse:collapse;margin-top:6px;}
  th,td{font-size:10.5px;text-align:left;padding:5px 7px;border-bottom:1px solid #eef2f7;vertical-align:top;}
  th{color:#475569;font-weight:800;text-transform:uppercase;font-size:9px;letter-spacing:.5px;}
  td.num,th.num{text-align:right;white-space:nowrap;}
  .foot{margin-top:22px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9.5px;color:#94a3b8;line-height:1.55;}
` + ESTILOS_CABECALHO;

// Corpo (conteúdo do <body>). form = { cidade, uf, bairro, condominio, tipo }; reg =
// { venda_m2, aluguel_m2, n_amostras, nivel, nivel_label }; amostrasAno = [{ano,n,m2}]
// (gráfico); amostras = [{especie,valor_m2,valor_total,area_m2,data_ref,fonte,criado_em}].
export function corpoIndice({ form = {}, reg = {}, amostras = [], amostrasAno = [], aviso = null, periodos = [], solicitante = {} }) {
  const tipoLabel = TIPO_LABEL[form.tipo] || form.tipo || '';
  const local = [form.condominio, form.bairro, form.cidade].filter(Boolean).join(' · ') + (form.uf ? `/${form.uf}` : '');
  const nivelLabel = reg.nivel_label || (reg.nivel === 'bairro' ? 'bairro' : reg.nivel === 'grid' ? 'microrregião (~1 km)' : 'cidade');
  const venda = Number(reg.venda_m2) || 0;
  const aluguel = Number(reg.aluguel_m2) || 0;
  const yieldAa = (venda > 0 && aluguel > 0) ? (aluguel * 12 / venda * 100) : null;

  // GRÁFICO de valorização (barras) — derivado das amostras por ano (aparece com >=2 anos).
  const serie = (Array.isArray(amostrasAno) ? amostrasAno : []).filter(p => p && Number(p.m2) > 0);
  const valorHtml = (() => {
    if (serie.length < 2) return '';
    const max = Math.max(...serie.map(p => Number(p.m2))) || 1;
    const p0 = Number(serie[0].m2), pN = Number(serie[serie.length - 1].m2);
    const anos = Number(serie[serie.length - 1].ano) - Number(serie[0].ano);
    const periodoPct = ((pN / p0) - 1) * 100;
    const aaPct = anos > 0 ? (Math.pow(pN / p0, 1 / anos) - 1) * 100 : periodoPct;
    const cor = periodoPct >= 0 ? '#166534' : '#991b1b';
    const barras = serie.map(p => {
      const h = Math.max(8, Math.round((Number(p.m2) / max) * 92));
      return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:3px;">`
        + `<div style="font-size:9.5px;font-weight:800;color:#065f46;">${brl(p.m2)}</div>`
        + `<div style="width:100%;max-width:54px;height:${h}px;border-radius:5px 5px 0 0;background:#059669;background:linear-gradient(180deg,#34d399,#059669);-webkit-print-color-adjust:exact;print-color-adjust:exact;"></div>`
        + `<div style="font-size:10px;font-weight:700;color:#334155;">${esc(p.ano)}</div>`
        + `<div style="font-size:8.5px;color:#94a3b8;">${esc(p.n)} am.</div></div>`;
    }).join('');
    return `
<h2>Valorização (R$/m² de venda por ano)</h2>
<div class="av" style="font-size:11.5px;color:#334155;margin-bottom:8px;">Período ${esc(serie[0].ano)}–${esc(serie[serie.length - 1].ano)}: <b style="color:${cor};">${periodoPct >= 0 ? '+' : ''}${periodoPct.toFixed(1)}%</b> no total · ${aaPct.toFixed(1)}% ao ano. <span style="color:#94a3b8;">(amostras podem ser poucas nos anos iniciais)</span></div>
<div class="av" style="display:flex;align-items:flex-end;gap:12px;height:130px;border-bottom:1px solid #e2e8f0;padding-bottom:2px;">${barras}</div>`;
  })();

  // RELAÇÃO DOS IMÓVEIS DA AMOSTRA (rastreabilidade): descrição, portal (fonte) e data.
  const MES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  const mesAno = (d) => { const m = String(d || '').match(/(\d{4})-(\d{2})/); return m ? `${MES[+m[2] - 1] || m[2]}/${m[1]}` : esc(d || ''); };
  const dataCurta = (d) => { const m = String(d || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1].slice(2)}` : ''; };
  const amRows = (Array.isArray(amostras) ? amostras : []).slice(0, 16).map(a => {
    const loc = a.especie === 'locacao';
    const area = Number(a.area_m2) > 0 ? `${Math.round(a.area_m2)} m²` : '—';
    const total = Number(a.valor_total) > 0 ? brl(a.valor_total) + (loc ? '/mês' : '') : '—';
    const m2 = Number(a.valor_m2) > 0 ? brl(a.valor_m2) + (loc ? '/m²·mês' : '/m²') : '—';
    return `<tr><td>${loc ? 'Locação' : 'Venda'} · ${area} · ${total}</td>`
      + `<td class="num">${m2}</td>`
      + `<td>${esc(String(a.fonte || '—').slice(0, 60))}</td>`
      + `<td class="num">${mesAno(a.data_ref)}${a.criado_em ? `<br><span style="color:#94a3b8;font-weight:400;">capt. ${dataCurta(a.criado_em)}</span>` : ''}</td></tr>`;
  }).join('');
  const samplesHtml = amRows ? `
<h2>Relação dos imóveis da amostra (rastreabilidade)</h2>
<div class="av" style="font-size:10px;color:#94a3b8;margin-bottom:6px;">Comparáveis de mercado (anúncios e revendas) do segmento na cidade que embasam o índice. "Data" = período de referência do anúncio; "capt." = quando entrou na base BidPro.</div>
<table class="av"><thead><tr><th>Descrição</th><th class="num">R$/m²</th><th>Portal (fonte)</th><th class="num">Data</th></tr></thead><tbody>${amRows}</tbody></table>` : '';

  // AVISO de frescor/projeção (quando não há amostra recente) + COMPOSIÇÃO POR PERÍODO (4 meses).
  const avisoHtml = aviso
    ? `<div class="av" style="border:1px solid #fed7aa;background:#fff7ed;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:11px;color:#9a3412;line-height:1.5;">⏳ ${esc(aviso)}</div>`
    : '';
  const periodosHtml = (Array.isArray(periodos) && periodos.length >= 1) ? `
<h2>Composição por período (venda R$/m², a cada 4 meses)</h2>
<div class="av" style="display:flex;flex-wrap:wrap;gap:8px;">
  ${periodos.slice(-8).map(p => `<div style="flex:1 1 90px;min-width:90px;background:#f8fafc;border:1px solid #eef2f7;border-radius:8px;padding:8px 10px;">`
    + `<div style="font-size:9.5px;color:#64748b;">${esc(p.label)}</div>`
    + `<div style="font-size:14px;font-weight:800;color:#0f172a;">${Number(p.m2) > 0 ? brl(p.m2) : '—'}</div>`
    + `<div style="font-size:8.5px;color:#94a3b8;">${esc(p.n)} anúncio(s)</div></div>`).join('')}
</div>
${reg.taxa_aa != null ? `<div class="av" style="font-size:10px;color:#94a3b8;margin-top:6px;">Valorização estimada da região: ~${esc(reg.taxa_aa)}% a.a. (curva do Índice BidPro).${Number(reg.total_anuncios) > 0 ? ` Base: ${esc(reg.total_anuncios)} anúncio(s), ${esc(reg.n_recentes || 0)} recente(s).` : ''}</div>` : ''}` : '';

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
${avisoHtml}
<div class="grid2 av">
  <div class="card">
    <div style="font-size:11px;font-weight:800;color:#0D63DB;">VENDA${reg.projetado ? ' <span style="font-size:8.5px;font-weight:800;color:#c2410c;background:#fff7ed;border-radius:999px;padding:1px 6px;">PROJETADO</span>' : ''}</div>
    <div class="big" style="color:#0D63DB;">${venda > 0 ? brl(venda) + '<span style="font-size:13px;font-weight:700;">/m²</span>' : '—'}</div>
    ${Number(reg.total_anuncios) > 0 ? `<div style="font-size:9.5px;color:#94a3b8;margin-top:3px;">${esc(reg.total_anuncios)} anúncio(s) · ${esc(reg.n_recentes || 0)} recente(s)</div>` : ''}
  </div>
  <div class="card">
    <div style="font-size:11px;font-weight:800;color:#7c3aed;">LOCAÇÃO</div>
    <div class="big" style="color:#7c3aed;">${aluguel > 0 ? brl(aluguel) + '<span style="font-size:13px;font-weight:700;">/m²·mês</span>' : 'em formação'}</div>
  </div>
</div>
${yieldAa != null ? `<div class="av" style="font-size:12px;color:#334155;margin-top:10px;">Rentabilidade bruta de locação estimada: <b>${yieldAa.toFixed(2)}% ao ano</b> (aluguel/m² × 12 ÷ preço de venda/m²).</div>` : ''}
${(reg.ponderacao && reg.ponderacao.misturado && Number(reg.ponderacao.ticket_medio) > 0) ? `<div class="av" style="border:1px solid #bfdbfe;background:#eff6ff;border-radius:10px;padding:10px 14px;margin-top:10px;font-size:11px;color:#1e40af;line-height:1.5;">Poucas amostras bem próximas: o valor de venda é uma <b>referência ponderada</b> — combina o preço da vizinhança imediata (mesmo padrão) com o ticket médio da região (${brl(reg.ponderacao.ticket_medio)}/m²), evitando distorção por poucos anúncios.</div>` : ''}

${periodosHtml}

${(reg.bandas && (Number(reg.bandas.popular) > 0 || Number(reg.bandas.alto) > 0)) ? `
<h2>Padrão — R$/m² de venda por faixa</h2>
<div class="grid2 av" style="grid-template-columns:1fr 1fr 1fr;">
  <div class="card"><div style="font-size:10.5px;font-weight:800;color:#64748b;">POPULAR</div><div class="big" style="font-size:19px;color:#0f172a;">${Number(reg.bandas.popular) > 0 ? brl(reg.bandas.popular) + '<span style="font-size:11px;font-weight:700;">/m²</span>' : '—'}</div></div>
  <div class="card"><div style="font-size:10.5px;font-weight:800;color:#64748b;">MÉDIO</div><div class="big" style="font-size:19px;color:#0f172a;">${Number(reg.bandas.medio) > 0 ? brl(reg.bandas.medio) + '<span style="font-size:11px;font-weight:700;">/m²</span>' : '—'}</div></div>
  <div class="card"><div style="font-size:10.5px;font-weight:800;color:#64748b;">ALTO PADRÃO</div><div class="big" style="font-size:19px;color:#0f172a;">${Number(reg.bandas.alto) > 0 ? brl(reg.bandas.alto) + '<span style="font-size:11px;font-weight:700;">/m²</span>' : '—'}</div></div>
</div>
<div class="av" style="font-size:10.5px;color:#94a3b8;margin-top:6px;">Um imóvel de ALTO PADRÃO deve ser comparado à faixa "alto", não à mediana da cidade. Faixas = percentis (p25 · p50 · p75) do R$/m² de venda das amostras da região.</div>` : ''}

${valorHtml}

${samplesHtml}

<h2>O que é o Índice BidPro</h2>
<pre class="av">O Índice BidPro é a referência própria de preço por metro quadrado (venda e locação) por microrregião, consolidada das análises de mercado da plataforma: anúncios ativos com data e revendas confirmadas, ponderados por recência e proximidade (rua/condomínio, microrregião de cerca de 1 km ou cidade). Os anúncios são organizados por período (janelas de 4 meses); quando há amostra recente (últimos 4 meses), o valor usa esses anúncios; quando não há, o valor é uma PROJEÇÃO para hoje dos anúncios de períodos anteriores, corrigidos pela valorização da própria região (indicada como "projetado"). Não inclui preços de leilão/arremate, para não contaminar a base. É uma referência de mercado para orientar a decisão, não uma avaliação formal.</pre>

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
