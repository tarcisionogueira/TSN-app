/**
 * api/_conciliacao-pacote.js — o PACOTE da contabilidade (relatório HTML + OFX), num lugar só.
 *
 * Saiu de api/conciliacao.js em 30/10 porque passou a ter dois clientes: o botão "Enviar à
 * contabilidade" da tela e o envio mensal automático (contabilidade-mensal-cron.js). Duas cópias do
 * gerador fariam o contador receber relatórios diferentes conforme quem enviou.
 */
import { escapeHtml } from './_sanitize.js';

export const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
// A contabilidade tem vários e-mails (30/10): CONTABILIDADE_EMAIL e o campo da tela aceitam uma lista
// separada por vírgula, ponto e vírgula ou espaço. Um endereço inválido no meio NÃO é descartado calado:
// volta em `invalidos` para quem chamou recusar o envio inteiro e dizer qual está errado.
export function listaEmails(texto) {
  const itens = String(texto || '').split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean);
  const ok = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
  return { validos: [...new Set(itens.filter(ok).map((e) => e.toLowerCase()))], invalidos: itens.filter((e) => !ok(e)) };
}

export const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

// ── OFX 1.0 (SGML) ───────────────────────────────────────────────────────────────────────────
// Formato deliberadamente antigo: é o que os sistemas contábeis brasileiros importam. Datas em
// YYYYMMDD, valores com ponto decimal e sinal (saída negativa), <MEMO> com a conta contábil já
// atribuída — assim o contador recebe o de/para junto do lançamento, não em planilha à parte.
export function gerarOFX(lancamentos, { de, ate, banco }) {
  const dt = (d) => String(d || '').replace(/-/g, '');
  const agora = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  const linhas = lancamentos.map((l) => {
    const valor = (l.direcao === 'saida' ? -1 : 1) * Number(l.valor_liquido ?? l.valor_bruto ?? 0);
    const memo = [l.conta, l.descricao].filter(Boolean).join(' — ').slice(0, 250);
    return `<STMTTRN>
<TRNTYPE>${l.direcao === 'saida' ? 'DEBIT' : 'CREDIT'}
<DTPOSTED>${dt(l.data)}
<TRNAMT>${valor.toFixed(2)}
<FITID>${String(l.banco).replace(/\W/g, '')}-${String(l.chave_origem).replace(/\W/g, '')}
<MEMO>${memo.replace(/[<>&]/g, ' ')}
</STMTTRN>`;
  }).join('\n');
  const saldo = lancamentos.reduce((s, l) => s + (l.direcao === 'saida' ? -1 : 1) * Number(l.valor_liquido ?? l.valor_bruto ?? 0), 0);
  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<SIGNONMSGSRSV1><SONRS><STATUS><CODE>0<SEVERITY>INFO</STATUS>
<DTSERVER>${agora}<LANGUAGE>POR</SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><TRNUID>1<STATUS><CODE>0<SEVERITY>INFO</STATUS>
<STMTRS><CURDEF>BRL
<BANKACCTFROM><BANKID>0000<ACCTID>${String(banco || 'CONSOLIDADO').replace(/\W/g, '').slice(0, 20)}<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST><DTSTART>${dt(de)}<DTEND>${dt(ate)}
${linhas}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>${saldo.toFixed(2)}<DTASOF>${agora}</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
}

