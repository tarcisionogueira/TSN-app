import { fmt } from '../utils/calculos';

// Gera um relatório financeiro consolidado (todas as operações), agrupado por imóvel.
export function gerarPDFFinanceiro({ grupos, totalEntradas, totalSaidas }) {
  const win = window.open('', '_blank');
  if (!win) { alert('Permita pop-ups para gerar o PDF.'); return; }

  const saldo = totalEntradas - totalSaidas;
  const hoje = new Date().toLocaleDateString('pt-BR');

  const linhasGrupo = (g) => g.lancamentos.map((l, i) => `
    <tr style="background:${i % 2 === 0 ? 'white' : '#fafafa'}">
      <td>${l.data || '—'}</td>
      <td>${l.categoria || '—'}</td>
      <td>${l.descricao || '—'}</td>
      <td class="c"><span class="${l.tipo === 'entrada' ? 'g' : 'rd'}">${l.tipo === 'entrada' ? 'Entrada' : 'Saída'}</span></td>
      <td class="r ${l.tipo === 'entrada' ? 'g' : 'rd'}">${l.tipo === 'entrada' ? '+ ' : '− '}R$ ${fmt(Number(l.valor))}</td>
    </tr>`).join('');

  const secoes = grupos.map(g => {
    const ent = g.lancamentos.filter(l => l.tipo === 'entrada').reduce((s, l) => s + Number(l.valor), 0);
    const sai = g.lancamentos.filter(l => l.tipo === 'saida').reduce((s, l) => s + Number(l.valor), 0);
    const sld = ent - sai;
    return `
    <div class="av" style="margin-bottom:18px;">
      <h3>${g.nome}</h3>
      <table>
        <thead><tr><th>Data</th><th>Categoria</th><th>Descrição</th><th class="c">Tipo</th><th class="r">Valor</th></tr></thead>
        <tbody>
          ${linhasGrupo(g)}
          <tr style="background:#f1f5f9;font-weight:700;">
            <td colspan="4">Subtotal — Entradas R$ ${fmt(ent)} · Saídas R$ ${fmt(sai)}</td>
            <td class="r ${sld >= 0 ? 'g' : 'rd'}">Saldo R$ ${fmt(sld)}</td>
          </tr>
        </tbody>
      </table>
    </div>`;
  }).join('');

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Relatório Financeiro BidPro Brasil</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  body{font-family:'Inter',sans-serif;font-size:10.5px;color:#111111;padding:20px;line-height:1.5;background:white;margin:0;}
  @media print{body{padding:0;}@page{margin:8mm;size:A4;}.av{page-break-inside:avoid;}}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111111;padding-bottom:12px;margin-bottom:18px;}
  h2{font-size:12px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:18px 0 8px;}
  h3{font-size:11px;font-weight:800;margin:14px 0 6px;color:#111111;}
  table{width:100%;border-collapse:collapse;margin-bottom:10px;font-size:10px;}
  th,td{border:1px solid #cbd5e1;padding:5px 7px;}
  th{background:#f1f5f9;font-weight:700;text-align:left;}
  .r{text-align:right;}.c{text-align:center;}
  .g{color:#059669;font-weight:700;}.rd{color:#dc2626;font-weight:700;}
  .grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:16px;}
  .card{border-radius:6px;padding:12px 14px;text-align:center;border:1px solid #e2e8f0;}
  .card-v{font-size:20px;font-weight:900;margin-top:2px;}
  .card-l{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;}
</style></head><body>

<div class="hdr av">
  <div>
    <div style="font-size:22px;font-weight:900;text-transform:uppercase;margin-bottom:3px;">BidPro Brasil</div>
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:2px;">Relatório Financeiro de Operações</div>
  </div>
  <div style="text-align:right;font-size:9px;color:#64748b;">
    Emitido em ${hoje}<br>${grupos.length} imóvel(is)
  </div>
</div>

<div class="grid3">
  <div class="card" style="background:#f0fdf4;border-color:#bbf7d0;">
    <div class="card-l" style="color:#16a34a;">Entradas</div>
    <div class="card-v g">R$ ${fmt(totalEntradas)}</div>
  </div>
  <div class="card" style="background:#fef2f2;border-color:#fecaca;">
    <div class="card-l" style="color:#dc2626;">Saídas</div>
    <div class="card-v rd">R$ ${fmt(totalSaidas)}</div>
  </div>
  <div class="card" style="background:${saldo >= 0 ? '#f0fdf4' : '#fef2f2'};border-color:${saldo >= 0 ? '#bbf7d0' : '#fecaca'};">
    <div class="card-l" style="color:${saldo >= 0 ? '#16a34a' : '#dc2626'};">Saldo Geral</div>
    <div class="card-v ${saldo >= 0 ? 'g' : 'rd'}">R$ ${fmt(saldo)}</div>
  </div>
</div>

<h2>Detalhamento por Imóvel</h2>
${secoes || '<p style="color:#94a3b8;">Nenhum lançamento registrado.</p>'}

<div style="margin-top:24px;font-size:8px;color:#94a3b8;text-align:center;border-top:1px solid #e2e8f0;padding-top:8px;">
  BidPro Brasil · Relatório gerado automaticamente · Documento de controle interno
</div>

<script>window.onload=()=>{setTimeout(()=>window.print(),400);}</script>
</body></html>`;

  win.document.write(html);
  win.document.close();
}
