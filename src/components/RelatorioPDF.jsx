import { fmt, fmtPct } from '../utils/calculos';
import { imprimirHtml } from './pdfImprimir';
import { cabecalhoBidPro, ESTILOS_CABECALHO } from './pdfCabecalho';

// CSS do documento (exportado para o PDF combinado reaproveitar). O `.bl` aqui é
// "texto azul" (helper de tabela); o parecer final usa `.blk` para blocos, para
// não colidir quando os estilos são unidos no combinado.
export const ESTILOS_MERCADOLOGICO = `
  body{font-family:'Inter',sans-serif;font-size:12px;color:#0f172a;padding:20px;line-height:1.6;background:white;margin:0;-webkit-font-smoothing:antialiased;}
  @media print{body{padding:0;}@page{margin:8mm;size:A4;}
    .pb{page-break-before:always;}.av{page-break-inside:avoid;}}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111111;padding-bottom:12px;margin-bottom:18px;}
  h2{font-size:13.5px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:18px 0 8px;}
  h3{font-size:12px;font-weight:800;margin:12px 0 6px;color:#111111;}
  table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:11.5px;}
  th,td{border:1px solid #cbd5e1;padding:6px 8px;}
  th{background:#f1f5f9;font-weight:700;text-align:left;}
  .r{text-align:right;}.c{text-align:center;}
  .g{color:#059669;font-weight:700;}.rd{color:#dc2626;font-weight:700;}
  .am{color:#b45309;font-weight:700;}.bl{color:#0D63DB;font-weight:700;}
  .bg-g{background:#d1fae5;}.bg-rd{background:#fee2e2;}.bg-bl{background:#dbeafe;}
  .box{border:2px solid #dc2626;background:#fef2f2;padding:10px;border-radius:5px;margin:10px 0;}
  .obs{border-left:4px solid #0D63DB;background:#f0f9ff;padding:8px 12px;margin-bottom:12px;}
  pre{white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:12px;margin:0;line-height:1.75;color:#1e293b;}
  .viab{padding:12px;border-radius:6px;margin:12px 0;border:2px solid;}
  .grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;}
  .card{background:#f8fafc;border-radius:5px;padding:8px 10px;text-align:center;}
  .card-v{font-size:16px;font-weight:900;margin-top:2px;}
  .card-l{font-size:9px;color:#64748b;font-weight:700;text-transform:uppercase;}
` + ESTILOS_CABECALHO;

