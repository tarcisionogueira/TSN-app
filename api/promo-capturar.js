/**
 * POST /api/promo-capturar
 * Captura + ACESSO automático do link promocional unificado (promoção + SDR).
 * Decisão do dono: o acesso é liberado na hora, sem passar por consultor/analista.
 *   1. valida o código do link (ativo + validade)
 *   2. cria a conta já confirmada (role 'explorador') — acesso imediato
 *   3. vincula o cliente ao CONSULTOR QUE CRIOU O LINK (perfis.indicado_por);
 *      se o link não for de um consultor, fica sem dono e o admin distribui depois
 *   4. grava o lead (com respostas) em sdr_leads para monitoramento
 * Depois: plano pago → o front leva ao checkout com o desconto; curso/e-book →
 * o front entra na plataforma (acesso já concedido).
 *
 * Segurança: rate limit por IP; senha mínima; role SEMPRE 'explorador'.
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
  if (!checkRateLimit(`promo-capturar:${ip}`, 6, 60_000).ok) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde um instante e tente de novo.' });
  }

  const b = req.body || {};
  const codigo    = String(b.codigo || '').trim().toUpperCase();
  const nome      = String(b.nome || '').trim();
  const email     = String(b.email || '').trim().toLowerCase();
  const senha     = String(b.senha || '');
  const whatsapp  = String(b.whatsapp || '').replace(/\D/g, '');
  const respostasArr = Array.isArray(b.respostas) ? b.respostas : [];

  if (!codigo) return res.status(400).json({ error: 'Código do link ausente.' });
  if (!nome || !email) return res.status(400).json({ error: 'Preencha nome e e-mail.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (senha.length < 6) return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres.' });
  if (whatsapp.length < 10) return res.status(400).json({ error: 'WhatsApp inválido (com DDD).' });

  // 1) Valida o link.
  const linkRows = await sb(`links_promo?codigo=eq.${encodeURIComponent(codigo)}&ativo=eq.true&select=id,produto,produto_tipo,criado_por,validade_ate`).then(r => r.json()).catch(() => []);
  const link = Array.isArray(linkRows) ? linkRows[0] : null;
  if (!link) return res.status(404).json({ error: 'Link promocional não encontrado ou inativo.' });
  if (link.validade_ate && new Date(link.validade_ate) < new Date()) {
    return res.status(410).json({ error: 'Este link promocional expirou.' });
  }

  // 2) Consultor dono = quem CRIOU o link, se for consultor ativo. Senão sem dono.
  let consultorId = null;
  if (link.criado_por) {
    const [c] = await sb(`perfis?id=eq.${link.criado_por}&select=id,role,ativo`).then(r => r.json()).catch(() => []);
    if (c && c.role === 'consultor' && c.ativo !== false) consultorId = c.id;
  }

  // 3) Cria a conta já confirmada (acesso imediato). role explorador.
  const meta = { nome, whatsapp, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString() };
  const cRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: meta }),
  });
  const cData = await cRes.json().catch(() => ({}));
  let userId = cData?.id || cData?.user?.id || null;
  let jaExistia = false;
  if (!cRes.ok) {
    const msg = String(cData?.msg || cData?.error_description || cData?.error || cData?.message || '');
    if (/already.*(registered|exists)|been registered|duplicate/i.test(msg)) {
      // E-mail já tem conta: não recria; segue (o front loga com a senha informada).
      jaExistia = true;
    } else {
      return res.status(400).json({ error: 'Não foi possível criar a conta.' + (msg ? ` (${msg})` : '') });
    }
  }

  // 4) Perfil: garante telefone e o vínculo com o consultor (carteira). Não
  //    sobrescreve indicado_por de quem já tinha dono (só preenche se estava vazio).
  if (userId) {
    try {
      await sb('perfis?on_conflict=id', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ id: userId, nome, telefone: whatsapp, role: 'explorador', indicado_por: consultorId, lgpd_aceito: true, lgpd_data: meta.lgpd_data }),
      });
    } catch { /* best-effort */ }
  } else if (jaExistia && consultorId) {
    // Conta pré-existente e sem consultor: adota o consultor do link (só se vazio).
    try { await sb(`perfis?email=eq.${encodeURIComponent(email)}&indicado_por=is.null`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ indicado_por: consultorId }) }); } catch { /* best-effort */ }
  }

  // 5) Lead para monitoramento.
  const respostas = {};
  for (const r of respostasArr) {
    const q = String(r?.pergunta || '').trim();
    if (q) respostas[q.slice(0, 200)] = String(r?.resposta ?? '').slice(0, 500);
  }
  try {
    await sb('sdr_leads', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        promo_id: link.id, produto_id: null, nome, whatsapp, email: email || null,
        respostas, user_id: userId, consultor_id: consultorId,
        origem: `Promoção ${codigo}`, status: 'novo',
      }),
    });
  } catch { /* best-effort — a conta já foi criada */ }

  return res.status(200).json({ ok: true, userId, jaExistia, produto: link.produto, produto_tipo: link.produto_tipo || 'plano' });
}
