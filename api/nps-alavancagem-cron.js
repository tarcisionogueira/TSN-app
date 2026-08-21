/**
 * /api/nps-alavancagem-cron — envia a pesquisa de satisfação (NPS) ao CLIENTE de
 * consórcio/home equity, 15 dias após o consultor confirmar o atendimento.
 * F5 do plano comercial (docs/PLANO_CONSULTOR_COMERCIAL.md) — é a CONTRAPROVA
 * independente do relato do consultor.
 *
 * Quem decide QUEM recebe é o banco: `nps_alavancagem_pendentes()` lê a regra
 * comercial.nps_cliente_15d (dias/gatilho), cria o token e devolve a lista.
 * Este cron só transporta: e-mail via Resend e, SÓ com o envio confirmado,
 * `nps_alavancagem_marcar_enviado` (envio marcado sem e-mail = forma #4/#5 —
 * o cliente nunca receberia e o sistema juraria que sim).
 * Roda 1×/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

const APP_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const LOTE = 50;   // teto por rodada — sobras saem na rodada seguinte (diária)

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: pendentes, error } = await supabase.rpc('nps_alavancagem_pendentes');
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  const fila = (pendentes || []).slice(0, LOTE);

  const { enviarEmail } = await import('./_email.js');
  let enviados = 0, falhas = 0;
  for (const p of fila) {
    const link = `${APP_URL}/#/nps?token=${p.token}`;
    const primeiroNome = String(p.nome || '').trim().split(/\s+/)[0] || 'Olá';
    const r = await enviarEmail({
      to: p.email,
      subject: `Como foi seu atendimento de ${p.produto}?`,
      meta: { tipo: 'nps_alavancagem' },
      html: `
        <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;margin:0 auto;color:#111">
          <h2 style="color:#084BA6;margin:24px 0 8px">Sua opinião fecha o nosso ciclo</h2>
          <p style="line-height:1.6">${primeiroNome}, há alguns dias você foi atendido(a) sobre <b>${p.produto}</b>
          pela BidPro Brasil. Leva menos de 1 minuto nos contar como foi — a sua resposta é o que
          garante a qualidade de quem atende em nosso nome.</p>
          <p style="text-align:center;margin:26px 0">
            <a href="${link}" style="background:#0D63DB;color:#fff;padding:13px 26px;border-radius:10px;text-decoration:none;font-weight:700;display:inline-block">Responder a pesquisa</a>
          </p>
          <p style="font-size:12.5px;color:#64748b;line-height:1.6">São só três perguntas: se você conseguiu contratar,
          uma nota de 0 a 10 e um comentário livre. O link é pessoal e único.</p>
        </div>`,
    });
    if (r?.ok) {
      // Marca DEPOIS do envio real; `error` conferido — marcação falha não pode sumir
      // (o cron re-enviaria amanhã: melhor e-mail duplicado que envio fantasma).
      const { error: eMark } = await supabase.rpc('nps_alavancagem_marcar_enviado', { p_lead: p.lead_id });
      if (eMark) console.error('[nps] enviado mas NÃO marcado', p.lead_id, eMark.message);
      enviados++;
    } else {
      falhas++;
      console.error('[nps] e-mail falhou', p.lead_id, r?.error || 'sem detalhe');
    }
  }

  return new Response(JSON.stringify({ ok: true, pendentes: (pendentes || []).length, enviados, falhas }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
