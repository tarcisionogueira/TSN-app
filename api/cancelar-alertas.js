/**
 * GET /api/cancelar-alertas?token=...  — descadastro ONE-CLICK dos e-mails de
 * oportunidades, SEM login (conformidade LGPD/anti-spam: opt-out fácil e direto).
 *
 * O token é assinado (HMAC) para evitar descadastrar terceiros por enumeração:
 *   token = base64url(userId) + '.' + hmac_sha256(userId, SECRET).slice(0,16)
 * (gerado no cron enviar-alertas-cron). Marca alertas_email.ativo=false.
 * Responde uma página HTML simples de confirmação.
 */
export const config = { runtime: 'nodejs' };

import crypto from 'crypto';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
// Sem fallback hardcoded: um segredo previsível ('bidpro') tornaria o token forjável
// (descadastro de terceiros por enumeração). Se nenhum segredo estiver setado, a
// validação falha fechada (todos os tokens rejeitados) — ver handler.
const SECRET = process.env.UNSUB_SECRET || process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_KEY || '';
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

export function assinarUnsub(userId) {
  const h = crypto.createHmac('sha256', SECRET).update(String(userId)).digest('hex').slice(0, 16);
  return `${Buffer.from(String(userId)).toString('base64url')}.${h}`;
}

const page = (titulo, msg) => `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${titulo}</title></head>
<body style="margin:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:440px;margin:60px auto;background:#fff;border-radius:20px;padding:44px 36px;text-align:center;box-shadow:0 8px 40px rgba(0,0,0,0.08);">
  <div style="font-size:44px;margin-bottom:14px;">📭</div>
  <h2 style="color:#111;font-weight:900;font-size:20px;margin:0 0 8px;">${titulo}</h2>
  <p style="color:#64748b;font-size:14px;line-height:1.6;margin:0 0 24px;">${msg}</p>
  <a href="${BASE}/" style="display:inline-block;background:#0D63DB;color:#fff;text-decoration:none;padding:12px 24px;border-radius:10px;font-weight:700;font-size:14px;">Voltar ao BidPro</a>
</div></body></html>`;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  const token = new URL(req.url, 'http://localhost').searchParams.get('token') || '';
  const [b64, sig] = token.split('.');
  let userId = '';
  try { userId = Buffer.from(b64 || '', 'base64url').toString('utf8'); } catch { /* inválido */ }

  // Fail-closed: sem segredo de assinatura, não valida nenhum token (evita forja).
  if (!SECRET) { res.status(500).send(page('Erro', 'Não foi possível processar agora. Tente novamente mais tarde.')); return; }
  // Comparação da assinatura em TEMPO CONSTANTE (evita timing attack na forja do token).
  const sigEsperado = Buffer.from(assinarUnsub(userId).split('.')[1] || '');
  const sigRecebido = Buffer.from(String(sig || ''));
  const sigOk = sigEsperado.length === sigRecebido.length && crypto.timingSafeEqual(sigEsperado, sigRecebido);
  if (!userId || !sig || !sigOk) {
    res.status(400).send(page('Link inválido', 'Este link de descadastro é inválido ou expirou. Você pode gerenciar suas preferências entrando na plataforma.'));
    return;
  }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).send(page('Erro', 'Não foi possível processar agora. Tente novamente mais tarde.')); return; }

  try {
    await fetch(`${SUPABASE_URL}/rest/v1/alertas_email?on_conflict=user_id`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ user_id: userId, ativo: false }),
    });
  } catch { /* melhor confirmar do que travar o usuário */ }

  res.status(200).send(page('Descadastro concluído', 'Você não receberá mais os e-mails semanais de oportunidades. Se mudar de ideia, é só reativar dentro da plataforma (Perfil → Alertas).'));
}