// Corpo (conteúdo do <body>) do relatório mercadológico — exportado para o PDF
// combinado. O gerador individual (gerarPDF) empacota isto num documento completo.
export function corpoMercadologico({ d, metricas: m, metricasTeto: mt, teto, isAVista, isUsoProprio, isViavel, fluxo, sacTab, priceTab, mercado, parecer, indicadores: ind, cab = {} }) {
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

  // Lance base (2ª praça / lance mínimo) e teto viável de disputa. Quando o teto
  // que ainda preserva o piso de lucro é MENOR/IGUAL ao lance mínimo, não há
  // margem para disputar: qualquer lance acima do mínimo já derruba a operação.
  const lanceBase = Number(d.valorArrematacao) || 0;
  const semMargemDisputa = !isUsoProprio && Number(teto) > 0 && Number(teto) <= lanceBase;
  // Valor pretendido de venda (referência de saída): venda bruta a 90% do mercado
  // (uso próprio usa o valor de mercado cheio como referência de economia).
  const valorVendaPretendido = Number(m?.valorRef) || 0;

  return `
${cabecalhoBidPro({
  titulo: 'Análise de Viabilidade de Arrematação',
  subtitulo: `Cenário: ${isAVista ? 'À vista' : 'Alavancado (SAC/PRICE)'} · ${isUsoProprio ? 'Uso próprio' : 'Investimento'}`,
  docSeq: 'Documento 1 de 3',
  imovel: d,
  matricula: cab.matricula || '',
  executado: cab.executado || '',
  processo: cab.processo || '',
  solicitante: cab.solicitante || {},
  geradoEm: cab.geradoEm,
})}

${(() => {
  // QUADRO-RESUMO — leitura rápida no topo (imóvel, lances das praças, valor
  // pretendido de venda, forma de pagamento e veredito). O corpo detalha depois.
  const cel = (l, v, c='#111111') => `<div style="padding:8px 10px;border-right:1px solid #e2e8f0;border-bottom:1px solid #e2e8f0;">
    <div style="font-size:8px;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">${l}</div>
    <div style="font-size:11.5px;font-weight:800;color:${c};margin-top:2px;">${v}</div></div>`;
  const vereditoTxt = isUsoProprio
    ? (isViavel ? 'RECOMENDADO PARA USO PRÓPRIO' : 'ECONOMIA IRRELEVANTE, REAVALIAR')
    : (isViavel ? 'APROVADO, VIÁVEL' : 'REPROVADO, RETORNO INSUFICIENTE');
  const vCor = isViavel ? '#065f46' : '#b91c1c';
  const vBg  = isViavel ? '#d1fae5' : '#fee2e2';
  return `
<div class="av" style="border:2px solid #111111;border-radius:8px;overflow:hidden;margin-bottom:16px;">
  <div style="background:#111111;color:white;padding:7px 12px;font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:1.5px;">Quadro-Resumo da Operação</div>
  <div style="display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid #e2e8f0;">
    ${cel('Imóvel', `${(d.tipo||'—').toUpperCase()} · ${d.cidade||''}${d.estado?'/'+d.estado:''}`)}
    ${cel('Área', `${d.areaM2||0} m²${d.areaTerrenoM2?` (terreno ${d.areaTerrenoM2} m²)`:''}`)}
    ${cel('Forma de pagamento', isAVista?'À vista':'Financiado / alavancado')}
    ${cel('1ª praça (avaliação)', d.valorAvaliacao>0?`R$ ${fmt(d.valorAvaliacao)}`:'—')}
    ${cel('2ª praça (lance mínimo)', lanceBase>0?`R$ ${fmt(lanceBase)}`:'—','#0D63DB')}
    ${cel('Teto com disputa', semMargemDisputa?'Sem margem':(teto>0?`R$ ${fmt(teto)}`:'—'), semMargemDisputa?'#d97706':'#d97706')}
    ${cel('Valor pretendido de venda', valorVendaPretendido>0?`R$ ${fmt(valorVendaPretendido)}`:'—','#059669')}
    ${cel(isUsoProprio?'Economia estimada':'Lucro líquido estimado', `R$ ${fmt(m.lucro)}`, (m.lucro>=0?'#059669':'#dc2626'))}
    ${cel('Retorno', `${fmtPct(m.roi)} ${isAVista?'ROI':'ROE'}`,'#7c3aed')}
  </div>
  <div style="background:${vBg};color:${vCor};padding:9px 12px;font-size:12px;font-weight:900;text-align:center;letter-spacing:0.5px;">
    ${isViavel?'✓':'✗'} VEREDITO: ${vereditoTxt}
  </div>
</div>`;
})()}

${semMargemDisputa?`<div class="av" style="border:1.5px solid #f59e0b;background:#fffbeb;border-radius:6px;padding:9px 12px;margin-bottom:12px;">
  <div style="font-size:11px;font-weight:800;color:#92400e;">⚠ Sem margem para disputa</div>
  <div style="font-size:10px;color:#b45309;margin-top:3px;">O lance máximo que ainda preserva o piso de ${isUsoProprio?'economia':'30% de lucro'} (R$ ${fmt(teto)}) é igual ou inferior ao lance mínimo (R$ ${fmt(lanceBase)}). Na prática, qualquer lance acima do mínimo já inviabiliza a operação, arrematar só compensa no próprio lance mínimo, sem entrar em disputa.</div>
</div>`:''}

${riscosBloq.length>0?`<div class="box av"><div style="font-size:13px;font-weight:900;color:#b91c1c;margin-bottom:6px;">⚠ RISCO JURÍDICO BLOQUEANTE</div>${riscosBloq.map(r=>`<div style="color:#dc2626;font-size:10px;margin-bottom:3px;">• ${r.texto}</div>`).join('')}</div>`:''}

${d.observacoes?`<div class="obs av"><b style="font-size:9px;text-transform:uppercase;">Anotações da Gestão:</b><br/><span style="color:#475569;">${d.observacoes.replace(/\n/g,'<br/>')}</span></div>`:''}

${(() => {
  // Guarda de dados insuficientes: sem valor de arrematação E de mercado/avaliação,
  // o veredito seria carimbado sobre R$ 0 (enganoso). Mostra aviso âmbar no lugar.
  const arremat = Number(d.valorArrematacao) || 0;
  const referencia = Number(d.valorMercado) || Number(d.valorAvaliacao) || 0;
  if (arremat <= 0 || referencia <= 0) return `
<div class="viab av" style="border-color:#d97706;background:#fef3c7;">
  <div style="font-size:15px;font-weight:900;color:#92400e;">⚠ DADOS INSUFICIENTES PARA CONCLUSÃO DE VIABILIDADE</div>
  <div style="font-size:10px;color:#b45309;margin-top:4px;">Informe o valor de arrematação e o valor de mercado/avaliação (e a área) para calcular a viabilidade. Os indicadores abaixo podem estar incompletos.</div>
</div>`;
  return `
<div class="viab av" style="border-color:${isViavel?'#10b981':'#dc2626'};background:${isViavel?'#d1fae5':'#fee2e2'};">
  <div style="font-size:15px;font-weight:900;color:${isViavel?'#065f46':'#b91c1c'};">${isViavel?'✓ OPERAÇÃO VIÁVEL, APROVADA':'✗ OPERAÇÃO REPROVADA, RETORNO INSUFICIENTE'}</div>
  <div style="font-size:10px;color:${isViavel?'#047857':'#dc2626'};margin-top:4px;">
    ${isUsoProprio?`Economia de R$ ${fmt(m.lucro)} vs mercado (${fmtPct(m.roi)} de desconto efetivo)`:`Retorno ${fmtPct(m.roi)} ${isAVista?'ROI':'ROE'} · ${isViavel?'Atinge 30% mínimos':'Abaixo dos 30% exigidos pela BidPro Brasil'} · ${semMargemDisputa?'Sem margem para disputa (arrematar só no lance mínimo)':`Teto de disputa: R$ ${fmt(teto)}`}`}
  </div>
</div>`;
})()}

<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px;" class="av">
  ${[['Capital Aportado',`R$ ${fmt(m.capitalMobilizado)}`,'#dc2626'],
     [isUsoProprio?'Economia Real':'Lucro Líquido',`R$ ${fmt(m.lucro)}`,(m.lucro>=0?'#059669':'#dc2626')],
     ['Rentab. Aluguel',`${fmtPct(m.yieldMensal)}/mês`,'#7c3aed'],
     ['Teto Disputa',`R$ ${fmt(teto)}`,'#d97706']].map(([l,v,c])=>`
  <div class="card"><div class="card-l">${l}</div><div class="card-v" style="color:${c}">${v}</div></div>`).join('')}
</div>

${ind?`
<div class="av" style="margin-bottom:14px;">
  <h2>Indicadores de Retorno</h2>
  <div style="font-size:9px;color:#64748b;margin-bottom:6px;">Régua (TMA): ${fmtPct(ind.tma,0)} ao ano, já descontada nos números abaixo.</div>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;">
    ${[['VPL (revenda)',`R$ ${fmt(ind.vpl,0)}`,(ind.vpl>=0?'#059669':'#dc2626')],
       ['TIR (revenda)',ind.tir!=null?`${fmtPct(ind.tir)} a.a.`:'—','#7c3aed'],
       ['Payback',ind.payback?.meses!=null?`${ind.payback.meses} meses`:'—','#0D63DB'],
       ['Múltiplo do capital',ind.multiplo!=null?`${fmt(ind.multiplo)}x`:'—','#d97706']].map(([l,v,c])=>`
    <div class="card"><div class="card-l">${l}</div><div class="card-v" style="color:${c}">${v}</div></div>`).join('')}
  </div>
  <div style="font-size:9px;color:#475569;margin-top:6px;">Locação (${ind.loc?.horizonte||60} meses + venda ao final): aluguel líquido R$ ${fmt(ind.loc?.aluguelLiquido||0)}/mês · VPL R$ ${fmt(ind.loc?.vpl||0,0)} · TIR ${ind.loc?.tir!=null?`${fmtPct(ind.loc.tir)} a.a.`:'—'}.</div>
  <div style="margin-top:8px;border:1px solid #e2e8f0;border-radius:6px;background:#f8fafc;padding:8px 10px;">
    <div style="font-size:8.5px;font-weight:800;color:#475569;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Legenda dos indicadores</div>
    <div style="font-size:9px;color:#475569;line-height:1.6;">
      <b>VPL, Valor Presente Líquido:</b> quanto a operação gera hoje, já descontado o custo do dinheiro no tempo (positivo = cria valor). ·
      <b>TIR, Taxa Interna de Retorno:</b> a rentabilidade anual da operação (compare com a TMA). ·
      <b>TMA, Taxa Mínima de Atratividade:</b> a rentabilidade mínima aceitável, a “régua” do projeto. ·
      <b>Payback:</b> em quantos meses o dinheiro investido retorna. ·
      <b>Múltiplo do capital:</b> quantas vezes o capital investido volta (ex.: 1,5× = ganho de 50%). ·
      <b>ROI / ROE:</b> retorno percentual sobre o investimento / sobre o capital próprio.
    </div>
  </div>
</div>`:''}

${sec.pos?`<div class="av"><h2>Posicionamento Estratégico</h2><pre>${sec.pos}</pre></div>`:''}

<h2>Detalhamento Financeiro Completo</h2>
<div class="av">
  <h3>Resumo de Caixa</h3>
  <div style="display:grid;grid-template-columns:${isUsoProprio?'repeat(2,1fr)':'repeat(3,1fr)'};gap:8px;margin-bottom:12px;">
    <div class="card" style="background:#fff7ed;">
      <div class="card-l" style="color:#c2410c;">1 · Disponível ao arrematar</div>
      <div class="card-v" style="color:#9a3412;">R$ ${fmt(m.desembolsoInicial)}</div>
      <div style="font-size:8px;color:#9a3412;">${isAVista?'lance + custos, à vista':`sinal (${fmtPct(d.sinalPercentual)}) + custos iniciais`}</div>
    </div>
    <div class="card" style="background:#eff6ff;">
      <div class="card-l" style="color:#1d4ed8;">2 · Custo mensal a suportar</div>
      <div class="card-v" style="color:#1e3a8a;">R$ ${fmt(m.parcelaMedia+m.carregoMensal)}/mês</div>
      <div style="font-size:8px;color:#1e3a8a;">${m.parcelaMedia>0?`parcela ~R$ ${fmt(m.parcelaMedia)}`:'sem parcela'}${m.carregoMensal>0?` + IPTU/cond. R$ ${fmt(m.carregoMensal)}`:''} · ${m.mesesCarregados} meses</div>
    </div>
    ${!isUsoProprio?`<div class="card" style="background:#fef2f2;">
      <div class="card-l" style="color:#b91c1c;">3 · Despesas ao vender</div>
      <div class="card-v" style="color:#991b1b;">R$ ${fmt(m.custoVenda)}</div>
      <div style="font-size:8px;color:#991b1b;">comissão 5% + IR ganho${m.saldoDevedor>0?' + quitação do saldo':''}</div>
    </div>`:''}
  </div>
  ${d.valorLocacao>0?(()=>{
    const custoMensal=m.parcelaMedia+m.carregoMensal;
    const cobertura=custoMensal>0?(m.aluguelMensal/custoMensal)*100:100;
    const liq=m.aluguelMensal-custoMensal;
    return `<div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:4px;padding:8px 10px;margin-bottom:12px;">
      <div style="font-size:9px;font-weight:800;color:#6d28d9;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;">Cenário alternativo · Locação (segurar e alugar)</div>
      <div style="font-size:10px;color:#5b21b6;">Aluguel R$ ${fmt(m.aluguelMensal)}/mês cobre <b>${fmtPct(cobertura,0)}</b> do custo mensal · resultado ${liq>=0?'+':'-'} R$ ${fmt(Math.abs(liq))}/mês · yield ${fmtPct(m.yieldAnual)}/ano. Na locação <b>não</b> incidem IR de ganho de capital nem comissão de venda — apenas IPTU/condomínio e eventual administração.</div>
    </div>`;})():''}
  <h3>A) Capital Mobilizado (Saídas)</h3>
  <table>
    <tr><th>Item</th><th class="c">% do Aporte</th><th class="r">Lance sem disputa</th><th class="r">Lance com disputa (R$ ${fmt(teto)})</th></tr>
    ${[
      ['Arrematação/Sinal', isAVista?m.vArremate:m.valorSinal, isAVista?mt.vArremate:mt.valorSinal],
      ['Honorários Jurídicos (10%)', m.honorarios, mt.honorarios],
      [`Taxa Leiloeiro (${fmtPct(d.taxaLeiloeiroPercentual)})`, m.taxaLeiloeiro, mt.taxaLeiloeiro],
      [`ITBI + Registro (${fmtPct(d.itbiPercentual)})`, m.itbiRegistro, mt.itbiRegistro],
      ...(d.laudemio>0?[['Laudêmio', m.laudemio, mt.laudemio]]:[]),
      ...(d.foreiro>0?[['Foreiro', m.foreiro, mt.foreiro]]:[]),
      ...(d.debitosAssumidos>0?[['Débitos Assumidos', m.debitos, mt.debitos]]:[]),
      ['Reforma / Retrofit', m.manutencao, mt.manutencao],
      ...(!isAVista&&m.parcelasPagas>0?[[`Parcelas Banco (projeção ${m.mesesCarregados} meses)`, m.parcelasPagas, mt.parcelasPagas]]:[]),
      [`Carrego IPTU/Cond. (${m.mesesCarregados} meses)`, m.custoCarrrego, mt.custoCarrrego],
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
    <tr><th>Item</th><th class="r">Lance sem disputa</th><th class="r">Lance com disputa</th></tr>
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
    ${d.valorLocacao>0?`<tr><td>Rentabilidade do Aluguel (Ref.)</td>
    <td class="r" style="color:#7c3aed;font-weight:700;">${fmtPct(m.yieldMensal)}/mês · ${fmtPct(m.yieldAnual)}/ano</td><td></td></tr>`:''}
  </table>
</div>

${sec.def?`<div class="av"><h2>Defesa da Arrematação</h2><pre>${sec.def}</pre></div>`:''}

${mercado?`<div class="av">
<h2>Avaliação Mercadológica</h2>
<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px;">
  ${[['Preço Médio/m²',`R$ ${fmt(mercado.precoMedioM2||0)}`,'#0D63DB'],
     ['Aluguel Médio',`R$ ${fmt(mercado.aluguelMedio||0)}/mês`,'#7c3aed'],
     ['Rentab. Bruta',fmtPct(mercado.yieldBruto||0),'#059669'],
     ['Rentab. Líquida',fmtPct(mercado.yieldLiquido||0),'#d97706']].map(([l,v,c])=>`
  <div class="card"><div class="card-l">${l}</div><div class="card-v" style="color:${c}">${v}</div></div>`).join('')}
</div>
${mercado.indiceBidPro && ((mercado.indiceBidPro.venda_m2||0)>0 || (mercado.indiceBidPro.aluguel_m2||0)>0)?`<div style="font-size:10px;color:#3730a3;margin:0 0 10px;background:#eef2ff;border:1px solid #c7d2fe;padding:8px 10px;border-radius:4px;"><b>Índice BidPro (nossa base própria, ${mercado.indiceBidPro.nivel==='bairro'?'bairro':mercado.indiceBidPro.nivel==='grid'?'microrregião':'cidade'} · ${mercado.indiceBidPro.n_amostras||0} amostras):</b> ${(mercado.indiceBidPro.venda_m2||0)>0?`venda R$ ${fmt(mercado.indiceBidPro.venda_m2)}/m²`:''}${(mercado.indiceBidPro.aluguel_m2||0)>0?` · locação R$ ${fmt(mercado.indiceBidPro.aluguel_m2)}/m²/mês`:''}. Referência independente da plataforma para venda e locação, complementar ao FipeZAP.</div>`:''}
${mercado.classificacaoIntencao && (mercado.classificacaoIntencao.revenda||mercado.classificacaoIntencao.locacao||mercado.classificacaoIntencao.temporada)?`<div style="margin:0 0 10px;padding:8px 10px;background:#eff6ff;border:1px solid #dbeafe;border-radius:4px;font-size:10px;color:#334155;line-height:1.5;"><b>Indicado para:</b> ${[mercado.classificacaoIntencao.revenda&&'Revenda',mercado.classificacaoIntencao.locacao&&'Locação',mercado.classificacaoIntencao.temporada&&'Temporada'].filter(Boolean).join(' · ')}.<br/>${[mercado.classificacaoIntencao.motivos?.revenda,mercado.classificacaoIntencao.motivos?.locacao,mercado.classificacaoIntencao.motivos?.temporada].filter(Boolean).join(' ')}</div>`:''}
${mercado.comentario?`<p style="font-size:10px;color:#475569;margin:0 0 10px;background:#f8fafc;padding:8px;border-radius:4px;">${mercado.comentario}</p>`:''}
${mercado.zoneamento?`<div style="font-size:10px;color:#334155;margin:0 0 10px;background:#f0f9ff;border:1px solid #dbeafe;padding:8px 10px;border-radius:4px;"><b>Zoneamento (uso do solo):</b> ${mercado.zoneamento.encontrado
  ? `${mercado.zoneamento.zona||'—'}${mercado.zoneamento.resumoUso?', '+mercado.zoneamento.resumoUso:''} <span style="color:#64748b">· fonte: ${mercado.zoneamento.fonte||'órgão oficial'}</span>`
  : `não localizado em fonte oficial. Onde confirmar: ${mercado.zoneamento.ondeObter||'Secretaria de Urbanismo/Planejamento da Prefeitura, pelo endereço ou inscrição imobiliária.'}`}</div>`:''}
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
<h2>Tabelas de Financiamento, SAC vs PRICE</h2>
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
`;
}

export function gerarPDF(props) {
  const d = (props && props.d) || {};
  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório BidPro Brasil, ${d.nome || d.endereco || ''}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>${ESTILOS_MERCADOLOGICO}</style></head><body>${corpoMercadologico(props)}</body></html>`;
  imprimirHtml(html, `Relatorio Mercadologico - ${(d.nome || d.endereco || 'Imovel')}`);
}
