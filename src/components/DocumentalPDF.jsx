// PDF da ANÁLISE DOCUMENTAL E JURÍDICA (2º documento). Consolida o parecer do
// advogado-IA (situação registrária, ônus/gravames, ocupação, débitos, processo),
// o BidScore, o nível de risco, a evolução das consultas (CNJ/CNDT/CNIB/CENPROT/
// certidões) e as lacunas. Espelha a mecânica de impressão do LaudoPDF (iframe
// oculto → diálogo do navegador → "Salvar como PDF"), sem depender de pop-up.

const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const dataBR = (s) => { const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : (s || ''); };

const OCUP = {
  desocupado: 'Desocupado', proprietario: 'Ocupado pelo proprietário/devedor',
  locatario: 'Ocupado por locatário', posseiro: 'Ocupado por posseiro',
  comodato: 'Ocupado em comodato', invasao: 'Invasão', nao_consta: 'Não consta',
};

export function gerarDocumentalPDF({ imovel: d = {}, parecer: P = {}, bidscore: sb = null }) {
  const risco = P.nivelRisco || 'amarelo';
  const R = {
    verde:    { txt: 'RISCO BAIXO',   cor: '#065f46', bg: '#d1fae5', bd: '#10b981' },
    amarelo:  { txt: 'RISCO MÉDIO',   cor: '#92400e', bg: '#fef3c7', bd: '#f59e0b' },
    vermelho: { txt: 'RISCO ALTO',    cor: '#b91c1c', bg: '#fee2e2', bd: '#ef4444' },
  }[risco] || { txt: 'RISCO MÉDIO', cor: '#92400e', bg: '#fef3c7', bd: '#f59e0b' };

  const corCamada = (n) => n >= 7 ? '#16a34a' : n >= 4 ? '#b45309' : '#dc2626';

  // BidScore (nota 0–10 + camadas)
  const bidscoreHtml = sb ? `
<div class="av" style="border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:14px 16px;margin-bottom:14px;">
  <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
    <div style="width:46px;height:46px;border-radius:11px;background:${sb.cor};color:white;font-weight:900;font-size:19px;display:flex;align-items:center;justify-content:center;flex-shrink:0;">${sb.nota.toFixed(1)}</div>
    <div>
      <div style="font-size:13px;font-weight:900;color:#111;">BidScore</div>
      <div style="font-size:10.5px;color:#64748b;">Potencial de oportunidade (0 a 10)</div>
    </div>
  </div>
  ${(sb.camadas || []).map(c => `
    <div style="display:flex;align-items:center;gap:8px;margin:4px 0;">
      <div style="width:82px;font-size:10.5px;font-weight:700;color:#475569;">${esc(c.label)}</div>
      <div style="flex:1;height:7px;background:#e2e8f0;border-radius:20px;overflow:hidden;"><div style="width:${c.nota * 10}%;height:100%;background:${corCamada(c.nota)};border-radius:20px;"></div></div>
      <div style="width:60px;text-align:right;font-size:10.5px;color:#64748b;">${c.nota.toFixed(1)} ·${c.peso}%</div>
    </div>`).join('')}
</div>` : '';

  // Pontos de atenção
  const pa = P.pontosAtencao || {};
  const paHtml = (pa.total > 0) ? `
<div class="av" style="margin-bottom:12px;font-size:12px;color:#334155;">
  <strong>⚠ ${pa.total} ponto${pa.total > 1 ? 's' : ''} de atenção</strong>
  ${pa.altos > 0 ? ` · <span style="color:#b91c1c;font-weight:700;">${pa.altos} alta${pa.altos > 1 ? 's' : ''}</span>` : ''}
  ${pa.medios > 0 ? ` · <span style="color:#b45309;font-weight:700;">${pa.medios} média${pa.medios > 1 ? 's' : ''}</span>` : ''}
</div>` : '';

  // Evolução das consultas (checklist)
  const checklistHtml = (Array.isArray(P.checklist) && P.checklist.length) ? `
<div class="av" style="border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:14px 16px;margin:12px 0;">
  <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#475569;margin-bottom:10px;">Evolução das consultas</div>
  ${P.checklist.map(c => {
    const cor = c.status === 'feito' ? '#16a34a' : c.status === 'pendente' ? '#b45309' : '#94a3b8';
    const ic = c.status === 'feito' ? '✓' : c.status === 'pendente' ? '•' : '—';
    return `<div style="display:flex;gap:9px;align-items:flex-start;margin-bottom:7px;">
      <span style="color:${cor};font-weight:900;width:12px;flex-shrink:0;">${ic}</span>
      <div><div style="font-size:11.5px;font-weight:700;color:#111;">${esc(c.label)}</div>
      <div style="font-size:11px;color:#64748b;line-height:1.5;">${esc(c.detalhe)}</div></div>
    </div>`;
  }).join('')}
</div>` : '';

  // Raio-X (condensado)
  const rx = P.raioX || {};
  const oc = rx.ocupacaoDetalhe || {}, fr = rx.fraudeExecucao || {}, db = rx.debitos || {}, cr = rx.cronogramaLeilao || {};
  const cad = (rx.cadeiaDominial || []).filter(a => a && (a.parte || a.evento));
  const cert = (rx.certidoesRecomendadas || []).filter(c => c && c.nome);
  const cron = [cr.primeiraPraca && `1ª praça: ${dataBR(cr.primeiraPraca)}`, cr.segundaPraca && `2ª praça: ${dataBR(cr.segundaPraca)}`, cr.prazoPagamento && `Pagamento: ${cr.prazoPagamento}`, cr.prazoEmbargos && `Embargos: ${cr.prazoEmbargos}`].filter(Boolean);
  const rxLinhas = [];
  if (fr.risco && fr.risco !== 'nenhum') rxLinhas.push(`<b>Fraude à execução:</b> ${esc(fr.risco)}${fr.motivo ? ` — ${esc(fr.motivo)}` : ''}`);
  if (oc.tipo && oc.tipo !== 'nao_consta') rxLinhas.push(`<b>Ocupação:</b> ${esc(OCUP[oc.tipo] || oc.tipo)}${oc.prazoMeses ? ` · desocupação ~${oc.prazoMeses} mês(es)` : ''}${oc.custoEstimado ? ` · custo est. ${brl(oc.custoEstimado)}` : ''}`);
  if (db.totalAssumidoArrematante > 0) rxLinhas.push(`<b>Débitos que você assume (propter rem):</b> ${brl(db.totalAssumidoArrematante)}`);
  else if (db.aLevantar) rxLinhas.push(`<b>Débitos propter rem:</b> a levantar (IPTU/condomínio)`);
  if (cron.length) rxLinhas.push(`<b>Cronograma:</b> ${cron.map(esc).join(' · ')}`);
  const raioXHtml = (rxLinhas.length || cad.length || cert.length) ? `
<div class="av" style="border:1px solid #e2e8f0;border-radius:10px;background:#f8fafc;padding:14px 16px;margin:12px 0;">
  <div style="font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#1e3a8a;margin-bottom:8px;">Raio-X jurídico</div>
  ${rxLinhas.map(l => `<div style="font-size:11.5px;color:#334155;line-height:1.6;margin-bottom:3px;">${l}</div>`).join('')}
  ${cad.length ? `<div style="font-size:11px;color:#334155;margin-top:8px;"><b>Cadeia dominial (${cad.length}):</b><br/>${cad.slice(0, 10).map(a => `${esc(a.ato || '—')}${a.data ? ' · ' + dataBR(a.data) : ''}: ${esc([a.evento, a.parte].filter(Boolean).join(' — '))}`).join('<br/>')}</div>` : ''}
  ${cert.length ? `<div style="font-size:11px;color:#334155;margin-top:8px;"><b>Certidões recomendadas:</b> ${cert.map(c => esc(c.nome)).join(', ')}</div>` : ''}
</div>` : '';

  // Parecer (split por § SEÇÃO)
  const parecerHtml = (() => {
    const txt = String(P.parecer || '').trim();
    if (!txt) return '';
    const partes = txt.split(/§\s*SEÇÃO:/i).map(s => s.trim()).filter(Boolean);
    const secoes = partes.map(p => {
      const nl = p.indexOf('\n');
      const titulo = nl < 0 ? p : p.slice(0, nl);
      const corpo = nl < 0 ? '' : p.slice(nl);
      return `<div class="sec av"><h3>${esc(titulo.trim())}</h3>${corpo.trim() ? `<pre>${esc(corpo.trim())}</pre>` : ''}</div>`;
    }).join('');
    return `<h2>Parecer</h2>${secoes}`;
  })();

  // Lacunas
  const lac = Array.isArray(P.lacunas) ? P.lacunas.filter(Boolean) : [];
  const lacunasHtml = lac.length ? `
<div class="av" style="border:1px solid #fde68a;background:#fffbeb;border-radius:8px;padding:12px 14px;margin-top:12px;">
  <div style="font-size:11px;font-weight:900;text-transform:uppercase;color:#92400e;margin-bottom:6px;">Dados a confirmar (não constam na documentação)</div>
  <ul style="margin:0;padding-left:18px;">${lac.map(l => `<li style="color:#92400e;">${esc(l)}</li>`).join('')}</ul>
</div>` : '';

  const local = [d.cidade, d.estado].filter(Boolean).join('/');
  const geradoEm = (() => { try { return new Date(P.geradoEm || Date.now()).toLocaleDateString('pt-BR'); } catch { return new Date().toLocaleDateString('pt-BR'); } })();

  const html = `<!DOCTYPE html><html lang="pt-BR"><head>
<meta charset="UTF-8">
<title>Analise Documental BidPro Brasil, ${esc(d.nome || d.endereco || 'Imóvel')}</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap" rel="stylesheet">
<style>
  body{font-family:'Inter',sans-serif;font-size:12px;color:#0f172a;padding:22px;line-height:1.65;background:white;margin:0;-webkit-font-smoothing:antialiased;}
  @media print{body{padding:0;}@page{margin:9mm;size:A4;}.av{page-break-inside:avoid;}}
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #111111;padding-bottom:12px;margin-bottom:16px;}
  h2{font-size:13px;font-weight:900;text-transform:uppercase;border-bottom:2px solid #e2e8f0;padding-bottom:4px;margin:20px 0 8px;}
  h3{font-size:11.5px;font-weight:900;text-transform:uppercase;letter-spacing:0.5px;color:#111827;margin:12px 0 4px;}
  pre{white-space:pre-wrap;font-family:'Inter',sans-serif;font-size:12px;margin:0;line-height:1.75;color:#1e293b;}
  ul{margin:4px 0 0;padding-left:18px;} li{font-size:11.5px;color:#1e293b;line-height:1.65;margin-bottom:3px;}
  .sec{margin-bottom:10px;}
  .foot{margin-top:22px;padding-top:10px;border-top:1px solid #e2e8f0;font-size:9.5px;color:#94a3b8;line-height:1.55;}
</style></head><body>

<div class="hdr av">
  <div>
    <div style="font-size:22px;font-weight:900;text-transform:uppercase;margin-bottom:3px;">BidPro Brasil</div>
    <div style="font-size:8px;color:#64748b;text-transform:uppercase;letter-spacing:2px;margin-bottom:8px;">Aquisição em Leilão &amp; Investimentos Estratégicos</div>
    <div style="font-size:13px;font-weight:900;margin-bottom:3px;">ANÁLISE DOCUMENTAL E JURÍDICA</div>
    <div style="font-size:11px;color:#475569;">${esc((d.tipo || '').toUpperCase())}${d.endereco ? ', ' + esc(d.endereco) : ''}${local ? ' · ' + esc(local) : ''}</div>
  </div>
  <div style="text-align:right;flex-shrink:0;">
    <div style="font-size:10px;font-weight:700;margin-bottom:3px;">Data: ${geradoEm}</div>
    <div style="font-size:9px;color:#64748b;">Documento 2 de 3</div>
    <div style="font-size:9px;color:#64748b;">Leitura de documentos + processo</div>
  </div>
</div>

<div class="av" style="border:2px solid ${R.bd};background:${R.bg};border-radius:8px;padding:12px 16px;text-align:center;margin-bottom:14px;">
  <div style="font-size:15px;font-weight:900;color:${R.cor};">${R.txt}</div>
</div>

${bidscoreHtml}
${paHtml}
${checklistHtml}
${raioXHtml}
${parecerHtml}
${lacunasHtml}

<div class="foot av">
  Esta análise documental e processual é gerada com apoio de inteligência artificial, a partir dos documentos disponíveis e de consultas públicas. Pode conter imprecisões e não substitui a análise de um profissional nem a verificação presencial. Recomendamos agendar a reunião com um analista BidPro e, uma vez aprovado, o laudo jurídico definitivo por advogado antes de qualquer lance.
  <div style="margin-top:4px;">BidPro Brasil · Documento gerado em ${geradoEm}.</div>
</div>

</body></html>`;

  const nomeArquivo = `Analise Documental - ${(d.nome || d.endereco || 'Imovel')}`.replace(/[\\/:*?"<>|]+/g, ' ').trim();
  const tituloAnterior = document.title;
  const iframe = document.createElement('iframe');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(iframe);
  const limpar = () => { document.title = tituloAnterior; setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 1000); };
  try {
    const doc = iframe.contentWindow.document;
    doc.open(); doc.write(html); doc.close();
    const imprimir = () => {
      try {
        document.title = nomeArquivo;
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch {
        const win = window.open('', '_blank');
        if (win) { win.document.write(html); win.document.close(); win.focus(); setTimeout(() => win.print(), 600); }
        else alert('Não foi possível abrir a impressão. Verifique o bloqueador de pop-ups.');
      } finally { limpar(); }
    };
    setTimeout(imprimir, 500);
  } catch {
    limpar();
    alert('Não foi possível gerar o PDF neste navegador.');
  }
}
