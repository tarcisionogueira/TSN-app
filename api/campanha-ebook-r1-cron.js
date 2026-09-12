/**
 * GET/POST /api/campanha-ebook-r1-cron — e-mail da campanha "O Lance Que Muda Tudo por R$1,00
 * + 1 mês de Investidor Pro" (pedido do dono, 12/09). Produto com `requer_cartao_bonus` — ver
 * supabase/migrations/produto_bonus_assinatura_com_cartao.sql, api/mp-checkout.js (proposito
 * 'produto_bonus') e api/ativar-assinatura-bonus-cron.js (conversão em assinatura real).
 *
 * Campanha de DISPARO ÚNICO, não recorrente — o agendamento em vercel.json (quando existir)
 * é uma data EXATA (dia/mês fixos), não uma cadência diária como os outros crons, e deve ser
 * removido do vercel.json depois de disparar (senão refire no mesmo dia/mês do ano seguinte).
 * Dois modos:
 *
 *   ?somenteEmail=alguem@x.com  → TESTE: manda só para este endereço, ignorando elegibilidade
 *                                  e dedup. É o "me manda pra eu testar" antes de validar.
 *   ?limite=N (sem somenteEmail) → ENVIO REAL: manda para até N Exploradores elegíveis que
 *                                  ainda não têm este ebook. Sem `limite`, processa todos os
 *                                  elegíveis — "validando, mandamos para todos" é rodar de novo
 *                                  sem limite (ou com um número maior).
 *
 * ELEGÍVEIS: role='explorador' (quem já é Investidor Pro/Leilão Club é bloqueado na COMPRA
 * pelo gate `plano_ja_superior`, que já existe em `comprar_produto_iniciar` — mandar o e-mail
 * pra eles só levaria a um clique que a compra recusa depois) e que ainda não têm o ebook
 * (`compras_produtos` ativo). DEDUP por (user_id) em `webhook_eventos_processados`
 * (gateway='campanha') — rodar duas vezes não manda duas vezes.
 *
 * AUTORIZAÇÃO — dois caminhos, mesmo padrão de api/anunciar-produto.js + os crons de
 * e-mail novo (ativacao-nudge/aviso-cortesia-vencendo):
 *   1. Sessão de ADMIN logado (botão "🎁 Testar campanha" em Admin → eBooks) — um clique do
 *      dono É a autorização, mesmo espírito do confirm() de api/anunciar-produto.js. Vale
 *      pros dois modos (teste e envio).
 *   2. CRON_SECRET (Vercel Cron, disparo agendado — ver vercel.json) — só o modo ENVIO passa
 *      pelo interruptor `app_config.campanha_ebook_r1_ativo` (default 'false' = DRY-RUN, não
 *      manda nada e só relata quem receberia). Diferente dos outros e-mails "novos", aqui o
 *      interruptor existe especificamente para o disparo AGENDADO sem humano por perto no
 *      momento — o dono aprova no chat, eu ligo o interruptor no banco, e só DEPOIS disso o
 *      cron de amanhã manda de verdade. Sem essa aprovação, o disparo agendado nunca sai
 *      sozinho, mesmo já estando no ar.
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized, getAuthUser, getUserRoleById } from './_auth.js';
import { enviarEmail } from './_email.js';
import { assinarUnsub } from './cancelar-alertas.js';
import { linkRastreado } from './_link-email.js';
import { utmEmail } from './_utm.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE         = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const FROM         = process.env.APP_ALERTS_FROM || process.env.EMAIL_FROM || 'BidPro Brasil <noreply@bidprobrasil.com.br>';
const TETO_LOTE    = 500; // válvula de segurança

const EBOOK_ID    = '5c78ab35-9810-48b2-8801-16d50bc94f50';
const EBOOK_TIPO  = 'ebook';

const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const sb  = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2 });

function cabecalho(L) {
  const home = L('/');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;background:#0D63DB;background-image:linear-gradient(135deg,#0D63DB 0%,#0B4BA6 100%);border-radius:14px 14px 0 0;">
    <tr><td align="center" style="padding:22px 20px;">
      <a href="${home}" style="text-decoration:none;display:inline-block;" target="_blank">
        <table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
          <tr>
            <td style="background:#ffffff;border-radius:9px;width:34px;height:34px;text-align:center;vertical-align:middle;font-family:Arial,Helvetica,sans-serif;font-size:20px;font-weight:900;color:#0D63DB;line-height:34px;">B</td>
            <td style="padding-left:10px;font-family:Arial,Helvetica,sans-serif;font-size:19px;font-weight:900;color:#ffffff;letter-spacing:-.2px;white-space:nowrap;">
              BidPro <span style="font-weight:400;letter-spacing:2px;font-size:12px;opacity:.85;">BRASIL</span>
            </td>
          </tr>
        </table>
      </a>
    </td></tr>
  </table>`;
}

// Exportado para permitir prévia manual (mesmo motivo de ativacao-nudge-cron.js/
// aviso-cortesia-vencendo-cron.js: o dono precisa ver o e-mail exatamente como o cliente vai
// receber antes de autorizar o disparo em massa).
export function corpo({ nome, ebook, precoTop2, unsubUrl, userId }) {
  const L = (caminho) => linkRastreado(userId, 'campanha_ebook_r1', caminho);
  const saudacao = nome ? `Olá, ${esc(String(nome).split(' ')[0])}!` : 'Olá!';
  const cta = L(`/#/p/ebook/${ebook.id}?${utmEmail('campanha_ebook_r1')}`);
  const home = L('/');
  return `<div style="font-family:Arial,Helvetica,sans-serif;background:#f1f5f9;padding:22px 12px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;max-width:560px;margin:0 auto;">
      <tr><td>${cabecalho(L)}</td></tr>
      <tr><td style="background:#ffffff;border-radius:0 0 14px 14px;padding:26px 24px;color:#0f172a;">
        <p style="font-size:15px;font-weight:700;margin:0 0 12px;">${saudacao}</p>
        <p style="font-size:14px;line-height:1.7;color:#334155;margin:0 0 14px;">
          Por tempo limitado, o eBook <strong>"${esc(ebook.titulo)}"</strong> sai por
          <strong>${brl(ebook.oferta_preco)}</strong> (de ${brl(ebook.preco)}) — e vem com um bônus:
          <strong>${ebook.concede_meses} mês${ebook.concede_meses > 1 ? 'es' : ''} de Investidor Pro de cortesia</strong>,
          o plano com relatório completo de mercado, edital e riscos para cada imóvel.
        </p>
        <table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px;">
          <tr><td style="padding:0;">
            <a href="${cta}" target="_blank" style="display:block;text-decoration:none;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;background:#ffffff;">
              <img src="${esc(ebook.capa_url)}" alt="${esc(ebook.titulo)}" width="100%" style="display:block;max-width:100%;border-bottom:1px solid #e2e8f0;">
              <div style="padding:14px 16px;">
                <div style="font-size:14px;font-weight:700;color:#0f172a;line-height:1.4;">${esc(ebook.titulo)}</div>
                <div style="margin-top:8px;font-size:13px;color:#94a3b8;text-decoration:line-through;">${brl(ebook.preco)}</div>
                <div style="font-size:20px;font-weight:800;color:#059669;">${brl(ebook.oferta_preco)}</div>
              </div>
            </a>
          </td></tr>
        </table>
        <p style="font-size:12.5px;line-height:1.7;color:#64748b;margin:0 0 18px;">
          Depois do ${ebook.concede_meses}º mês, a assinatura Investidor Pro
          (${brl(precoTop2)}/mês) é cobrada automaticamente no mesmo cartão para continuar —
          isso fica claro antes de você pagar, e dá para cancelar quando quiser, sem multa.
        </p>
        <div style="text-align:center;margin:22px 0 10px;">
          <a href="${cta}" target="_blank" style="display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:13px 28px;border-radius:10px;font-weight:700;font-size:15px;">Quero o eBook por ${brl(ebook.oferta_preco)} →</a>
        </div>
      </td></tr>
      <tr><td style="padding:16px 24px 0;text-align:center;">
        <p style="font-size:12px;color:#94a3b8;line-height:1.6;margin:0;">
          <a href="${home}" target="_blank" style="color:#64748b;text-decoration:none;font-weight:700;">BidPro Brasil</a><br>
          <a href="${unsubUrl}" style="color:#94a3b8;">Não quero mais receber</a>.
        </p>
      </td></tr>
    </table>
  </div>`;
}

const ASSUNTO = 'eBook por R$ 1,00 + 1 mês de Investidor Pro de cortesia';

async function buscarEbook() {
  const r = await sb(`ebooks_admin?id=eq.${EBOOK_ID}&select=id,titulo,preco,oferta_preco,concede_meses,capa_url&ativo=eq.true`);
  if (!r.ok) return null;
  const [e] = await r.json().catch(() => []);
  return e || null;
}
async function precoTop2() {
  try {
    const r = await sb('planos_config?plano_key=eq.top2&select=preco');
    if (r.ok) { const [row] = await r.json(); const v = Number(row?.preco); if (v > 0) return v; }
  } catch { /* mantém o fallback abaixo */ }
  return 49.90;
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  const viaCron = isCronAuthorized(req);
  let viaAdmin = false;
  if (!viaCron) {
    try {
      const u = await getAuthUser(req);
      if (u?.id) viaAdmin = (await getUserRoleById(u.id)) === 'admin';
    } catch { /* sem sessão válida → segue não-autorizado */ }
  }
  if (!viaCron && !viaAdmin) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let limite = 0, somenteEmail = '';
  try {
    const q = new URL(req.url, 'http://x').searchParams;
    limite = Math.max(0, Number(q.get('limite') || 0) || 0);
    somenteEmail = String(q.get('somenteEmail') || '').trim().toLowerCase();
  } catch { /* url malformada */ }

  const ebook = await buscarEbook();
  if (!ebook) return new Response(JSON.stringify({ error: 'ebook_indisponivel' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  const precoTop2Cheio = await precoTop2();

  const resumo = { modo: somenteEmail ? 'teste' : 'envio', elegiveis: 0, enviados: 0, falhas: 0 };

  // ── MODO TESTE: um endereço só, ignora elegibilidade/dedup ────────────────────────────
  if (somenteEmail) {
    const unsubUrl = `${BASE}/api/cancelar-alertas?token=${assinarUnsub('teste')}`;
    const r = await enviarEmail({
      from: FROM, to: somenteEmail,
      subject: `[TESTE] ${ASSUNTO}`,
      html: corpo({ nome: null, ebook, precoTop2: precoTop2Cheio, unsubUrl, userId: null }),
      headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
      meta: { tipo: 'campanha_ebook_r1_teste' },
    });
    if (r?.ok) resumo.enviados = 1; else resumo.falhas = 1;
    return new Response(JSON.stringify({ ok: !!r?.ok, ...resumo, erro: r?.ok ? undefined : r?.error }), { headers: { 'Content-Type': 'application/json' } });
  }

  // ── MODO ENVIO: disparo agendado (CRON_SECRET) respeita o interruptor no banco. Admin
  // clicando é a própria autorização (mesmo raciocínio de api/anunciar-produto.js) — não
  // precisa do interruptor. Falha de leitura do interruptor => DESLIGADO (mesmo padrão dos
  // demais e-mails novos: sem certeza de que foi aprovado, não manda para cliente).
  if (!viaAdmin) {
    let ligado = false;
    try {
      const r = await sb('app_config?key=eq.campanha_ebook_r1_ativo&select=value');
      if (r.ok) ligado = String((await r.json())?.[0]?.value ?? '').toLowerCase() === 'true';
      else console.error('[campanha-ebook-r1] leitura do interruptor devolveu', r.status, '— assumindo desligado');
    } catch (e) { console.error('[campanha-ebook-r1] leitura do interruptor falhou (assumindo desligado):', e?.message); }
    if (!ligado) {
      return new Response(JSON.stringify({ ok: true, dry_run: true, motivo: 'app_config.campanha_ebook_r1_ativo != true' }), { headers: { 'Content-Type': 'application/json' } });
    }
  }

  // Exploradores que ainda não têm o ebook.
  // PostgREST não faz subquery correlata na query string — duas leituras e filtra em
  // memória, mais simples e sem risco de sintaxe incorreta.
  const todosRes = await sb(`perfis?select=id,nome&role=eq.explorador&ativo=eq.true&limit=${TETO_LOTE}`);
  if (!todosRes.ok) {
    return new Response(JSON.stringify({ error: 'consulta de candidatos falhou', detalhe: await todosRes.text().catch(() => '') }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const todos = await todosRes.json().catch(() => []);
  const jaTemRes = await sb(`compras_produtos?select=user_id&produto_tipo=eq.${EBOOK_TIPO}&produto_id=eq.${EBOOK_ID}&status=eq.ativo`);
  const jaTem = new Set(jaTemRes.ok ? (await jaTemRes.json()).map((c) => c.user_id) : []);
  const elegiveis = (Array.isArray(todos) ? todos : []).filter((p) => !jaTem.has(p.id));
  resumo.elegiveis = elegiveis.length;
  const lista = limite > 0 ? elegiveis.slice(0, limite) : elegiveis;

  for (const p of lista) {
    try {
      // DEDUP: reserva a vaga ANTES de enviar (mesmo padrão de ativacao-nudge-cron.js) —
      // rodar de novo nunca manda duas vezes para quem já recebeu.
      const ins = await sb('webhook_eventos_processados', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ gateway: 'campanha', gateway_payment_id: String(p.id), evento: 'ebook_bonus_r1' }),
      });
      if (ins.status === 409) continue; // já recebeu

      const rEmail = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers: hdr, signal: AbortSignal.timeout(10000) });
      const email = rEmail.ok ? (await rEmail.json())?.email : null;
      if (!email) { resumo.falhas++; continue; }

      const unsubUrl = `${BASE}/api/cancelar-alertas?token=${assinarUnsub(p.id)}`;
      const r = await enviarEmail({
        from: FROM, to: email, subject: ASSUNTO,
        html: corpo({ nome: p.nome, ebook, precoTop2: precoTop2Cheio, unsubUrl, userId: p.id }),
        headers: { 'List-Unsubscribe': `<${unsubUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
        meta: { tipo: 'campanha_ebook_r1', userId: p.id },
      });
      if (r?.ok) resumo.enviados++;
      else {
        resumo.falhas++;
        await sb(`webhook_eventos_processados?gateway=eq.campanha&gateway_payment_id=eq.${encodeURIComponent(String(p.id))}&evento=eq.ebook_bonus_r1`, { method: 'DELETE' }).catch(() => {});
      }
    } catch (e) {
      resumo.falhas++;
      console.error('[campanha-ebook-r1] falha em', p.id, e?.message);
    }
  }

  return new Response(JSON.stringify({ ok: true, ...resumo }), { headers: { 'Content-Type': 'application/json' } });
}