// ── Relatório em HTML (vira PDF na impressão do navegador / anexo do e-mail) ─────────────────
// Não usamos gerador de PDF no servidor de propósito: o HTML imprime igual, viaja no corpo do
// e-mail sem anexo pesado, e a contabilidade consegue copiar os números — de um PDF de imagem,
// não conseguiria.
// `extras` (30/10): blocos HTML já prontos que o envio mensal acrescenta (comissões e notas de
// parceiros). Quem monta é responsável por escapar o conteúdo.
export function gerarHTML({ de, ate, dre, lancamentos, resumo, extras = '' }) {
  const grupos = {};
  for (const l of dre) {
    grupos[l.grupo_dre] = grupos[l.grupo_dre] || { nome: l.grupo_dre, natureza: l.natureza, linhas: [], total: 0 };
    grupos[l.grupo_dre].linhas.push(l);
    grupos[l.grupo_dre].total += Number(l.total || 0);
  }
  const linhasDRE = Object.values(grupos).map(g => `
    <tr style="background:#f8fafc"><td colspan="2" style="padding:8px;font-weight:700">${escapeHtml(g.nome)}</td>
      <td style="padding:8px;text-align:right;font-weight:700">${brl(g.total)}</td></tr>
    ${g.linhas.map(l => `<tr><td style="padding:6px 8px 6px 24px;color:#475569">${escapeHtml(l.conta)}</td>
      <td style="padding:6px 8px;color:#475569">${escapeHtml(l.nome)} <span style="color:#94a3b8">(${l.qtd})</span></td>
      <td style="padding:6px 8px;text-align:right">${brl(l.total)}</td></tr>`).join('')}`).join('');

  const linhasExtrato = lancamentos.map(l => `<tr>
    <td style="padding:5px 8px;white-space:nowrap">${dataBR(l.data)}</td>
    <td style="padding:5px 8px">${escapeHtml(l.banco)}</td>
    <td style="padding:5px 8px">${escapeHtml(String(l.descricao || '').slice(0, 70))}</td>
    <td style="padding:5px 8px;white-space:nowrap">${escapeHtml(l.conta || '—')}</td>
    <td style="padding:5px 8px;text-align:right;color:${l.direcao === 'saida' ? '#dc2626' : '#059669'}">${l.direcao === 'saida' ? '−' : '+'} ${brl(l.valor_liquido ?? l.valor_bruto)}</td>
  </tr>`).join('');

  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Conciliação ${escapeHtml(de)} a ${escapeHtml(ate)} — BidPro Brasil</title></head>
<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#111;max-width:900px;margin:0 auto;padding:24px">
  <h1 style="font-size:20px;margin:0 0 4px">Conciliação bancária e DRE</h1>
  <p style="color:#64748b;font-size:13px;margin:0 0 20px">Competência ${escapeHtml(de)} a ${escapeHtml(ate)} · BidPro Brasil (Nogueira) · gerado em ${new Date().toLocaleString('pt-BR')}</p>

  <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px">
    <strong>Entradas:</strong> ${brl(resumo.entradas)} &nbsp;·&nbsp;
    <strong>Saídas:</strong> ${brl(resumo.saidas)} &nbsp;·&nbsp;
    <strong>Resultado:</strong> ${brl(resumo.entradas - resumo.saidas)} &nbsp;·&nbsp;
    ${resumo.pendentes} lançamento(s) em <strong>9.9 A CLASSIFICAR</strong>
  </div>

  <h2 style="font-size:15px;margin:0 0 8px">Demonstrativo por conta</h2>
  <table style="width:100%;border-collapse:collapse;font-size:12.5;border:1px solid #e2e8f0">
    <thead><tr style="background:#111;color:#fff"><th style="padding:8px;text-align:left">Conta</th><th style="padding:8px;text-align:left">Descrição</th><th style="padding:8px;text-align:right">Valor</th></tr></thead>
    <tbody>${linhasDRE}</tbody>
  </table>

  <h2 style="font-size:15px;margin:24px 0 8px">Extrato classificado (${lancamentos.length})</h2>
  <table style="width:100%;border-collapse:collapse;font-size:11.5px;border:1px solid #e2e8f0">
    <thead><tr style="background:#111;color:#fff"><th style="padding:6px 8px;text-align:left">Data</th><th style="padding:6px 8px;text-align:left">Conta bancária</th><th style="padding:6px 8px;text-align:left">Histórico</th><th style="padding:6px 8px;text-align:left">Conta contábil</th><th style="padding:6px 8px;text-align:right">Valor</th></tr></thead>
    <tbody>${linhasExtrato}</tbody>
  </table>
${extras}
  <p style="color:#94a3b8;font-size:11px;margin-top:20px;line-height:1.6">
    Cobertura: Banco Inter (API PJ), Mercado Pago, Asaas e mídia paga (Meta Ads e Google Ads), lidos
    automaticamente todo dia. Contas em outros bancos (C6, Bradesco, Caixa) não estão integradas — este
    demonstrativo não representa a posição dessas contas. Emissão de NFS-e própria ainda não integrada.
  </p>
</body></html>`;
}
