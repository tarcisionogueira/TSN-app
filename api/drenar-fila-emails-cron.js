/**
 * /api/drenar-fila-emails-cron — envia o que ficou represado em `emails_fila` (e-mails que
 * `enviarEmail`/`enviar-alertas-cron.js` não mandaram porque o orçamento diário do Resend
 * (plano Free, 100/dia) já tinha estourado). Dentro do orçamento QUE SOBRAR hoje, mais antigo
 * primeiro. Roda a cada poucas horas (vercel.json) — não precisa ser exato, o que importa é
 * drenar assim que o teto do dia liberar espaço. CRON_SECRET.
 *
 * Chama `enviarEmailAgora` (não `enviarEmail`): o orçamento já foi checado aqui, no laço —
 * se chamasse `enviarEmail` de novo, um segundo estouro no meio da drenagem re-enfileiraria
 * o MESMO e-mail como linha nova em vez de deixar a linha atual pendente.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmailAgora, orcamentoRestanteHoje } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase ausente' }), { status: 500 });

  let restante = await orcamentoRestanteHoje();
  if (restante <= 0) {
    return new Response(JSON.stringify({ ok: true, processados: 0, motivo: 'sem orcamento sobrando hoje' }), { headers: { 'Content-Type': 'application/json' } });
  }

  const r = await sb(`emails_fila?status=eq.pendente&order=criado_em.asc&limit=${Math.min(restante, 50)}&select=*`);
  if (!r.ok) return new Response(JSON.stringify({ error: 'query falhou' }), { status: 500 });
  const fila = await r.json();

  let enviados = 0, falhas = 0;
  for (const item of fila) {
    if (restante <= 0) break;
    let res;
    try {
      res = await enviarEmailAgora({
        to: item.destinatario.split(',').filter(Boolean),
        cc: item.cc || undefined,
        subject: item.assunto,
        html: item.html || undefined,
        text: item.texto_plano || undefined,
        replyTo: item.reply_to || undefined,
        meta: { tipo: item.tipo || undefined, userId: item.user_id || undefined },
      });
    } catch (e) {
      res = { ok: false, error: String(e?.message || e) };
    }
    if (res?.ok) {
      restante--;
      enviados++;
      await sb(`emails_fila?id=eq.${item.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'enviado', processado_em: new Date().toISOString(), tentativas: item.tentativas + 1 }),
      });
    } else {
      falhas++;
      // Suprimido/sem chave: não adianta tentar de novo amanhã com o mesmo destino/config.
      // 5 tentativas: teto pra não represar pra sempre um e-mail que nunca vai sair (evita
      // consumir orçamento de dias futuros com algo definitivamente quebrado).
      const definitivo = res?.suprimido || res?.error === 'sem_resend' || item.tentativas + 1 >= 5;
      await sb(`emails_fila?id=eq.${item.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status: definitivo ? 'falha' : 'pendente',
          tentativas: item.tentativas + 1,
          erro: String(res?.error || 'falha desconhecida').slice(0, 300),
        }),
      });
    }
  }
  return new Response(JSON.stringify({ ok: true, processados: fila.length, enviados, falhas, orcamento_restante: restante }), { headers: { 'Content-Type': 'application/json' } });
}
