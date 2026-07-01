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
  if (!checkRateLimit(`criar-conta:${ip}`, 5, 60_000).ok) {
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

  const meta = { nome, cpf, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString() };
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
      await sb('perfis?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: userId, nome, cpf: cpf || null, role: 'explorador', lgpd_aceito: true, lgpd_data: meta.lgpd_data }),
      });
    } catch { /* best-effort; app tolera ausência de perfil */ }
  }

  return res.status(200).json({ ok: true, userId });
}
