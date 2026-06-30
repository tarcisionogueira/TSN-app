import { fmt, fmtPct } from '../utils/calculos';

export function gerarPDF({ d, metricas: m, metricasTeto: mt, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTab, priceTab, mercado, parecer }) {
  const win = window.open('', '_blank');
  if (!win) { alert('Permita pop-ups para gerar o PDF.'); return; }

  const parseSecoes = (txt) => {
    if (!txt) return {};
    const res = {};
    txt.split(/§\s*SEÇÃO:/i).filter(s=>s.trim()).forEach(p => {
      const nl = p.indexOf('\n');
      if (nl < 0) return;
      const t = p.substring(0,nl).trim().toUpperCase();
      const c = p.substring(nl).trim();
      if (t.includes('POSICIONAMENTO')) res.pos = c;
      else if (t.includes('DEFESA')) res.def = c;
      else if (t.includes('LOCAÇÃO') || t.includes('RENTAB')) res.loc = c;
      else if (t.includes('CONCLUSÃO')) res.conc = c;
    });
    return res;
  };

  const sec = parseSecoes(parecer || '');
  const riscosBloq = (d.riscos||[]).filter(r=>r.tipo==='bloqueante');
  const sacTotal = (sacTab||[]).reduce((s,r)=>s+r.parcela,0);
  const priceTotal = (priceTab||[]).reduce((s,r)=>s+r.parcela,0);
  const sacPrincipal = (sacTab||[]).reduce((s,r)=>s+r.amortizacao,0);

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório BidPro Brasil — ${d.nome||d.endereco}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  body{font-family:'Inter',sans-serif;font-size:10.5px;color:#111111;padding:20px;line-height:1.5;background:white;margin:0;}
  @media print{body{padding:0;}@page{margin:8mm;size:A4;}
    .pb{page-break-before:always;}.av{page-break-inside:avoid;}}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111111;padding-bottom:12px;margin-bottom:18px;}
  h2{font-size:12px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:18px 0 8px;}
  h3{font-size:10.5px;font-weight:700;margin:12px 0 6px;color:#111111;}
  table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:10px;}
  th,td{border:1px solid #cbd5e1;padding:5px 7px;}
  th{background:#f1f5f9;font-weight:700;text-align:left;}
  .r{text-align:right;}.c{text-align:center;}
  .g{color:#059669;font-weight:700;}.rd{color:#dc2626;font-weight:700;}
  .am{color:#d97706;font-weight:700;}.bl{color:#0D63DB;font-weight:700;}
  .bg-g{background:#d1fae5;}.bg-rd{background:#fee2e2;}.bg-bl{background:#dbeafe;}
  .box{border:2px solid #dc2626;background:#fef2f2;padding:10px;border-radius:5px;margin:10px 0;}
  .obs{border-left:4px solid #0D63DB;background:#f0f9ff;padding:8px 12px;margin-bottom:12px;}
  pre{white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:10px;margin:0;line-height:1.6;}
  .viab{padding:12px;border-radius:6px;margin:12px 0;border:2px solid;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}
  .card{background:#f8fafc;border-radius:5px;padding:8px 10px;text-align:center;}
  .card-v{font-size:16px;font-weight:900;margin-top:2px;}
  .card-l{font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;}
</style></head><body>

<div class="hdr av">
  <div>
    <div style="font-size:22px;font-weight:900;text-transform:uppercase;margin-bottom:3px;">BidPro Brasil</div>
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Aquisição em Leilão & Investimentos Estratégicos</div>
    <div style="font-size:13px;font-weight:900;margin-bottom:3px;">ANÁLISE DE VIABILIDADE DE ARREMATAÇÃO</div>
    <div style="font-size:10px;color:#475569;">${(d.tipo||'').toUpperCase()} — ${d.endereco||''} ${d.cidade?'· '+d.cidade:''} ${d.estado?'/'+d.estado:''}</div>
    ${d.leiloeiro?`<div style="font-size:9px;color:#64748b;margin-top:3px;">Leiloeiro: ${d.leiloeiro}${d.dataLeilao?' · '+d.dataLeilao:''}</div>`:''}
  </div>
  <div style="text-align:right;flex-shrink:0;">
    <div style="font-size:10px;font-weight:700;margin-bottom:3px;">Data: ${new Date().toLocaleDateString('pt-BR')}</div>
    <div style="font-size:9px;color:#64748b;">Cenário: ${isAVista?'À VISTA':'ALAVANCADO (SAC/PRICE)'}</div>
    <div style="font-size:9px;color:#64748b;">Objetivo: ${isUsoProprio?'USO PRÓPRIO':'INVESTIMENTO'}</div>
    <div style="font-size:9px;color:#64748b;">Área: ${d.areaM2||0}m² (priv.) / ${d.areaTerrenoM2||0}m² (terreno)</div>
    <div style="font-size:9px;color:#64748b;margin-top:3px;">Honorários Jurídicos: 10%</div>
  </div>
</div>

${riscosBloq.length>0?`<div class="box av"><div style="font-size:13px;font-weight:900;color:#b91c1c;margin-bottom:6px;">⚠ RISCO JURÍDICO BLOQUEANTE</div>${riscosBloq.map(r=>`<div style="color:#dc2626;font-size:10px;margin-bottom:3px;">• ${r.texto}</div>`).join('')}</div>`:''}

${d.observacoes?`<div class="obs av"><b style="font-size:9px;text-transform:uppercase;">Anotações da Gestão:</b><br/><span style="color:#475569;">${d.observacoes.replace(/\n/g,'<br/>')}</span></div>`:''}

<div class="viab av" style="border-color:${isViavel?'#10b981':'#dc2626'};background:${isViavel?'#d1fae5':'#fee2e2'};">
  <div style="font-size:15px;font-weight:900;color:${isViavel?'#065f46':'#b91c1c'};">${isViavel?'✓ OPERAÇÃO VIÁVEL — APROVADA':'✗ OPERAÇÃO REPROVADA — RETORNO INSUFICIENTE'}</div>
  <div style="font-size:10px;color:${isViavel?'#047857':'#dc2626'};margin-top:4px;">
    ${isUsoProprio?`Economia de R$ ${fmt(m.lucro)} vs mercado (${fmtPct(m.roi)} de desconto efetivo)`:`Retorno ${fmtPct(m.roi)} ${isAVista?'ROI':'ROE'} · ${isViavel?'Atinge 40% mínimos':'Abaixo dos 40% exigidos pela BidPro Brasil'} · Teto de disputa: R$ ${fmt(teto)}`}
  </div>
</div>

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;" class="av">
  ${[['Capital Aportado',`R$ ${fmt(m.capitalMobilizado)}`,'#dc2626'],
     [isUsoProprio?'Economia Real':'Lucro Líquido',`R$ ${fmt(m.lucro)}`,(m.lucro>=0?'#059669':'#dc2626')],
     ['Yield Locação',`${fmtPct(m.yieldMensal)}/mês`,'#7c3aed'],
     ['Teto Disputa',`R$ ${fmt(teto)}`,'#d97706']].map(([l,v,c])=>`
  <div class="card"><div class="card-l">${l}</div><div class="card-v" style="color:${c}">${v}</div></div>`).join('')}
</div>

${sec.pos?`<div class="av"><h2>Posicionamento Estratégico</h2><pre>${sec.pos}</pre></div>`:''}

<h2>Detalhamento Financeiro Completo</h2>
<div class="av">
  <h3>A) Capital Mobilizado (Saídas)</h3>
  <table>
    <tr><th>Item</th><th class="c">% do Aporte</th><th class="r">Lance Base</th><th class="r">Teto (R$ ${fmt(teto)})</th></tr>
    ${[
      ['Arrematação/Sinal', isAVista?m.vArremate:m.valorSinal, isAVista?mt.vArremate:mt.valorSinal],
      ['Honorários Jurídicos (10%)', m.honorarios, mt.honorarios],
      [`Taxa Leiloeiro (${fmtPct(d.taxaLeiloeiroPercentual)})`, m.taxaLeiloeiro, mt.taxaLeiloeiro],
      [`ITBI + Registro (${fmtPct(d.itbiPercentual)})`, m.itbiRegistro, mt.itbiRegistro],
      ...(d.laudemio>0?[['Laudêmio', m.laudemio, mt.laudemio]]:[]),
      ...(d.foreiro>0?[['Foreiro', m.foreiro, mt.foreiro]]:[]),
      ...(d.debitosAssumidos>0?[['Débitos Assumidos', m.debitos, mt.debitos]]:[]),
      ['Reforma / Retrofit', m.manutencao, mt.manutencao],
      ...(!isAVista?[['Parcelas Banco','–','–']]:[]),
      ['Carrego (IPTU/Cond)', m.custoCarrrego, mt.custoCarrrego],
    ].filter(r=>typeof r[1]==='string'||r[1]>0||r[2]>0).map(([l,b,tv])=>`
    <tr><td>${l}</td><td class="c">${m.capitalMobilizado>0&&typeof b==='number'?fmtPct(b/m.capitalMobilizado*100):'-'}</td>
    <td class="r rd">- R$ ${typeof b==='number'?fmt(b):b}</td>
    <td class="r am">- R$ ${typeof tv==='number'?fmt(tv):tv}</td></tr>`).join('')}
    <tr style="background:#fef2f2;font-weight:800;"><td>TOTAL APORTADO (A)</td><td class="c">100%</td>
    <td class="r rd" style="font-size:12px;">R$ ${fmt(m.capitalMobilizado)}</td>
    <td class="r am" style="font-size:12px;">R$ ${fmt(mt.capitalMobilizado)}</td></tr>
  </table>

  <h3>B) Resultado</h3>
  <table>
    <tr><th>Item</th><th class="r">Lance Base</th><th class="r">Teto</th></tr>
    <tr><td>${isUsoProprio?'Valor de Mercado':'Venda Bruta (90% do mercado)'}</td>
    <td class="r g">R$ ${fmt(m.valorRef)}</td><td class="r">R$ ${fmt(mt.valorRef)}</td></tr>
    ${!isUsoProprio?`<tr><td>(-) Comissão Venda + IR Ganho de Capital</td>
    <td class="r rd">- R$ ${fmt(m.comissao+m.ir)}</td><td class="r rd">- R$ ${fmt(mt.comissao+mt.ir)}</td></tr>`:''}
    ${!isAVista?`<tr><td>(-) Quitação do Banco</td>
    <td class="r rd">- R$ ${fmt(m.saldoDevedor)}</td><td class="r rd">- R$ ${fmt(mt.saldoDevedor)}</td></tr>`:''}
    <tr style="background:#d1fae5;font-weight:800;">
    <td>RECEITA LÍQUIDA NA CONTA (B)</td>
    <td class="r g" style="font-size:12px;">R$ ${fmt(m.receitaLiquida)}</td>
    <td class="r" style="font-size:12px;">R$ ${fmt(mt.receitaLiquida)}</td></tr>
    <tr style="background:#dbeafe;font-weight:900;font-size:12px;">
    <td>${isUsoProprio?'ECONOMIA REAL':'LUCRO REAL LÍQUIDO'} (B - A)</td>
    <td class="r ${m.lucro>=0?'g':'rd'}" style="font-size:14px;">R$ ${fmt(m.lucro)}</td>
    <td class="r ${mt.lucro>=0?'g':'rd'}" style="font-size:14px;">R$ ${fmt(mt.lucro)}</td></tr>
    <tr style="background:#ede9fe;font-weight:900;">
    <td>RETORNO TOTAL (${isAVista?'ROI':'ROE'})</td>
    <td class="r bl" style="font-size:14px;">${fmtPct(m.roi)}</td>
    <td class="r am" style="font-size:14px;">${fmtPct(mt.roi)}</td></tr>
    ${d.valorLocacao>0?`<tr><td>Yield de Locação (Ref.)</td>
    <td class="r" style="color:#7c3aed;font-weight:700;">${fmtPct(m.yieldMensal)}/mês · ${fmtPct(m.yieldAnual)}/ano</td><td></td></tr>`:''}
  </table>
</div>

${sec.def?`<div class="av"><h2>Defesa da Arrematação</h2><pre>${sec.def}</pre></div>`:''}

${mercado?`<div class="av">
<h2>Avaliação Mercadológica</h2>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;">
  ${[['Preço Médio/m²',`R$ ${fmt(mercado.precoMedioM2||0)}`,'#0D63DB'],
     ['Aluguel Médio',`R$ ${fmt(mercado.aluguelMedio||0)}/mês`,'#7c3aed'],
     ['Yield Bruto',fmtPct(mercado.yieldBruto||0),'#059669'],
     ['Yield Líquido',fmtPct(mercado.yieldLiquido||0),'#d97706']].map(([l,v,c])=>`
  <div class="card"><div class="card-l">${l}</div><div class="card-v" style="color:${c}">${v}</div></div>`).join('')}
</div>
${mercado.comentario?`<p style="font-size:10px;color:#475569;margin:0 0 10px;background:#f8fafc;padding:8px;border-radius:4px;">${mercado.comentario}</p>`:''}
${mercado.vendas?.length?`<h3>Amostras de Venda (${mercado.totalAmostrasVenda} encontradas)</h3>
<table><tr><th>Imóvel</th><th class="r">Valor Total</th><th class="r">R$/m²</th><th>Fonte</th></tr>
${mercado.vendas.slice(0,8).map(v=>`<tr><td>${v.descricao}</td><td class="r g">R$ ${fmt(v.valor)}</td><td class="r">R$ ${fmt(v.valorM2)}</td><td style="font-size:9px;color:#94a3b8">${v.fonte}</td></tr>`).join('')}</table>`:''}
${mercado.locacoes?.length?`<h3>Amostras de Locação</h3>
<table><tr><th>Imóvel</th><th class="r">Aluguel/mês</th><th>Fonte</th></tr>
${mercado.locacoes.map(l=>`<tr><td>${l.descricao}</td><td class="r" style="color:#7c3aed;font-weight:700;">R$ ${fmt(l.valorMensal)}</td><td style="font-size:9px;color:#94a3b8">${l.fonte}</td></tr>`).join('')}</table>`:''}
</div>`:''}

${sec.loc?`<div class="av"><h2>Projeção de Rentabilidade por Locação</h2><pre>${sec.loc}</pre></div>`:''}

<div class="pb av">
<h2>Fluxo de Caixa Mensal</h2>
<table><tr><th>Mês</th><th>Descrição</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Saldo</th></tr>
${fluxo.linhas.map((r,i)=>`<tr style="background:${i%2===0?'white':'#f8fafc'}">
<td style="font-weight:700;">Mês ${r.mes}</td><td style="color:#475569;">${r.descricao}</td>
<td class="r g">${r.entrada>0?'+ R$ '+fmt(r.entrada):'—'}</td>
<td class="r rd">${r.saida>0?'- R$ '+fmt(r.saida):'—'}</td>
<td class="r ${r.saldo>=0?'g':'rd'}" style="background:${r.saldo>=0?'#f0fdf4':'#fef2f2'}">R$ ${fmt(r.saldo)}</td></tr>`).join('')}
<tr style="background:#111111;color:white;font-weight:800;"><td colspan="3" class="r" style="font-size:9px;text-transform:uppercase;">Total Aportado</td>
<td class="r" style="color:#fca5a5;">- R$ ${fmt(fluxo.totalSaidas)}</td><td></td></tr>
<tr style="background:#065f46;color:white;font-weight:900;"><td colspan="4" class="r" style="text-transform:uppercase;">Resultado Final</td>
<td class="r" style="font-size:13px;">= R$ ${fmt(fluxo.totalEntradas-fluxo.totalSaidas)}</td></tr>
</table>
</div>

${!isAVista&&sacTab?.length>0?`<div class="pb av">
<h2>Tabelas de Financiamento — SAC vs PRICE</h2>
<p style="font-size:9px;color:#475569;margin-bottom:8px;">Principal: R$ ${fmt((d.valorArrematacao||0)*(1-(d.sinalPercentual||0)/100))} · CET: ${fmtPct(d.cetAnual)} a.a. · Prazo: ${d.prazoMeses} meses</p>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:10px;">
  <div style="background:#f8fafc;border-radius:5px;padding:10px;">
    <div style="font-weight:900;margin-bottom:4px;">SAC</div>
    <div style="font-size:10px;">1ª Parcela: <b>R$ ${fmt(sacTab[0]?.parcela||0)}</b></div>
    <div style="font-size:10px;">Última: <b>R$ ${fmt(sacTab[sacTab.length-1]?.parcela||0)}</b></div>
    <div style="font-size:10px;">Total Pago: <b class="rd">R$ ${fmt(sacTotal)}</b></div>
  </div>
  <div style="background:#f8fafc;border-radius:5px;padding:10px;">
    <div style="font-weight:900;margin-bottom:4px;">PRICE</div>
    <div style="font-size:10px;">Parcela Fixa: <b>R$ ${fmt(priceTab[0]?.parcela||0)}</b></div>
    <div style="font-size:10px;">Total Pago: <b class="rd">R$ ${fmt(priceTotal)}</b></div>
    <div style="font-size:10px;">Diferença: <b class="am">R$ ${fmt(Math.abs(priceTotal-sacTotal))} (${priceTotal>sacTotal?'SAC mais barato':'PRICE mais barato'})</b></div>
  </div>
</div>
<table><tr><th>Mês</th><th class="r">SAC Parcela</th><th class="r">SAC Saldo</th><th class="r">PRICE Parcela</th><th class="r">PRICE Saldo</th></tr>
${sacTab.filter((_,i)=>i<5||i===sacTab.length-1||i%Math.max(1,Math.floor(sacTab.length/10))===0).slice(0,18).map((r,i)=>`
<tr style="background:${i%2===0?'white':'#f8fafc'}">
<td>${r.mes}</td><td class="r">R$ ${fmt(r.parcela)}</td><td class="r bl">R$ ${fmt(r.saldo)}</td>
<td class="r">R$ ${fmt(priceTab[r.mes-1]?.parcela||0)}</td><td class="r bl">R$ ${fmt(priceTab[r.mes-1]?.saldo||0)}</td></tr>`).join('')}
</table>
</div>`:''}

${(d.riscos||[]).length>0?`<div class="av">
<h2>Riscos Jurídicos Identificados</h2>
${(d.riscos||[]).map(r=>`<div style="padding:6px 10px;margin-bottom:4px;border-radius:4px;background:${r.tipo==='bloqueante'?'#fee2e2':r.tipo==='alerta'?'#fef3c7':'#dbeafe'};border:1px solid ${r.tipo==='bloqueante'?'#fca5a5':r.tipo==='alerta'?'#fde68a':'#bfdbfe'};display:flex;gap:8px;align-items:flex-start;">
<span style="font-size:8px;font-weight:800;background:white;padding:2px 6px;border-radius:10px;color:${r.tipo==='bloqueante'?'#dc2626':r.tipo==='alerta'?'#d97706':'#0D63DB'};white-space:nowrap;">${r.tipo.toUpperCase()}</span>
<span style="font-size:10px;">${r.texto}</span></div>`).join('')}
</div>`:''}

${sec.conc?`<div class="av"><h2>Conclusão e Recomendação da Gestão</h2><pre>${sec.conc}</pre></div>`:''}

<div style="margin-top:28px;border-top:2px solid #e2e8f0;padding-top:12px;display:flex;justify-content:space-between;font-size:8.5px;color:#94a3b8;">
  <span>BidPro Brasil · Análise gerada em ${new Date().toLocaleString('pt-BR')}</span>
  <span>Documento confidencial · Uso exclusivo do cliente</span>
</div>
</body></html>`;

  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 700);
}
