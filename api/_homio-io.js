/**
 * I/O compartilhado da integração Homio (11/11): banco, e-mail de ativação e aviso de volta à Homio.
 * As regras puras estão em `_homio.js`. Usado por `homio-lead.js`, `ativar-conta.js` e
 * `homio-reenvio-cron.js`.
 *
 * Variáveis (nomes; valores só no painel da Vercel — o repositório é público):
 *   HOMIO_WEBHOOK_SECRET  segredo que a Homio manda no cabeçalho `x-homio-secret` ao chamar
 *                         /api/homio-lead; também deriva o token do link de ativação
 *   HOMIO_WEBHOOK_URL     (opcional) URL do "webhook de entrada" de uma automação da Homio, para
 *                         onde avisamos `conta_criada` (com o link), `ja_tinha_conta` e `conta_ativada`
 */
import { enviarEmail } from './_email.js';
import { tokenAtivacao, corpoAvisoHomio } from './_homio.js';

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
export const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
// Sempre com www: o domínio sem www redireciona, e POST/GET de terceiros pode se perder no redirect (08/11, MP).
export const APP_URL = 'https://www.bidprobrasil.com.br';
export const SEGREDO = () => (process.env.HOMIO_WEBHOOK_SECRET || '').trim();

export function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', ...(opts.headers || {}),
    },
    signal: opts.signal || AbortSignal.timeout(10000),
  });
}

/** Atualiza a linha e CONFERE: `fetch` não lança em 4xx, e uma escrita perdida aqui some sem rastro. */
export async function atualizarLead(id, campos) {
  const r = await sb(`homio_leads?id=eq.${id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ...campos, atualizado_em: new Date().toISOString() }),
  });
  if (!r.ok) {
    const det = (await r.text().catch(() => '')).slice(0, 200);
    console.error('[homio] gravação do lead falhou', id, r.status, det);
    return false;
  }
  return true;
}

export function linkAtivacao(lead) {
  const t = tokenAtivacao(lead?.id, SEGREDO());
  return t ? `${APP_URL}/api/ativar-conta?t=${t.token}` : null;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Manda o e-mail "Ative sua conta" no formato de carta (dono, 26/10) e grava o desfecho.
 * Orçamento do Resend estourado NÃO é sucesso: `enviarEmail` põe na fila do dia seguinte, e isso
 * fica escrito em `email_ativacao_erro` para o health-check e o painel enxergarem.
 */
export async function enviarEmailAtivacao(lead) {
  const link = linkAtivacao(lead);
  if (!link) {
    await atualizarLead(lead.id, { email_ativacao_erro: 'sem HOMIO_WEBHOOK_SECRET: link de ativação não pode ser montado' });
    return { ok: false, erro: 'sem_segredo' };
  }
  const primeiro = String(lead.nome || '').split(' ')[0];
  const saudacao = primeiro ? `Olá, ${primeiro}!` : 'Olá!';
  const paragrafos = [
    'Sua inscrição no lançamento está confirmada, e com ela você ganhou uma conta Explorador na BidPro Brasil, sem custo.',
    'Para entrar, é só ativar a conta e criar a sua senha pelo botão abaixo. O link vale por 30 dias.',
    'Na plataforma você encontra imóveis e veículos de leilão do Brasil inteiro, com os editais organizados e o mapa de cada lote.',
    'Se não foi você que se inscreveu, pode ignorar este e-mail: nenhuma conta é acessada sem este link.',
  ];
  let r;
  try {
    r = await enviarEmail({
      to: lead.email,
      subject: 'Ative sua conta na BidPro Brasil',
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a;font-size:14px;line-height:1.7">
        <p>${esc(saudacao)}</p>
        ${paragrafos.slice(0, 2).map((p) => `<p>${esc(p)}</p>`).join('')}
        <p style="margin:22px 0"><a href="${esc(link)}" style="background:#1d4ed8;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700">Ativar minha conta</a></p>
        ${paragrafos.slice(2).map((p) => `<p>${esc(p)}</p>`).join('')}
        <p>Atenciosamente,</p>
        <p>Tarcísio Nogueira<br>BidPro Brasil</p>
      </div>`,
      text: `${saudacao}\n\n${paragrafos[0]}\n\n${paragrafos[1]}\n\n${link}\n\n${paragrafos[2]}\n\n${paragrafos[3]}\n\nAtenciosamente,\n\nTarcísio Nogueira\nBidPro Brasil`,
      meta: { userId: lead.user_id, tipo: 'homio_ativacao' },
    });
  } catch (e) {
    r = { ok: false, error: String(e?.message || e) };
  }
  if (r?.ok) {
    await atualizarLead(lead.id, { email_ativacao_em: new Date().toISOString(), email_ativacao_erro: null });
    return { ok: true };
  }
  const motivo = r?.enfileirado ? 'enfileirado: orçamento diário do Resend excedido (sai na drenagem da fila)' : String(r?.error || 'falha desconhecida');
  await atualizarLead(lead.id, { email_ativacao_erro: motivo.slice(0, 300) });
  return { ok: false, erro: motivo, enfileirado: !!r?.enfileirado };
}

/**
 * Avisa a Homio (webhook de entrada) e grava o desfecho. Sem HOMIO_WEBHOOK_URL o aviso é PULADO —
 * e fica dito: `pulado: 'sem_url'`, não um sucesso calado. Falha entra na fila do cron.
 */
export async function avisarHomio(evento, lead) {
  const url = (process.env.HOMIO_WEBHOOK_URL || '').trim();
  if (!url) return { ok: false, pulado: 'sem_url' };
  let ok = false; let erro = null;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpoAvisoHomio(evento, lead, evento === 'conta_criada' ? linkAtivacao(lead) : null)),
      signal: AbortSignal.timeout(8000),
    });
    ok = r.ok;
    if (!ok) erro = `HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 150)}`;
  } catch (e) {
    erro = String(e?.message || e);
  }
  const g = await sb('rpc/homio_lead_registrar_aviso', {
    method: 'POST',
    body: JSON.stringify({ p_id: lead.id, p_evento: evento, p_ok: ok, p_erro: erro }),
  }).catch((e) => ({ ok: false, status: String(e?.message || e) }));
  if (!g.ok) console.error('[homio] desfecho do aviso não gravado', lead.id, evento, g.status);
  if (!ok) console.error('[homio] aviso à Homio falhou', evento, lead.id, erro);
  return { ok, erro };
}
