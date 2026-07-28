/**
 * POST /api/criar-conta-checkout
 * Cria a conta do visitante no fluxo do checkout JÁ CONFIRMADA (email_confirm=true),
 * para liberar o acesso direto — usado no cadastro do plano GRÁTIS (Explorador),
 * que não tem pagamento. O cadastro NORMAL (tela de login) segue exigindo
 * confirmação de e-mail; isto é só para o checkout.
 *
 * Segurança: role SEMPRE 'explorador'; rate limit por IP; senha forte.
 */
export const config = { runtime: 'nodejs' };

import { checkRateLimit } from './_rate-limit.js';
import { hashCpf, encryptCpf, validarCPF } from './_cpf.js';
import { enviarEmail } from './_email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  const origin = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!(await checkRateLimit(`criar-conta:${ip}`, 5, 60_000)).ok) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde um instante e tente de novo.' });
  }

  const b = req.body || {};
  const nome     = String(b.nome || '').trim();
  const email    = String(b.email || '').trim().toLowerCase();
  const senha    = String(b.senha || '');
  const cpf      = String(b.cpf || '').replace(/\D/g, '');
  const refCodigo = b.ref_codigo ? String(b.ref_codigo) : undefined;

  if (!nome || !email || !senha) return res.status(400).json({ error: 'Preencha nome, e-mail e senha.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(senha)) {
    return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres, com maiúscula, minúscula, número e caractere especial.' });
  }
  // Se veio CPF, valida o dígito verificador (não persistir CPF fictício).
  if (cpf && !validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.' });

  // CPF NÃO vai para o metadata do Auth (só hash+cifra em perfis, abaixo).
  const meta = { nome, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString() };
  if (refCodigo) meta.ref_codigo = refCodigo;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: meta }),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = String(data?.msg || data?.error_description || data?.error || data?.message || '');
    if (/already.*(registered|exists)|been registered|duplicate/i.test(msg)) {
      return res.status(409).json({ error: 'Este e-mail já tem conta. Faça login para continuar.' });
    }
    return res.status(400).json({ error: 'Não foi possível criar a conta.' + (msg ? ` (${msg})` : '') });
  }

  const userId = data?.id || data?.user?.id || null;
  if (userId) {
    try {
      const [cpf_hash, cpf_enc] = cpf ? await Promise.all([hashCpf(cpf), encryptCpf(cpf)]) : [null, null];
      await sb('perfis?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: userId, nome, cpf_hash, cpf_enc, role: 'explorador', lgpd_aceito: true, lgpd_data: meta.lgpd_data }),
      });
    } catch { /* best-effort; app tolera ausência de perfil */ }
  }

  // E-mail de boas-vindas + AVISO anti-"squatting" (decisão do dono): o cadastro grátis é
  // instantâneo (sem etapa de confirmação), então avisamos o dono do endereço que a conta
  // foi criada. Se não foi ele, pode ASSUMIR o acesso via "Esqueci minha senha" (o link de
  // redefinição só chega no e-mail dele) ou falar com o suporte. Best-effort: nunca derruba
  // o cadastro se o envio falhar.
  try {
    const loginUrl = `${origin}/#/login`;
    const primeiroNome = nome.split(' ')[0] || 'Investidor';
    await enviarEmail({
      to: email,
      subject: 'Bem-vindo(a) à BidPro Brasil — sua conta grátis foi criada',
      html: `<div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#1e293b">
        <h2 style="color:#0D63DB;margin:0 0 12px">Olá, ${primeiroNome}! 👋</h2>
        <p style="font-size:15px;line-height:1.6">Sua conta <strong>grátis (Explorador)</strong> na BidPro Brasil foi criada e já está ativa. Você pode buscar leilões em todo o Brasil, usar a calculadora de arrematação e acessar os materiais gratuitos.</p>
        <p style="margin:20px 0"><a href="${loginUrl}" style="background:#0D63DB;color:#fff;text-decoration:none;padding:11px 22px;border-radius:8px;font-weight:700;display:inline-block">Acessar minha conta</a></p>
        <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:12px 16px;font-size:13px;line-height:1.6;color:#9a3412">
          <strong>Não reconhece este cadastro?</strong> Se não foi você quem criou esta conta, alguém pode ter usado o seu e-mail. Você pode assumir o acesso em <a href="${loginUrl}" style="color:#9a3412;font-weight:700">${loginUrl.replace(/^https?:\/\//, '')}</a> usando <strong>"Esqueci minha senha"</strong> (o link de redefinição só chega neste e-mail), ou responder a esta mensagem que ajudamos.
        </div>
        <p style="font-size:12px;color:#94a3b8;margin-top:20px">BidPro Brasil — Leilão &amp; Investimentos</p>
      </div>`,
      text: `Olá, ${primeiroNome}!\n\nSua conta grátis (Explorador) na BidPro Brasil foi criada e já está ativa. Acesse em ${loginUrl}.\n\nNão reconhece este cadastro? Se não foi você, alguém pode ter usado o seu e-mail. Assuma o acesso em ${loginUrl} usando "Esqueci minha senha" (o link só chega neste e-mail), ou responda a esta mensagem.\n\nBidPro Brasil — Leilão & Investimentos`,
      meta: { tipo: 'boas_vindas_gratis', user_id: userId },
    });
  } catch { /* best-effort — nunca derruba o cadastro */ }

  return res.status(200).json({ ok: true, userId });
}
