/**
 * /api/conciliacao — importar, classificar, conciliar e EXPORTAR para a contabilidade.
 *
 * PEDIDO DO DONO (08/08): conciliação bancária classificada por plano de contas, exportável em
 * PDF e OFX, enviada por e-mail à contabilidade, para ela fechar a DRE.
 *
 * A ORDEM DAS PEÇAS, e por que ela é assim:
 *   1. IMPORTAR   — traz o extrato das contas e PERSISTE em `conciliacao_lancamento`. Persistir
 *                   é o ponto central: a contabilidade fecha competências passadas, e um número
 *                   que muda a cada consulta faz a DRE de março mudar depois de entregue.
 *                   Idempotente por (banco, chave_origem) — reimportar não duplica.
 *   2. CLASSIFICAR— aplica o de/para (`conciliacao_regra`). O que nenhuma regra pega vai para
 *                   9.9 A CLASSIFICAR, visível: conta chutada é pior que conta vazia.
 *   3. CONCILIAR  — a pessoa confirma ou corrige a conta. Correção manual NUNCA é desfeita por
 *                   regra criada depois, e pode virar regra nova ('aprendida').
 *   4. EXPORTAR   — PDF (DRE + extrato classificado) e OFX (extrato para o sistema contábil),
 *                   por download ou e-mail.
 *
 * SOBRE O OFX: é o formato que todo sistema contábil importa. Geramos OFX 1.0 (SGML), que é o
 * que os ERPs brasileiros esperam — o 2.0 (XML) é recusado por vários.
 *
 * Emissão fiscal (Webis) ainda não integrada — por decisão do dono, entra quando a movimentação
 * justificar. Nada aqui depende dela.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit } from './_rate-limit.js';
import { enviarEmail } from './_email.js';
import { escapeHtml } from './_sanitize.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
const brl = (v) => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const dataBR = (d) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');

// ── OFX 1.0 (SGML) ───────────────────────────────────────────────────────────────────────────
// Formato deliberadamente antigo: é o que os sistemas contábeis brasileiros importam. Datas em
// YYYYMMDD, valores com ponto decimal e sinal (saída negativa), <MEMO> com a conta contábil já
// atribuída — assim o contador recebe o de/para junto do lançamento, não em planilha à parte.
function gerarOFX(lancamentos, { de, ate, banco }) {
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
function gerarHTML({ de, ate, dre, lancamentos, resumo }) {
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

  <p style="color:#94a3b8;font-size:11px;margin-top:20px;line-height:1.6">
    Cobertura: contas Asaas e Mercado Pago. Contas bancárias (Inter, C6, Bradesco, Caixa) ainda não
    integradas — este demonstrativo não representa a posição consolidada da empresa enquanto elas
    não entrarem. Emissão fiscal não integrada nesta etapa.
  </p>
</body></html>`;
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (await getUserRoleById(user.id) !== 'admin') { res.status(403).json({ error: 'Acesso restrito a administradores' }); return; }

  const url = new URL(req.url, 'http://localhost');
  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { body = {}; }
  const acao = String(body.acao || url.searchParams.get('acao') || 'listar');

  const rl = await checkRateLimit(`conciliacao:${user.id}`, 40, 5 * 60_000);
  if (!rl.ok) { res.status(429).json({ error: 'Muitas operações. Aguarde alguns minutos.' }); return; }

  const hoje = new Date().toISOString().slice(0, 7);
  const de  = String(body.de  || url.searchParams.get('de')  || hoje);
  const ate = String(body.ate || url.searchParams.get('ate') || hoje);

  // ── IMPORTAR: lê o extrato e persiste (idempotente) ───────────────────────────────────────
  if (acao === 'importar') {
    const dias = Math.min(365, Math.max(7, Number(body.dias) || 120));
    const auth = req.headers?.authorization || req.headers?.Authorization || '';
    const r = await fetch(`${BASE}/api/financeiro-extrato?dias=${dias}`, { headers: { Authorization: auth } });
    if (!r.ok) {
      const det = await r.text().catch(() => '');
      console.error('[conciliacao] extrato', r.status, det.slice(0, 200));
      res.status(502).json({ error: 'Não consegui ler o extrato das contas agora.' });
      return;
    }
    const ext = await r.json();
    const linhas = (ext.lancamentos || []).map(l => ({
      banco: l.banco, chave_origem: l.id, data: l.data, descricao: l.descricao || '',
      direcao: l.direcao, valor_bruto: l.bruto, valor_liquido: l.liquido, taxa: l.taxa,
      metodo: l.metodo, classificado_por: 'pendente',
    })).filter(l => l.data && l.chave_origem);
    if (linhas.length) {
      const up = await sb('conciliacao_lancamento?on_conflict=banco,chave_origem', {
        method: 'POST',
        headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
        body: JSON.stringify(linhas),
      });
      if (!up.ok) {
        const det = await up.text().catch(() => '');
        console.error('[conciliacao] upsert', up.status, det.slice(0, 300));
        res.status(502).json({ error: 'Falha ao gravar os lançamentos.' }); return;
      }
    }
    const cl = await sb('rpc/conciliacao_classificar', { method: 'POST', body: JSON.stringify({ p_competencia: null }) });
    const classificados = cl.ok ? await cl.json().catch(() => 0) : 0;
    res.status(200).json({ ok: true, importados: linhas.length, classificados, cobertura: ext.cobertura, avisos: ext.avisos });
    return;
  }

  // ── CLASSIFICAR novamente (depois de criar/alterar regra) ─────────────────────────────────
  if (acao === 'classificar') {
    const cl = await sb('rpc/conciliacao_classificar', { method: 'POST', body: JSON.stringify({ p_competencia: body.competencia || null }) });
    if (!cl.ok) { res.status(502).json({ error: 'Falha ao classificar.' }); return; }
    res.status(200).json({ ok: true, classificados: await cl.json().catch(() => 0) });
    return;
  }

  // ── CONCILIAR: confirma ou corrige a conta de um lançamento ───────────────────────────────
  if (acao === 'conciliar') {
    const id = String(body.id || '');
    if (!id) { res.status(400).json({ error: 'id obrigatório' }); return; }
    const patch = { conciliado: true, conciliado_em: new Date().toISOString(), conciliado_por: user.id };
    if (body.conta) { patch.conta = String(body.conta); patch.classificado_por = 'manual'; }
    if (body.observacao != null) patch.observacao = String(body.observacao).slice(0, 400);
    const up = await sb(`conciliacao_lancamento?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch),
    });
    if (!up.ok) { res.status(502).json({ error: 'Falha ao conciliar.' }); return; }
    const [linha] = await up.json().catch(() => []);
    // A correção vira REGRA quando pedido: é como o de/para aprende em vez de exigir manutenção.
    if (body.virar_regra && body.conta && linha?.descricao) {
      const padrao = String(linha.descricao).trim().slice(0, 60).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      await sb('conciliacao_regra', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ padrao, direcao: linha.direcao, conta: body.conta, prioridade: 950, origem: 'aprendida', criado_por: user.id }),
      }).catch(() => {});
    }
    res.status(200).json({ ok: true, lancamento: linha || null });
    return;
  }

  // ── Dados comuns às leituras/exportações ──────────────────────────────────────────────────
  const banco = String(body.banco || url.searchParams.get('banco') || '').trim();
  const filtroBanco = banco && banco !== 'todos' ? `&banco=eq.${encodeURIComponent(banco)}` : '';
  const lancamentos = await (await sb(
    `conciliacao_lancamento?competencia=gte.${de}&competencia=lte.${ate}${filtroBanco}&select=*&order=data.desc&limit=2000`
  )).json().catch(() => []);
  const resumo = {
    entradas: lancamentos.filter(l => l.direcao === 'entrada').reduce((s, l) => s + Number(l.valor_liquido ?? l.valor_bruto ?? 0), 0),
    saidas:   lancamentos.filter(l => l.direcao === 'saida').reduce((s, l) => s + Number(l.valor_liquido ?? l.valor_bruto ?? 0), 0),
    pendentes: lancamentos.filter(l => l.conta === '9.9' || l.classificado_por === 'pendente').length,
    conciliados: lancamentos.filter(l => l.conciliado).length,
    total: lancamentos.length,
  };

  if (acao === 'listar') {
    const [contas, dreR] = await Promise.all([
      (await sb('plano_contas?ativo=eq.true&select=codigo,nome,natureza,grupo_dre,ordem&order=ordem')).json().catch(() => []),
      sb('rpc/dre_competencia', { method: 'POST', body: JSON.stringify({ p_de: de, p_ate: ate }) }),
    ]);
    res.status(200).json({
      ok: true, periodo: { de, ate }, resumo,
      plano_contas: contas, dre: dreR.ok ? await dreR.json().catch(() => []) : [],
      lancamentos: lancamentos.slice(0, 500),
    });
    return;
  }

  if (acao === 'ofx') {
    const ofx = gerarOFX(lancamentos, { de, ate, banco });
    res.setHeader('Content-Type', 'application/x-ofx; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="conciliacao-${de}-a-${ate}.ofx"`);
    res.status(200).send(ofx);
    return;
  }

  if (acao === 'pdf' || acao === 'html') {
    const dreR = await sb('rpc/dre_competencia', { method: 'POST', body: JSON.stringify({ p_de: de, p_ate: ate }) });
    const html = gerarHTML({ de, ate, dre: dreR.ok ? await dreR.json().catch(() => []) : [], lancamentos, resumo });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(html);
    return;
  }

  // ── ENVIAR À CONTABILIDADE ────────────────────────────────────────────────────────────────
  if (acao === 'enviar') {
    const destino = String(body.email || process.env.CONTABILIDADE_EMAIL || '').trim();
    if (!destino || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destino)) {
      res.status(400).json({ error: 'Informe o e-mail da contabilidade (ou configure CONTABILIDADE_EMAIL).' });
      return;
    }
    if (!lancamentos.length) { res.status(400).json({ error: 'Não há lançamentos no período — importe o extrato antes de enviar.' }); return; }
    const dreR = await sb('rpc/dre_competencia', { method: 'POST', body: JSON.stringify({ p_de: de, p_ate: ate }) });
    const html = gerarHTML({ de, ate, dre: dreR.ok ? await dreR.json().catch(() => []) : [], lancamentos, resumo });
    const ofx = gerarOFX(lancamentos, { de, ate, banco });
    const env = await enviarEmail({
      to: destino,
      subject: `Conciliação e DRE — ${de} a ${ate} — BidPro Brasil`,
      html,
      attachments: [{ filename: `conciliacao-${de}-a-${ate}.ofx`, content: Buffer.from(ofx, 'utf8').toString('base64') }],
    });
    // Sem checar o retorno, um envio que falhou vira "enviado ✓" na tela e a contabilidade fica
    // esperando um e-mail que nunca chegou — no fechamento, isso custa prazo.
    if (env === false || env?.ok === false) {
      res.status(502).json({ error: 'Não consegui enviar o e-mail agora. Baixe o PDF/OFX e reenvie, ou tente de novo.' });
      return;
    }
    res.status(200).json({ ok: true, destino, lancamentos: lancamentos.length, pendentes: resumo.pendentes });
    return;
  }

  res.status(400).json({ error: 'Ação desconhecida' });
}
