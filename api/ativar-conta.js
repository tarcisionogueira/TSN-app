/**
 * GET /api/ativar-conta?t=<token> — o link do e-mail "Ative sua conta" (inscritos da Homio, 11/11).
 *
 * O token não autentica sozinho: ele acha o lead (pelo hash) e, se a conta ainda espera a senha,
 * gera NA HORA um link de recuperação do Supabase e redireciona para /redefinir-senha. Por isso o
 * link do e-mail vale 30 dias, enquanto o link do Supabase (que expira rápido e é de uso único)
 * nasce só no clique — e um leitor de antivírus que "abre" o link antes da pessoa não o queima.
 *
 * Quem JÁ definiu a senha vai para o login. Token inválido ou vencido também (lá existe
 * "esqueci minha senha", que manda um link novo ao mesmo e-mail).
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getIP } from './_rate-limit.js';
import { hashToken, decidirAtivacao } from './_homio.js';
import { SUPABASE_URL, SERVICE_KEY, APP_URL, sb } from './_homio-io.js';

const admin = SUPABASE_URL && SERVICE_KEY
  ? createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function ir(res, destino) {
  res.setHeader('Cache-Control', 'no-store');
  res.writeHead(302, { Location: destino });
  return res.end();
}

export default async function handler(req, res) {
  const login = (motivo) => ir(res, `${APP_URL}/#/login?ativacao=${motivo}`);
  if (req.method !== 'GET') return res.status(405).end();
  if (!admin) return login('erro');

  const rl = await checkRateLimit(`ativar-conta:${getIP(req)}`, 20, 600_000);
  if (!rl.ok) return login('aguarde');

  const t = String(req.query?.t || '').trim();
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(t)) return login('invalido');

  const r = await sb(`homio_leads?token_hash=eq.${hashToken(t)}&select=id,email,user_id,token_expira_em,ativado_em&limit=1`);
  if (!r.ok) { console.error('[ativar-conta] leitura do lead falhou', r.status); return login('erro'); }
  const [lead] = await r.json().catch(() => []);

  let senhaPendente = true;
  if (lead?.user_id) {
    const p = await sb(`perfis?id=eq.${lead.user_id}&select=senha_pendente&limit=1`);
    if (p.ok) { const [pf] = await p.json().catch(() => []); if (pf) senhaPendente = pf.senha_pendente !== false; }
    else console.error('[ativar-conta] leitura do perfil falhou', p.status); // segue como pendente: na dúvida, deixa definir a senha
  }

  const acao = decidirAtivacao(lead, Date.now(), senhaPendente);
  if (acao === 'login') return login('ja_ativa');
  if (acao !== 'gerar_link') return login(acao);

  try {
    const { data, error } = await admin.auth.admin.generateLink({
      type: 'recovery', email: lead.email, options: { redirectTo: `${APP_URL}/#/redefinir-senha` },
    });
    const link = data?.properties?.action_link || data?.properties?.actionLink;
    if (error || !link) { console.error('[ativar-conta] generateLink falhou', error?.message || 'sem link'); return login('erro'); }
    return ir(res, link);
  } catch (e) {
    console.error('[ativar-conta] generateLink lançou', e?.message || e);
    return login('erro');
  }
}
