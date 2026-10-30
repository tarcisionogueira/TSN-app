/**
 * /api/contabilidade-mensal-cron — o pacote do mês vai para o contador SOZINHO.
 *
 * PEDIDO DO DONO (30/10): "com as integrações conseguiríamos fornecer essas informações ao contador
 * automaticamente?" Os extratos já entravam sozinhos todo dia (conciliacao-sync-cron) e a tela já
 * tinha "Enviar à contabilidade" — só faltava ninguém precisar lembrar de apertar o botão.
 *
 * CALENDÁRIO (vercel.json: 12h UTC = 09h de Brasília, dias 1 a 5):
 *   dia 1  → LEMBRETE ao dono: resumo do mês anterior e quantos lançamentos ainda estão em
 *            9.9 A CLASSIFICAR — dois dias para arrumar antes de o pacote sair.
 *   dia 3+ → ENVIO do pacote (relatório + OFX + comissões e notas de parceiros) ao CONTABILIDADE_EMAIL,
 *            com cópia ao dono. Dias 4 e 5 são só nova tentativa: um envio registrado não repete.
 *
 * Dedup pelo carimbo `contabilidade_envio_AAAA-MM` em sistema_heartbeat. Se NÃO conseguir ler o
 * carimbo, não envia (mandar duas vezes ao contador é pior do que atrasar um dia) e alerta.
 * Sem CONTABILIDADE_EMAIL o pacote vai SÓ ao dono, dizendo que o contador não recebeu — nunca
 * "enviado" sem destino.
 *
 * Teste manual (com x-cron-secret): ?acao=lembrete|envio&competencia=AAAA-MM&so_dono=1
 * — `so_dono=1` manda o pacote só ao dono e não grava o carimbo (não conta como entregue).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';
import { escapeHtml } from './_sanitize.js';
import { alertarErro } from './_error-alert.js';
import { gerarOFX, gerarHTML, brl, dataBR } from './_conciliacao-pacote.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const DONO = process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br';
const DIA_ENVIO = 3;

const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

// Lê e LANÇA se não conseguiu: aqui "não consegui ler" virar lista vazia mandaria ao contador um mês
// zerado com cara de mês sem movimento (forma nº 2 do CLAUDE.md).
async function ler(path, opts) {
  const r = await sb(path, opts);
  if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`);
  return r.json();
}

function competenciaAnterior() {
  const brt = new Date(Date.now() - 3 * 3600e3);
  const d = new Date(Date.UTC(brt.getUTCFullYear(), brt.getUTCMonth() - 1, 1));
  return { comp: d.toISOString().slice(0, 7), dia: brt.getUTCDate() };
}

const nomeMes = (comp) => new Date(`${comp}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });

async function montarPacote(comp) {
  const [ano, mes] = comp.split('-').map(Number);
  const iniMes = `${comp}-01`;
  const iniProx = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10);
  const lancamentos = await ler(`conciliacao_lancamento?competencia=eq.${comp}&select=*&order=data.desc&limit=2000`);
  const dre = await ler('rpc/dre_competencia', { method: 'POST', body: JSON.stringify({ p_de: comp, p_ate: comp }) });
  const comissoes = await ler(`comissoes?status=eq.pago&pago_em=gte.${iniMes}&pago_em=lt.${iniProx}&select=tipo,origem,valor_comissao,pago_em&order=pago_em`);
  const notas = await ler(`saque_nf?status=eq.aprovada&revisado_em=gte.${iniMes}&revisado_em=lt.${iniProx}&select=numero,emitente_cnpj,valor_nf,emitida_em,verificacao_url,verificacao_status&order=revisado_em`);

  const soma = (dir) => lancamentos.filter(l => l.direcao === dir).reduce((s, l) => s + Number(l.valor_liquido ?? l.valor_bruto ?? 0), 0);
  const resumo = {
    entradas: soma('entrada'), saidas: soma('saida'),
    pendentes: lancamentos.filter(l => l.conta === '9.9' || l.classificado_por === 'pendente').length,
    conciliados: lancamentos.filter(l => l.conciliado).length, total: lancamentos.length,
  };
  const porBanco = {};
  for (const l of lancamentos) porBanco[l.banco] = (porBanco[l.banco] || 0) + 1;

  const totalCom = comissoes.reduce((s, c) => s + Number(c.valor_comissao || 0), 0);
  const extras = `
  <h2 style="font-size:15px;margin:24px 0 8px">Comissões pagas a parceiros (${comissoes.length})</h2>
  ${comissoes.length ? `<table style="width:100%;border-collapse:collapse;font-size:11.5px;border:1px solid #e2e8f0">
    <thead><tr style="background:#111;color:#fff"><th style="padding:6px 8px;text-align:left">Pago em</th><th style="padding:6px 8px;text-align:left">Tipo</th><th style="padding:6px 8px;text-align:left">Origem</th><th style="padding:6px 8px;text-align:right">Valor</th></tr></thead>
    <tbody>${comissoes.map(c => `<tr><td style="padding:5px 8px">${dataBR(c.pago_em)}</td><td style="padding:5px 8px">${escapeHtml(c.tipo || '')}</td><td style="padding:5px 8px">${escapeHtml(c.origem || '')}</td><td style="padding:5px 8px;text-align:right">${brl(c.valor_comissao)}</td></tr>`).join('')}
    <tr style="background:#f8fafc"><td colspan="3" style="padding:6px 8px;font-weight:700">Total</td><td style="padding:6px 8px;text-align:right;font-weight:700">${brl(totalCom)}</td></tr></tbody>
  </table>` : '<p style="font-size:12.5px;color:#64748b">Nenhuma comissão paga nesta competência.</p>'}

  <h2 style="font-size:15px;margin:24px 0 8px">Notas fiscais de parceiros aprovadas (${notas.length})</h2>
  ${notas.length ? `<table style="width:100%;border-collapse:collapse;font-size:11.5px;border:1px solid #e2e8f0">
    <thead><tr style="background:#111;color:#fff"><th style="padding:6px 8px;text-align:left">Nº</th><th style="padding:6px 8px;text-align:left">Emitente (CNPJ)</th><th style="padding:6px 8px;text-align:left">Emitida em</th><th style="padding:6px 8px;text-align:left">Verificação</th><th style="padding:6px 8px;text-align:right">Valor</th></tr></thead>
    <tbody>${notas.map(n => `<tr><td style="padding:5px 8px">${escapeHtml(n.numero || '—')}</td><td style="padding:5px 8px">${escapeHtml(n.emitente_cnpj || '—')}</td><td style="padding:5px 8px">${dataBR(n.emitida_em)}</td><td style="padding:5px 8px">${/^https:\/\//.test(n.verificacao_url || '') ? `<a href="${escapeHtml(n.verificacao_url)}">${escapeHtml(n.verificacao_status || 'abrir')}</a>` : escapeHtml(n.verificacao_status || '—')}</td><td style="padding:5px 8px;text-align:right">${brl(n.valor_nf)}</td></tr>`).join('')}</tbody>
  </table>` : '<p style="font-size:12.5px;color:#64748b">Nenhuma nota de parceiro aprovada nesta competência.</p>'}`;

  const html = gerarHTML({ de: comp, ate: comp, dre, lancamentos, resumo, extras });
  const ofx = gerarOFX(lancamentos, { de: comp, ate: comp, banco: '' });
  return { lancamentos, resumo, porBanco, comissoes, notas, html, ofx };
}

const carta = (paragrafos) => `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#111;line-height:1.6">${paragrafos.map(p => `<p>${p}</p>`).join('')}</div>`;

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const url = new URL(req.url, 'http://localhost');
  const auto = competenciaAnterior();
  const comp = /^\d{4}-\d{2}$/.test(url.searchParams.get('competencia') || '') ? url.searchParams.get('competencia') : auto.comp;
  const acao = url.searchParams.get('acao') || (auto.dia === 1 ? 'lembrete' : auto.dia >= DIA_ENVIO ? 'envio' : null);
  const soDono = url.searchParams.get('so_dono') === '1';
  if (!acao) { res.status(200).json({ ok: true, nada: `dia ${auto.dia}: nem lembrete (dia 1) nem envio (dia ${DIA_ENVIO}+)` }); return; }

  const chave = `contabilidade_envio_${comp}`;
  try {
    const marca = await ler(`sistema_heartbeat?chave=eq.${chave}&select=ultimo_em,detalhe`);
    if (acao === 'envio' && marca.length && !soDono) {
      res.status(200).json({ ok: true, ja_enviado: marca[0] });
      return;
    }

    const p = await montarPacote(comp);
    const mesTxt = nomeMes(comp);
    const telaUrl = `${BASE}/#/admin`;

    if (acao === 'lembrete') {
      const env = await enviarEmail({
        to: DONO,
        subject: `Contabilidade: o pacote de ${mesTxt} sai dia ${DIA_ENVIO} — ${p.resumo.pendentes} lançamento(s) a classificar`,
        html: carta([
          'Tarcísio,',
          `No dia ${DIA_ENVIO}, às 9h, o pacote de <strong>${escapeHtml(mesTxt)}</strong> vai sozinho para a contabilidade${process.env.CONTABILIDADE_EMAIL ? ` (${escapeHtml(process.env.CONTABILIDADE_EMAIL)})` : ' — <strong>mas o CONTABILIDADE_EMAIL não está configurado na Vercel, então ele vai só para você</strong>'}.`,
          `Hoje ele tem ${p.resumo.total} lançamento(s): entradas ${brl(p.resumo.entradas)}, saídas ${brl(p.resumo.saidas)}. Por conta: ${escapeHtml(Object.entries(p.porBanco).map(([b, n]) => `${b} ${n}`).join(' · ') || 'nenhum')}.`,
          p.resumo.pendentes
            ? `<strong>${p.resumo.pendentes} lançamento(s) ainda estão em 9.9 A CLASSIFICAR.</strong> Se der, classifique na tela de Conciliação antes do dia ${DIA_ENVIO}: <a href="${telaUrl}">abrir o Admin</a>.`
            : 'Nenhum lançamento pendente de classificação. Nada a fazer.',
          'BidPro Brasil',
        ]),
      });
      if (env === false || env?.ok === false) throw new Error(`lembrete não saiu: ${env?.error || 'falha no envio'}`);
      res.status(200).json({ ok: true, acao, comp, ...p.resumo });
      return;
    }

    // ENVIO
    if (!p.lancamentos.length) throw new Error(`competência ${comp} sem nenhum lançamento — a importação diária parou? Pacote NÃO enviado.`);
    const contador = soDono ? '' : String(process.env.CONTABILIDADE_EMAIL || '').trim();
    const contadorOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contador);
    const anexos = [{ filename: `conciliacao-${comp}.ofx`, content: Buffer.from(p.ofx, 'utf8').toString('base64') }];
    const env = await enviarEmail({
      to: contadorOk ? contador : DONO,
      cc: contadorOk ? DONO : undefined,
      replyTo: DONO,
      subject: `Conciliação e DRE — ${mesTxt} — BidPro Brasil`,
      html: carta([
        contadorOk ? 'Prezados,' : '<strong>Pacote NÃO enviado ao contador</strong> — CONTABILIDADE_EMAIL não configurado (ou teste só para o dono). Cópia abaixo para encaminhar à mão.',
        `Segue a conciliação bancária classificada por plano de contas da competência <strong>${escapeHtml(mesTxt)}</strong>: ${p.resumo.total} lançamento(s), ${p.comissoes.length} comissão(ões) paga(s) a parceiros e ${p.notas.length} nota(s) fiscal(is) de parceiros. O arquivo OFX vai em anexo, com a conta contábil de cada lançamento no histórico.`,
        p.resumo.pendentes ? `${p.resumo.pendentes} lançamento(s) seguem em 9.9 A CLASSIFICAR — estão destacados no relatório.` : 'Todos os lançamentos estão classificados.',
        'Qualquer dúvida, é só responder este e-mail.',
        'Atenciosamente,<br>Tarcísio Nogueira<br>BidPro Brasil',
      ]) + p.html,
      attachments: anexos,
    });
    if (env === false || env?.ok === false) throw new Error(`pacote não saiu: ${env?.error || 'falha no envio'}`);

    if (contadorOk) {
      const hb = await sb('rpc/registrar_heartbeat', { method: 'POST', body: JSON.stringify({
        p_chave: chave, p_detalhe: JSON.stringify({ para: contador, lancamentos: p.resumo.total, pendentes: p.resumo.pendentes }),
      }) });
      // Enviado e sem carimbo = amanhã sai de novo. Não desfaz o envio, mas precisa aparecer.
      if (!hb.ok) alertarErro({ rota: 'contabilidade-mensal-cron', erro: `pacote ${comp} ENVIADO, mas o carimbo não gravou (HTTP ${hb.status}) — pode repetir amanhã` });
    } else if (!soDono) {
      alertarErro({ rota: 'contabilidade-mensal-cron', erro: `pacote ${comp} foi só para o dono: configure CONTABILIDADE_EMAIL na Vercel` });
    }
    res.status(200).json({ ok: true, acao, comp, para: contadorOk ? contador : DONO, ...p.resumo, comissoes: p.comissoes.length, notas: p.notas.length });
  } catch (e) {
    console.error('[contabilidade-mensal]', comp, acao, e?.message || e);
    alertarErro({ rota: 'contabilidade-mensal-cron', erro: `${acao} ${comp}: ${String(e?.message || e).slice(0, 300)}` });
    res.status(500).json({ error: String(e?.message || e).slice(0, 300) });
  }
}
