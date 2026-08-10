/**
 * /api/renovacao-avisos-cron — aviso por e-mail ANTES da renovação da assinatura.
 *
 * Varre os preapprovals AUTORIZADOS no Mercado Pago (assinaturas recorrentes) e,
 * ~3 dias antes da próxima cobrança (next_payment_date), envia ao cliente um
 * e-mail com o descritivo completo: plano, valor, data e forma de pagamento
 * (cobrança recorrente automática no cartão). Idempotente por ciclo de cobrança
 * (webhook_eventos_processados: evento 'renov_aviso:<data>') — não reenvia.
 *
 * O plano ANUAL agora é preapproval RECORRENTE (frequency 12/months) → aparece na busca
 * abaixo e recebe o MESMO aviso de renovação (regra c). Além disso, quem AGENDOU a virada
 * anual→mensal (ciclo_agendado='mensal', regra b) recebe, perto do vencimento, um e-mail de
 * REAUTORIZAÇÃO com link 1-clique para assinar o mensal (o gateway exige novo consentimento
 * do cartão — não cobramos em silêncio); sem clicar, o acesso lapsa no vencimento (cron de
 * reconciliação). Ver docs/HANDOFF.md (E11).
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { enviarEmail } from './_email.js';

const MP_TOKEN     = (process.env.MP_ACCESS_TOKEN || '').trim();
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const APP_URL      = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const EMAIL_FROM   = process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>';

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const fmtBRL = v => `R$ ${Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Idempotência: o INSERT é a trava (PK única em webhook_eventos_processados).
// 201 = inseriu agora (primeira vez) → avisar; 409 = já avisado neste ciclo → pular.
async function jaAvisado(preapprovalId, nextDate) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/webhook_eventos_processados`, {
      method: 'POST',
      headers: { ...hdr, Prefer: 'return=minimal' },
      body: JSON.stringify({ gateway: 'mercadopago', gateway_payment_id: String(preapprovalId), evento: `renov_aviso:${nextDate}` }),
    });
    if (r.status === 201 || r.ok) return false;
    if (r.status === 409) return true;
    return true; // erro inesperado → não arriscar spam
  } catch { return true; }
}

function corpoEmail({ nome, plano, valor, dataFmt }) {
  const saud = nome ? `Olá, ${esc(nome.split(' ')[0])}!` : 'Olá!';
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
    <p style="font-size:15px">${saud}</p>
    <p style="font-size:14px;line-height:1.7">Sua assinatura <strong>${esc(plano)}</strong> na BidPro Brasil
    <strong>renova automaticamente em ${esc(dataFmt)}</strong>. <strong>Você não precisa fazer nada para continuar</strong> —
    é só um aviso de transparência com os detalhes:</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
      <tr><td style="padding:8px 0;color:#64748b">Plano</td><td style="padding:8px 0;text-align:right;font-weight:700">${esc(plano)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Valor</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">${fmtBRL(valor)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Data da cobrança</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">${esc(dataFmt)}</td></tr>
      <tr><td style="padding:8px 0;color:#64748b;border-top:1px solid #e2e8f0">Forma de pagamento</td><td style="padding:8px 0;text-align:right;font-weight:700;border-top:1px solid #e2e8f0">Cobrança recorrente automática no cartão cadastrado</td></tr>
    </table>
    <p style="font-size:13px;line-height:1.7;color:#475569">Se você <strong>não quiser renovar</strong>, é só
    <a href="${APP_URL}/#/perfil" style="color:#0D63DB"><strong>acessar o portal e cancelar a renovação automática</strong></a>
    até <strong>${esc(dataFmt)}</strong> — imediato, sem multa. Por lá também dá para trocar o cartão. Se estiver tudo certo, não precisa responder.</p>
    <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil · aviso de renovação (você não precisa confirmar nada para continuar).</p>
  </div>`;
}

// IMPORTANTE: exportar por MÉTODO nomeado (GET/POST), não `export default`. No runtime
// Node da Vercel, `export default` é tratado como assinatura Express `(req, res)` e o
// `Response` retornado é IGNORADO — a função nunca sinaliza fim e trava até o maxDuration
// (504) a cada execução. Com GET/POST o `req` é um Request Web e o `Response` é honrado.
export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!MP_TOKEN) return new Response(JSON.stringify({ error: 'MP_ACCESS_TOKEN ausente' }), { status: 500 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });

  const AGORA = Date.now();
  const DIA = 86400000;
  let verificados = 0, avisados = 0, semEmail = 0;

  // E-mail do assinante: fica em `auth.users` (GoTrue admin), não em `perfis` nem no MP.
  // Mesmo caminho que enviar-alertas-cron/saldo-abandono-cron já usam.
  async function emailDoUsuario(userId) {
    try {
      const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${userId}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
      if (!r.ok) return null;
      const u = await r.json();
      return u?.email ? String(u.email).toLowerCase() : null;
    } catch { return null; }
  }

  try {
    for (let offset = 0; offset < 3000; offset += 100) {
      const r = await fetch(`https://api.mercadopago.com/preapproval/search?status=authorized&offset=${offset}&limit=100`, {
        headers: { Authorization: `Bearer ${MP_TOKEN}` },
      });
      if (!r.ok) break;
      const data = await r.json();
      const results = data?.results || [];
      if (!results.length) break;

      for (const sub of results) {
        verificados++;
        const nextRaw = sub.next_payment_date || sub.auto_recurring?.next_payment_date;
        if (!nextRaw) continue;
        const nextMs = Date.parse(nextRaw);
        if (isNaN(nextMs)) continue;
        const dias = Math.ceil((nextMs - AGORA) / DIA);
        if (dias < 1 || dias > 3) continue;          // avisa ~3 dias antes
        // 🔴 O e-mail NÃO vem do MP (achado 04/08). `/preapproval/search` devolve
        // `payer_id`, e NUNCA a chave `payer_email` — confirmado no espelho de
        // `mp_assinaturas.dados_mp` (`dados_mp ? 'payer_email'` = false nas 2 assinaturas
        // vivas). O código antigo lia `sub.payer_email` e caía num `continue` silencioso:
        // TODO assinante era pulado, e `webhook_eventos_processados` nunca teve UMA linha
        // `renov_aviso:` — o aviso prometido nas telas e nos termos jamais saiu. Agora o
        // e-mail vem de ONDE ELE EXISTE: o nosso `auth.users`, pelo userId do
        // external_reference (`<userId>|<plano>`), que já é o par de chaves usado pelos
        // outros crons de MP. `payer_email` continua valendo como atalho se um dia voltar.
        const [userIdRef] = String(sub.external_reference || '').split('|');
        const email = sub.payer_email || (userIdRef ? await emailDoUsuario(userIdRef) : null);
        if (!email) { semEmail++; continue; }

        const nextDate = String(nextRaw).slice(0, 10);
        if (await jaAvisado(sub.id, nextDate)) continue;

        const valor  = sub.auto_recurring?.transaction_amount;
        const plano  = sub.reason || 'BidPro Brasil';
        const nome   = sub.payer_first_name || sub.payer_name || '';
        const dataFmt = new Date(nextMs).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });

        try {
          // enviarEmail NUNCA lança (retorna { ok:false }). A trava de idempotência já foi
          // gravada por jaAvisado() ACIMA — se o envio falhar aqui, o próximo run veria 409 e
          // pularia, e o cliente seria cobrado ~3 dias depois SEM o aviso prometido. Então,
          // em falha, SOLTA a trava para re-tentar no próximo ciclo (dentro da janela).
          const r = await enviarEmail({
            from: EMAIL_FROM,
            to: email,
            subject: `Sua assinatura ${plano} renova em ${dataFmt}`,
            html: corpoEmail({ nome, plano, valor, dataFmt }),
          });
          if (r?.ok) {
            avisados++;
          } else {
            await fetch(`${SUPABASE_URL}/rest/v1/webhook_eventos_processados?gateway=eq.mercadopago&gateway_payment_id=eq.${encodeURIComponent(String(sub.id))}&evento=eq.${encodeURIComponent('renov_aviso:' + nextDate)}`,
              { method: 'DELETE', headers: { ...hdr } }).catch(() => {});
            console.error('[renovacao-avisos] email nao enviado, trava liberada:', r?.error);
          }
        } catch (e) { console.error('[renovacao-avisos] email:', e?.message); }
      }

      const total = Number(data?.paging?.total || 0);
      if (offset + 100 >= total) break;
    }

    // ── REGRA (b): reautorização anual→mensal perto do vencimento ────────────
    // Quem agendou a virada (ciclo_agendado='mensal') recebe o link para ativar o mensal
    // (o gateway exige novo consentimento — não cobramos sozinhos). Dedup por vencimento.
    try {
      const rc = await fetch(`${SUPABASE_URL}/rest/v1/rpc/agendados_ciclo_para_aviso`, {
        method: 'POST', headers: hdr, body: JSON.stringify({ p_dias: 7 }),
      });
      const cand = rc.ok ? await rc.json().catch(() => []) : [];
      for (const c of (Array.isArray(cand) ? cand : [])) {
        if (!c.email || !c.plano_vencimento) continue;
        verificados++;
        const vencDate = String(c.plano_vencimento).slice(0, 10);
        if (await jaAvisado(`ciclo_${c.user_id}`, vencDate)) continue;
        const dataFmt = new Date(c.plano_vencimento).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });
        const saud = c.nome ? `Olá, ${esc(String(c.nome).split(' ')[0])}!` : 'Olá!';
        const link = `${APP_URL}/#/checkout?plano=top2`;
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
          <p style="font-size:15px">${saud}</p>
          <p style="font-size:14px;line-height:1.7">Você pediu para migrar o seu <strong>Investidor Pro anual</strong> para a <strong>mensalidade</strong>.
          O seu plano anual vale até <strong>${esc(dataFmt)}</strong>. Para continuar sem interrupção já no <strong>plano mensal (R$ 49,90/mês)</strong>,
          confirme o cartão no botão abaixo — leva 1 minuto e não há cobrança até o fim do seu período anual atual.</p>
          <p style="margin:22px 0"><a href="${link}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Ativar o plano mensal →</a></p>
          <p style="font-size:13px;line-height:1.7;color:#475569">Se você não confirmar até ${esc(dataFmt)}, o acesso ao Investidor Pro será pausado no fim do período anual — e você pode reativar quando quiser.</p>
          <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil · migração do plano anual para mensal.</p>
        </div>`;
        try {
          const r2 = await enviarEmail({ from: EMAIL_FROM, to: c.email, subject: 'Confirme o seu novo plano mensal — BidPro Brasil', html });
          if (r2?.ok) avisados++;
          else {
            await fetch(`${SUPABASE_URL}/rest/v1/webhook_eventos_processados?gateway=eq.mercadopago&gateway_payment_id=eq.${encodeURIComponent('ciclo_' + c.user_id)}&evento=eq.${encodeURIComponent('renov_aviso:' + vencDate)}`, { method: 'DELETE', headers: { ...hdr } }).catch(() => {});
          }
        } catch (e) { console.error('[renovacao-avisos] ciclo email:', e?.message); }
      }
    } catch (e) { console.error('[renovacao-avisos] loop ciclo_agendado:', e?.message); }

    // ── DOWNGRADE AGENDADO: convite para autorizar o plano MENOR (10/08) ─────
    // Espelha o bloco de cima. Quem pediu para descer de plano (`plano_agendado`) mantém o
    // atual até `plano_vencimento`; aqui recebe o link para ativar o novo. O gateway exige
    // consentimento para uma recorrência nova — sem este e-mail, o cliente simplesmente CAI
    // no vencimento, que é o oposto do que ele pediu.
    try {
      const rp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/agendados_plano_para_aviso`, {
        method: 'POST', headers: hdr, body: JSON.stringify({ p_dias: 7 }),
      });
      const candP = rp.ok ? await rp.json().catch(() => []) : [];
      if (!rp.ok) console.error('[renovacao-avisos] agendados_plano_para_aviso falhou', rp.status);
      const NOME_PLANO = { top2: 'Investidor Pro', clube: 'Clube' };
      for (const c of (Array.isArray(candP) ? candP : [])) {
        if (!c.email || !c.plano_vencimento || !c.plano_agendado) continue;
        verificados++;
        const vencDate = String(c.plano_vencimento).slice(0, 10);
        if (await jaAvisado(`plano_${c.user_id}`, vencDate)) continue;
        const dataFmt = new Date(c.plano_vencimento).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' });
        const saud = c.nome ? `Olá, ${esc(String(c.nome).split(' ')[0])}!` : 'Olá!';
        const novo = NOME_PLANO[c.plano_agendado] || 'novo plano';
        const atualNome = NOME_PLANO[String(c.role || '').replace(/_anual$/, '')] || 'plano atual';
        const link = `${APP_URL}/#/checkout?plano=${encodeURIComponent(c.plano_agendado)}`;
        const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#0f172a">
          <p style="font-size:15px">${saud}</p>
          <p style="font-size:14px;line-height:1.7">Você pediu para mudar do <strong>${esc(atualNome)}</strong> para o <strong>${esc(novo)}</strong>.
          O seu plano atual vale até <strong>${esc(dataFmt)}</strong> — você não perdeu nada do que já pagou.</p>
          <p style="font-size:14px;line-height:1.7">Para continuar sem interrupção já no <strong>${esc(novo)}</strong>, confirme o cartão no botão abaixo.
          Leva 1 minuto e <strong>não há cobrança até ${esc(dataFmt)}</strong>.</p>
          <p style="margin:22px 0"><a href="${link}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:700;font-size:14px">Ativar o ${esc(novo)} →</a></p>
          <p style="font-size:13px;line-height:1.7;color:#475569">Se você não confirmar até ${esc(dataFmt)}, o acesso será pausado no fim do período atual — e você pode reativar quando quiser.</p>
          <p style="font-size:12px;color:#94a3b8;margin-top:24px">BidPro Brasil · mudança de plano agendada por você.</p>
        </div>`;
        try {
          const r3 = await enviarEmail({ from: EMAIL_FROM, to: c.email, subject: `Confirme o seu novo plano — BidPro Brasil`, html });
          if (r3?.ok) avisados++;
          else {
            // Libera a trava de dedup: e-mail que NÃO saiu não pode contar como avisado, senão
            // o cliente perde o único convite e cai no vencimento sem entender por quê.
            await fetch(`${SUPABASE_URL}/rest/v1/webhook_eventos_processados?gateway=eq.mercadopago&gateway_payment_id=eq.${encodeURIComponent('plano_' + c.user_id)}&evento=eq.${encodeURIComponent('renov_aviso:' + vencDate)}`, { method: 'DELETE', headers: { ...hdr } }).catch(() => {});
          }
        } catch (e) { console.error('[renovacao-avisos] plano email:', e?.message); }
      }
    } catch (e) { console.error('[renovacao-avisos] loop plano_agendado:', e?.message); }
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }

  // `sem_email` é REPORTADO, não engolido: foi um skip invisível que segurou 100% dos avisos
  // por semanas. Assinante dentro da janela e sem e-mail resolvível tem que aparecer no retorno.
  if (semEmail) console.error(`[renovacao-avisos] ${semEmail} assinante(s) na janela SEM e-mail resolvível`);
  return new Response(JSON.stringify({ ok: true, verificados, avisados, sem_email: semEmail }), { headers: { 'Content-Type': 'application/json' } });
}
