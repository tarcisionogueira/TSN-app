/**
 * POST /api/codigo-email — prova de posse do e-mail antes de criar conta já confirmada (19/10, #251).
 *   { acao: 'enviar', email }            → manda código de 6 dígitos (15 min) ao e-mail
 *   { acao: 'verificar', email, codigo } → confere e devolve { comprovante } (30 min, ver _comprovante-email.js)
 * Público. Limites: por IP, reenvio a cada 45 s por e-mail, 5 tentativas por código.
 */
export const config = { runtime: 'nodejs' };

import crypto from 'node:crypto';
import { checkRateLimit } from './_rate-limit.js';
import { enviarEmail } from './_email.js';
import { emitirComprovante, hashCodigo } from './_comprovante-email.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const H = () => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' });

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  const b = req.body || {};
  const email = String(b.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 200) return res.status(400).json({ error: 'E-mail inválido.' });
  const reg = `${SUPABASE_URL}/rest/v1/verificacao_email_codigo?email=eq.${encodeURIComponent(email)}`;

  if (b.acao === 'enviar') {
    if (!(await checkRateLimit(`codigo-email:${ip}`, 6, 10 * 60_000)).ok) return res.status(429).json({ error: 'Muitos envios. Aguarde alguns minutos.' });
    const atual = await fetch(`${reg}&select=enviado_em`, { headers: H() });
    if (!atual.ok) return res.status(503).json({ error: 'Não foi possível enviar o código agora. Tente de novo.' });
    const [linha] = await atual.json();
    const espera = linha ? 45 - Math.floor((Date.now() - new Date(linha.enviado_em).getTime()) / 1000) : 0;
    if (espera > 0) return res.status(429).json({ error: `Aguarde ${espera}s para pedir outro código.`, aguarde: espera });
    const codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    const up = await fetch(`${SUPABASE_URL}/rest/v1/verificacao_email_codigo?on_conflict=email`, {
      method: 'POST', headers: { ...H(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ email, codigo_hash: hashCodigo(email, codigo), expira_em: new Date(Date.now() + 15 * 60_000).toISOString(), tentativas: 0, enviado_em: new Date().toISOString() }),
    });
    if (!up.ok) { console.error('[codigo-email] gravar falhou', up.status); return res.status(503).json({ error: 'Não foi possível enviar o código agora. Tente de novo.' }); }
    const env = await enviarEmail({
      to: email, semFila: true, meta: { tipo: 'codigo_verificacao' },
      subject: `${codigo} é o seu código de confirmação — BidPro Brasil`,
      text: `Seu código de confirmação é ${codigo}. Vale por 15 minutos. Se não foi você, ignore este e-mail.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#0f172a"><p style="font-size:15px">Use este código para confirmar o seu e-mail na BidPro Brasil:</p><p style="font-size:32px;font-weight:800;letter-spacing:6px;background:#f1f5f9;border-radius:10px;padding:14px;text-align:center">${codigo}</p><p style="font-size:13px;color:#64748b">Vale por 15 minutos. Se não foi você, ignore este e-mail.</p></div>`,
    }).catch((e) => ({ ok: false, error: e?.message }));
    if (!env?.ok) { console.error('[codigo-email] envio falhou', env?.error); return res.status(502).json({ error: 'Não conseguimos enviar o código para este e-mail. Confira o endereço e tente de novo.' }); }
    return res.status(200).json({ ok: true });
  }

  if (b.acao === 'verificar') {
    if (!(await checkRateLimit(`codigo-email-v:${ip}`, 20, 10 * 60_000)).ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde alguns minutos.' });
    const codigo = String(b.codigo || '').replace(/\D/g, '');
    if (codigo.length !== 6) return res.status(400).json({ error: 'Digite os 6 números do código.' });
    const r = await fetch(`${reg}&select=codigo_hash,expira_em,tentativas`, { headers: H() });
    if (!r.ok) return res.status(503).json({ error: 'Não foi possível conferir agora. Tente de novo.' });
    const [linha] = await r.json();
    if (!linha || new Date(linha.expira_em) < new Date()) return res.status(400).json({ error: 'Código expirado. Peça um novo.', expirado: true });
    if (linha.tentativas >= 5) return res.status(400).json({ error: 'Tentativas esgotadas. Peça um novo código.', expirado: true });
    const a = Buffer.from(hashCodigo(email, codigo)), e = Buffer.from(linha.codigo_hash);
    if (a.length !== e.length || !crypto.timingSafeEqual(a, e)) {
      const inc = await fetch(reg, { method: 'PATCH', headers: { ...H(), Prefer: 'return=minimal' }, body: JSON.stringify({ tentativas: linha.tentativas + 1 }) });
      if (!inc.ok) console.error('[codigo-email] contador de tentativas falhou', inc.status);
      return res.status(400).json({ error: 'Código incorreto.' });
    }
    // Código de uso único: expira já (o comprovante assinado é o que vale daqui em diante).
    const usa = await fetch(reg, { method: 'PATCH', headers: { ...H(), Prefer: 'return=minimal' }, body: JSON.stringify({ expira_em: new Date().toISOString() }) });
    if (!usa.ok) console.error('[codigo-email] consumir código falhou', usa.status);
    return res.status(200).json({ ok: true, comprovante: emitirComprovante(email) });
  }
  return res.status(400).json({ error: 'Ação inválida.' });
}
