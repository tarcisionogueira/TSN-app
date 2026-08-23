/**
 * POST /api/alerta-publico  (público, SEM login) — o ímã "avise-me".
 *
 * Captura leve PRÉ-CONTA: e-mail + cidade/UF para avisar quando surgirem novos imóveis.
 * Segurança do fluxo (a razão de este endpoint existir separado do cadastro):
 *  - grava numa tabela ISOLADA (alerta_publico), nunca em perfis/sdr_leads — insert forjado
 *    não fabrica lead comercial nem usuário pagante;
 *  - a RLS da tabela é trancada (sem política anon): o único escritor é este endpoint, com
 *    a service key, DEPOIS de validar. anon batendo direto no PostgREST não escreve nada;
 *  - rate-limit por IP + honeypot (campo `website`) contra robô;
 *  - regex de e-mail SEM caracteres reservados do PostgREST (o valor entra em filtro eq.);
 *  - DUPLO OPT-IN: grava confirmado=false e manda e-mail de confirmação. Ninguém recebe
 *    alerta sem clicar — LGPD limpa, e não viramos canhão de spam.
 */
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
// Mesma normalização de cidade_norm do acervo (minúsc., sem acento, só alfanumérico).
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
function cors() {
  return { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
}
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...cors() } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors() });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405, headers: cors() });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: 'indisponível' }, 500);

  const rl = await checkRateLimit(`alerta:${getIP(req)}`, 5, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Honeypot: robô preenche o campo escondido `website`. Respondemos ok e não gravamos —
  // não dá pista de que o campo é a armadilha.
  if (String(body.website || '').trim()) return json({ ok: true });

  const email = String(body.email || '').trim().toLowerCase().slice(0, 160);
  // Sem caracteres reservados do PostgREST (`,` `(` `)` `"` e espaço) — o e-mail entra no
  // filtro `email=eq.` da busca de duplicata.
  if (!/^[^\s@,()"]+@[^\s@,()"]+\.[^\s@,()"]+$/.test(email)) return json({ error: 'Informe um e-mail válido.' }, 400);

  const uf = String(body.uf || '').toUpperCase().slice(0, 2);
  if (!UFS.includes(uf)) return json({ error: 'Estado inválido.' }, 400);

  const cidade = String(body.cidade || '').trim().slice(0, 80);
  const cidadeNorm = cidade ? norm(cidade).slice(0, 60) : '';
  const origem = String(body.origem || '').trim().slice(0, 160) || null;

  let token = null;
  try {
    const dup = await sb(`alerta_publico?email=eq.${encodeURIComponent(email)}&cidade_norm=eq.${encodeURIComponent(cidadeNorm)}&uf=eq.${uf}&select=id,token,confirmado&limit=1`);
    const [existente] = dup.ok ? await dup.json().catch(() => []) : [];
    if (existente) {
      token = existente.token;
      // Reativa (caso tenha descadastrado antes) e atualiza o carimbo.
      await sb(`alerta_publico?id=eq.${existente.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ ativo: true, atualizado_em: new Date().toISOString() }) });
      // Já confirmado antes → não reenvia e-mail; a caixinha mostra "já recebe alertas".
      if (existente.confirmado) return json({ ok: true, jaConfirmado: true });
    } else {
      const ins = await sb('alerta_publico', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ email, cidade: cidade || null, cidade_norm: cidadeNorm, uf, origem }) });
      if (!ins.ok) {
        console.error('[alerta-publico] insert falhou', ins.status, (await ins.text().catch(() => '')).slice(0, 200));
        return json({ error: 'Não foi possível registrar agora. Tente novamente.' }, 500);
      }
      const [novo] = await ins.json().catch(() => []);
      token = novo?.token || null;
    }
  } catch (e) {
    console.error('[alerta-publico] exceção', String(e?.message || e));
    return json({ error: 'Não foi possível registrar agora. Tente novamente.' }, 500);
  }
  if (!token) return json({ error: 'Não foi possível registrar agora. Tente novamente.' }, 500);

  // Duplo opt-in: e-mail de confirmação. Best-effort no LOG, mas o retorno reflete o envio —
  // se o e-mail não sair, a pessoa não fica achando que confirmou.
  const localTxt = cidade ? `${cidade}/${uf}` : uf;
  const confirmUrl = `${BASE}/api/alerta-confirmar?token=${token}`;
  try {
    const { enviarEmail } = await import('./_email.js');
    const r = await enviarEmail({
      to: email,
      subject: `Confirme seu alerta de imóveis em ${localTxt}`,
      meta: { tipo: 'alerta_publico_confirmacao' },
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
        <h2 style="color:#0D63DB;margin:0 0 12px">Confirme seu alerta 📩</h2>
        <p style="font-size:15px;line-height:1.6">Você pediu para ser avisado quando surgirem imóveis em leilão em <strong>${localTxt}</strong>. Clique abaixo para confirmar — só assim começamos a enviar.</p>
        <p style="margin:22px 0"><a href="${confirmUrl}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;display:inline-block">Confirmar meu alerta</a></p>
        <p style="font-size:12px;color:#94a3b8;line-height:1.6">Se você não pediu isto, ignore este e-mail — nada será enviado sem a confirmação.<br>BidPro Brasil — Leilão &amp; Investimentos</p>
      </div>`,
    });
    if (!r?.ok) {
      console.error('[alerta-publico] confirmação NÃO enviada', r?.error);
      return json({ error: 'Cadastramos, mas não conseguimos enviar a confirmação agora. Tente de novo em instantes.' }, 502);
    }
  } catch (e) {
    console.error('[alerta-publico] envio confirmação exceção', String(e?.message || e));
    return json({ error: 'Cadastramos, mas não conseguimos enviar a confirmação agora. Tente de novo em instantes.' }, 502);
  }

  return json({ ok: true });
}
