import { fmt, fmtPct } from '../utils/calculos';

export default function RelatorioPDF({ d, metricas: m, metricasTeto: mt, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTabela, priceTabela }) {
  const win = window.open('', '_blank');
  if (!win) { alert('Permita pop-ups para gerar o PDF.'); return; }

  const parseAI = (txt) => {
    if (!txt) return {};
    const result = {};
    const parts = txt.split(/SEÇÃO:/i).filter(s => s.trim());
    parts.forEach(p => {
      const nl = p.indexOf('\n');
      if (nl < 0) return;
      const title = p.substring(0, nl).trim().toUpperCase();
      const content = p.substring(nl).trim();
      if (title.includes('POSICIONAMENTO')) result.posicionamento = content;
      else if (title.includes('DEFESA')) result.defesa = content;
      else if (title.includes('LOCAÇÃO') || title.includes('PROJEÇÃO')) result.locacao = content;
      else if (title.includes('AMOSTRAS')) result.amostras = content;
    });
    return result;
  };

  const ai = parseAI(d.aiAnalysis || '');
  const riscosBloqueantes = (d.riscos || []).filter(r => r.tipo === 'bloqueante');
  const sacTotal = sacTabela.reduce((s, r) => s + r.parcela, 0);
  const priceTotal = priceTabela.reduce((s, r) => s + r.parcela, 0);
  const labelRef = isUsoProprio ? 'Valor de Mercado' : 'Venda Bruta (90%)';

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório TSN Ativos — ${d.nome || d.endereco}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  body{font-family:'Inter',sans-serif;font-size:11px;color:#0f172a;padding:20px;line-height:1.5;background:white;}
  @media print{body{padding:0;}@page{margin:8mm;size:A4 portrait;}.pb{page-break-before:always;}.avoid{page-break-inside:avoid;}}
  .hdr{display:flex;justify-content:space-between;border-bottom:3px solid #0f172a;padding-bottom:12px;margin-bottom:20px;}
  h2{font-size:13px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:20px 0 10px;}
  h3{font-size:11px;font-weight:700;margin:14px 0 6px;color:#1e293b;}
  table{width:100%;border-collapse:collapse;margin-bottom:12px;font-size:10.5px;}
  th,td{border:1px solid #cbd5e1;padding:5px 8px;}
  th{background:#f1f5f9;font-weight:700;text-align:left;}
  .r{text-align:right;}.c{text-align:center;}
  .green{color:#059669;font-weight:700;}.red{color:#dc2626;font-weight:700;}
  .amber{color:#d97706;font-weight:700;}.blue{color:#2563eb;font-weight:700;}
  .bg-green{background:#d1fae5;}.bg-red{background:#fee2e2;}.bg-amber{background:#fef3c7;}.bg-blue{background:#dbeafe;}
  .alert-box{border:2px solid #dc2626;background:#fef2f2;padding:12px;border-radius:6px;margin:12px 0;}
  .obs-box{border-left:4px solid #2563eb;background:#f0f9ff;padding:10px 14px;margin-bottom:14px;}
  .risk-item{padding:5px 8px;margin-bottom:4px;border-radius:4px;display:flex;align-items:flex-start;gap:8px;}
  pre{white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:10.5px;margin:0;}
</style>
</head><body>

<!-- CABEÇALHO -->
<div class="hdr avoid">
  <div>
    <div style="font-size:20px;font-weight:900;text-transform:uppercase;margin-bottom:4px;">TSN ATIVOS</div>
    <div style="font-size:9px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Aquisição em Leilão & Investimentos Estratégicos</div>
    <div style="font-size:12px;font-weight:900;margin-bottom:4px;">ANÁLISE DE VIABILIDADE DE ARREMATAÇÃO</div>
    <div style="font-size:10px;color:#475569;">${d.tipoImovel?.toUpperCase()} — ${d.endereco}</div>
  </div>
  <div style="text-align:right;">
    <div style="font-size:10px;font-weight:700;margin-bottom:4px;">Data: ${new Date().toLocaleDateString('pt-BR')}</div>
    <div style="font-size:9px;color:#64748b;">Cenário: ${isAVista ? 'À VISTA' : 'ALAVANCADO'}</div>
    <div style="font-size:9px;color:#64748b;">Objetivo: ${isUsoProprio ? 'USO PRÓPRIO' : 'INVESTIMENTO'}</div>
    <div style="font-size:9px;color:#64748b;">Área: ${d.areaM2}m² (priv.) / ${d.areaTerrenoM2}m² (terreno)</div>
  </div>
</div>

<!-- ALERTAS BLOQUEANTES -->
${riscosBloqueantes.length > 0 ? `
<div class="alert-box avoid">
  <div style="font-size:14px;font-weight:900;color:#b91c1c;margin-bottom:8px;">⚠ RISCO JURÍDICO BLOQUEANTE — ANÁLISE SUSPENSA ATÉ REGULARIZAÇÃO</div>
  ${riscosBloqueantes.map(r => `<div style="color:#dc2626;font-size:11px;margin-bottom:4px;">• ${r.texto}</div>`).join('')}
</div>` : ''}

<!-- OBSERVAÇÕES DA GESTÃO -->
${d.observacoes ? `<div class="obs-box avoid"><b style="font-size:10px;text-transform:uppercase;">Anotações da Gestão:</b><br/><span style="color:#475569;">${d.observacoes.replace(/\n/g,'<br/>')}</span></div>` : ''}

<!-- SEÇÃO IA: POSICIONAMENTO -->
${ai.posicionamento ? `<div class="avoid"><h2>Apresentação Institucional & Posicionamento Estratégico</h2><pre>${ai.posicionamento}</pre></div>` : ''}

<!-- VIABILIDADE -->
<div class="avoid" style="margin:16px 0;padding:14px;border-radius:8px;border:2px solid ${isViavel ? '#10b981' : '#dc2626'};background:${isViavel ? '#d1fae5' : '#fee2e2'};">
  <div style="font-size:16px;font-weight:900;color:${isViavel ? '#065f46' : '#b91c1c'};">
    ${isViavel ? '✓ OPERAÇÃO VIÁVEL — APROVADA' : '✗ OPERAÇÃO REPROVADA — RETORNO INSUFICIENTE'}
  </div>
  <div style="font-size:11px;color:${isViavel ? '#047857' : '#dc2626'};margin-top:4px;">
    ${isUsoProprio
      ? `Economia de R$ ${fmt(m.lucro, 0)} vs compra direta no mercado (${fmtPct(m.roi)} de desconto efetivo)`
      : `Retorno ${fmtPct(m.roi)} ${isAVista ? 'ROI' : 'ROE'} — ${isViavel ? 'Atinge a trava mínima de 40%' : 'Abaixo dos 40% exigidos'} · Teto máximo: R$ ${fmt(teto, 0)}`}
  </div>
</div>

<!-- DETALHAMENTO FINANCEIRO -->
<h2>Detalhamento Financeiro da Operação</h2>
<div class="avoid">
  <h3>A) Capital Mobilizado (Saídas)</h3>
  <table>
    <tr><th>Item</th><th class="c">% do Aporte</th><th class="r">Lance Base</th><th class="r">Teto (R$ ${fmt(teto,0)})</th></tr>
    <tr><td>${isAVista ? 'Arrematação (imóvel)' : `Sinal (${d.sinalPercentual}%)`}</td><td class="c">${m.capitalMobilizado > 0 ? fmtPct((isAVista ? m.vArremate : m.valorSinal) / m.capitalMobilizado * 100) : '-'}</td><td class="r red">R$ ${fmt(isAVista ? m.vArremate : m.valorSinal)}</td><td class="r amber">R$ ${fmt(isAVista ? mt.vArremate : mt.valorSinal)}</td></tr>
    <tr><td>Honorários Jurídicos TSN (10%)</td><td class="c">${m.capitalMobilizado > 0 ? fmtPct(m.honorarios/m.capitalMobilizado*100) : '-'}</td><td class="r red">R$ ${fmt(m.honorarios)}</td><td class="r amber">R$ ${fmt(mt.honorarios)}</td></tr>
    <tr><td>Taxa Leiloeiro (${d.taxaLeiloeiroPercentual}%)</td><td class="c">${m.capitalMobilizado > 0 ? fmtPct(m.taxaLeiloeiro/m.capitalMobilizado*100) : '-'}</td><td class="r red">R$ ${fmt(m.taxaLeiloeiro)}</td><td class="r amber">R$ ${fmt(mt.taxaLeiloeiro)}</td></tr>
    <tr><td>ITBI + Registro (${d.itbiPercentual}%)</td><td class="c">${m.capitalMobilizado > 0 ? fmtPct(m.itbiRegistro/m.capitalMobilizado*100) : '-'}</td><td class="r red">R$ ${fmt(m.itbiRegistro)}</td><td class="r amber">R$ ${fmt(mt.itbiRegistro)}</td></tr>
    ${(d.laudemio || 0) > 0 ? `<tr><td>Laudêmio</td><td class="c">-</td><td class="r red">R$ ${fmt(m.laudemio)}</td><td class="r amber">R$ ${fmt(mt.laudemio)}</td></tr>` : ''}
    ${(d.foreiro || 0) > 0 ? `<tr><td>Foreiro</td><td class="c">-</td><td class="r red">R$ ${fmt(m.foreiro)}</td><td class="r amber">R$ ${fmt(mt.foreiro)}</td></tr>` : ''}
    ${(d.debitosAssumidos || 0) > 0 ? `<tr><td>Débitos Assumidos</td><td class="c">-</td><td class="r red">R$ ${fmt(m.debitos)}</td><td class="r amber">R$ ${fmt(mt.debitos)}</td></tr>` : ''}
    <tr><td>Reforma / Retrofit</td><td class="c">${m.capitalMobilizado > 0 ? fmtPct(m.manutencao/m.capitalMobilizado*100) : '-'}</td><td class="r red">R$ ${fmt(m.manutencao)}</td><td class="r amber">R$ ${fmt(mt.manutencao)}</td></tr>
    ${!isAVista ? `<tr><td>Parcelas Banco (${d.prazoVendaMeses} meses)</td><td class="c">-</td><td class="r red">R$ ${fmt(m.parcelasPagas)}</td><td class="r amber">R$ ${fmt(mt.parcelasPagas)}</td></tr>` : ''}
    <tr><td>Carrego (IPTU + Condomínio)</td><td class="c">-</td><td class="r red">R$ ${fmt(m.custoCarrrego)}</td><td class="r amber">R$ ${fmt(mt.custoCarrrego)}</td></tr>
    <tr style="background:#fef2f2;font-weight:800;"><td>TOTAL APORTADO (A)</td><td class="c">100%</td><td class="r red" style="font-size:12px;">R$ ${fmt(m.capitalMobilizado)}</td><td class="r amber" style="font-size:12px;">R$ ${fmt(mt.capitalMobilizado)}</td></tr>
  </table>

  <h3>B) Receita / Formação de Patrimônio</h3>
  <table>
    <tr><th>Item</th><th class="r">Lance Base</th><th class="r">Teto</th></tr>
    <tr><td>${labelRef}</td><td class="r green">R$ ${fmt(m.valorRef)}</td><td class="r">R$ ${fmt(mt.valorRef)}</td></tr>
    ${!isUsoProprio ? `<tr><td>(-) Comissão Venda (5%)</td><td class="r red">- R$ ${fmt(m.comissao)}</td><td class="r red">- R$ ${fmt(mt.comissao)}</td></tr>
    <tr><td>(-) IR Ganho de Capital (15%)</td><td class="r red">- R$ ${fmt(m.ir)}</td><td class="r red">- R$ ${fmt(mt.ir)}</td></tr>` : ''}
    ${!isAVista ? `<tr><td>(-) Quitação Banco</td><td class="r red">- R$ ${fmt(m.saldoDevedor)}</td><td class="r red">- R$ ${fmt(mt.saldoDevedor)}</td></tr>` : ''}
    <tr style="background:#d1fae5;font-weight:800;"><td>RECEITA LÍQUIDA NA CONTA (B)</td><td class="r green" style="font-size:12px;">R$ ${fmt(m.receitaLiquida)}</td><td class="r" style="font-size:12px;">R$ ${fmt(mt.receitaLiquida)}</td></tr>
  </table>

  <h3>C) Resultado Final</h3>
  <table style="width:60%;">
    <tr><td>Capital Aportado (A)</td><td class="r red">R$ ${fmt(m.capitalMobilizado)}</td></tr>
    <tr><td>${isUsoProprio ? 'ECONOMIA REAL' : 'LUCRO REAL LÍQUIDO'} (B - A)</td><td class="r ${m.lucro >= 0 ? 'green' : 'red'}" style="font-size:14px;">R$ ${fmt(m.lucro)}</td></tr>
    <tr style="background:#dbeafe;font-weight:900;"><td>RETORNO TOTAL (${isAVista ? 'ROI' : 'ROE'})</td><td class="r blue" style="font-size:14px;">${fmtPct(m.roi)}</td></tr>
    ${!isUsoProprio ? `<tr><td>Yield Locação Mensal</td><td class="r">${fmtPct(m.yieldMensal)}/mês (${fmtPct(m.yieldAnual)}/ano)</td></tr>` : ''}
  </table>
</div>

<!-- DEFESA DA ARREMATAÇÃO -->
${ai.defesa ? `<div class="avoid pb"><h2>Defesa da Arrematação</h2><pre>${ai.defesa}</pre></div>` : ''}

<!-- PROJEÇÃO DE LOCAÇÃO -->
${ai.locacao && !isUsoProprio && d.tipoImovel !== 'terreno' ? `<div class="avoid"><h2>Projeção de Retorno por Locação</h2><pre>${ai.locacao}</pre></div>` : ''}

<!-- TABELA DE FINANCIAMENTO SAC/PRICE -->
${!isAVista && sacTabela.length > 0 ? `
<div class="avoid pb">
  <h2>Tabelas de Financiamento — SAC vs PRICE</h2>
  <p style="font-size:10px;color:#475569;margin-bottom:10px;">Principal financiado: R$ ${fmt((d.valorArrematacao||0)*(1-(d.sinalPercentual||0)/100))} · CET: ${d.cetAnual}% a.a. · Prazo: ${d.prazoMeses} meses</p>
  <div style="display:flex;gap:20px;margin-bottom:10px;">
    <div style="flex:1;padding:10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
      <div style="font-weight:900;margin-bottom:4px;font-size:11px;">SAC</div>
      <div>1ª Parcela: <b>R$ ${fmt(sacTabela[0]?.parcela,0)}</b></div>
      <div>Últ. Parcela: <b>R$ ${fmt(sacTabela[sacTabela.length-1]?.parcela,0)}</b></div>
      <div>Total Pago: <b class="red">R$ ${fmt(sacTotal,0)}</b></div>
    </div>
    <div style="flex:1;padding:10px;background:#f8fafc;border-radius:6px;border:1px solid #e2e8f0;">
      <div style="font-weight:900;margin-bottom:4px;font-size:11px;">PRICE</div>
      <div>Parcela Fixa: <b>R$ ${fmt(priceTabela[0]?.parcela,0)}</b></div>
      <div>Última: <b>R$ ${fmt(priceTabela[priceTabela.length-1]?.parcela,0)}</b></div>
      <div>Total Pago: <b class="red">R$ ${fmt(priceTotal,0)}</b></div>
    </div>
  </div>
  <table>
    <tr><th>Mês</th><th class="r">SAC Parcela</th><th class="r">SAC Saldo</th><th class="r">PRICE Parcela</th><th class="r">PRICE Saldo</th></tr>
    ${sacTabela.filter((_, i) => i < 6 || i >= sacTabela.length - 3 || i % Math.max(1, Math.floor(sacTabela.length / 12)) === 0).slice(0,20).map((r, i) => `
    <tr style="background:${i%2===0?'white':'#f8fafc'}">
      <td>${r.mes}</td>
      <td class="r">R$ ${fmt(r.parcela,0)}</td>
      <td class="r blue">R$ ${fmt(r.saldo,0)}</td>
      <td class="r">R$ ${fmt(priceTabela[r.mes-1]?.parcela||0,0)}</td>
      <td class="r blue">R$ ${fmt(priceTabela[r.mes-1]?.saldo||0,0)}</td>
    </tr>`).join('')}
  </table>
</div>` : ''}

<!-- FLUXO DE CAIXA -->
<div class="avoid pb">
  <h2>Demonstrativo de Fluxo de Caixa</h2>
  <table>
    <tr><th>Mês</th><th>Descrição</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Saldo Acumulado</th></tr>
    ${fluxo.linhas.map((r, i) => `<tr style="background:${i%2===0?'white':'#f8fafc'}">
      <td style="font-weight:700;">Mês ${r.mes}</td>
      <td style="color:#475569;">${r.descricao}</td>
      <td class="r green">${r.entrada>0 ? `+ R$ ${fmt(r.entrada)}` : '—'}</td>
      <td class="r red">${r.saida>0 ? `- R$ ${fmt(r.saida)}` : '—'}</td>
      <td class="r ${r.saldo>=0?'green':'red'}" style="background:${r.saldo>=0?'#f0fdf4':'#fef2f2'}">R$ ${fmt(r.saldo)}</td>
    </tr>`).join('')}
    <tr style="background:#0f172a;color:white;font-weight:800;">
      <td colspan="3" class="r" style="font-size:10px;text-transform:uppercase;">Total Saídas</td>
      <td class="r" style="color:#fca5a5;">- R$ ${fmt(fluxo.totalSaidas)}</td><td></td></tr>
    <tr style="background:#065f46;color:white;font-weight:900;">
      <td colspan="4" class="r" style="text-transform:uppercase;">Resultado Final</td>
      <td class="r" style="font-size:13px;">= R$ ${fmt(fluxo.totalEntradas - fluxo.totalSaidas)}</td>
    </tr>
  </table>
</div>

<!-- AMOSTRAS DE MERCADO -->
${ai.amostras ? `<div class="avoid"><h2>Amostras de Mercado — Validação Comparativa</h2><pre>${ai.amostras}</pre></div>` : ''}

<!-- RISCOS JURÍDICOS -->
${(d.riscos||[]).length > 0 ? `
<div class="avoid">
  <h2>Análise de Riscos Jurídicos</h2>
  ${(d.riscos||[]).map(r => `<div class="risk-item" style="background:${r.tipo==='bloqueante'?'#fee2e2':r.tipo==='alerta'?'#fef3c7':'#dbeafe'};border:1px solid ${r.tipo==='bloqueante'?'#fca5a5':r.tipo==='alerta'?'#fde68a':'#bfdbfe'}">
    <span style="font-size:9px;font-weight:800;background:white;padding:2px 6px;border-radius:10px;color:${r.tipo==='bloqueante'?'#dc2626':r.tipo==='alerta'?'#d97706':'#2563eb'};white-space:nowrap;">${r.tipo.toUpperCase()}</span>
    <span>${r.texto}</span>
  </div>`).join('')}
</div>` : ''}

<!-- RODAPÉ -->
<div style="margin-top:30px;border-top:2px solid #e2e8f0;padding-top:14px;display:flex;justify-content:space-between;font-size:9px;color:#94a3b8;">
  <span>TSN Ativos — Análise gerada em ${new Date().toLocaleString('pt-BR')}</span>
  <span>Documento confidencial — uso exclusivo do cliente</span>
</div>
</body></html>`;

  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}
