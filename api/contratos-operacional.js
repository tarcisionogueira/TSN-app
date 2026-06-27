import { getUser, getUserRoleById } from './_auth.js';
import { createClient } from '@supabase/supabase-js';
import { checkRateLimit, getIP, rateLimitedRes } from './_rate-limit.js';
import { auditLog } from './_audit.js';
import { sanitizeText } from './_sanitize.js';
import { TEMPLATES } from './_contratos-templates.js';

const ROLES_PERMITIDOS = ['admin', 'analista', 'advogado', 'consultor'];

export default async function handler(req, res) {
  const ip = getIP(req);
  const rl = checkRateLimit(`contratos-operacional:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedRes(res, rl.resetAt);

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });

  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Apenas administradores podem gerar contratos operacionais' });

  if (req.method !== 'POST') return res.status(405).end();

  const { roleDestino, emailDestinatario, nomeDestinatario } = req.body || {};

  if (!roleDestino || !ROLES_PERMITIDOS.includes(roleDestino)) {
    return res.status(400).json({ error: 'roleDestino inválido. Valores: analista, advogado, consultor' });
  }
  if (!emailDestinatario) return res.status(400).json({ error: 'emailDestinatario obrigatório' });

  const tmpl = TEMPLATES[roleDestino];
  if (!tmpl) return res.status(400).json({ error: `Sem template para role: ${roleDestino}` });

  const conteudo = tmpl.gerar();
  const titulo = sanitizeText(tmpl.titulo, 200);

  try {
    const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    const { data, error } = await supabase.from('contratos_link').insert({
      titulo,
      conteudo,
      tipo_contrato: tmpl.tipo,
      status: 'aguardando_assinatura',
      requer_assinatura: true,
      criado_por: user.id,
      assinante_email: sanitizeText(emailDestinatario, 200),
      verificacao_identidade: 'selfie_doc',
      docs_extras_exigidos: ['comprovante_residencia'],
      gerado_por_ia: false,
    }).select('token').single();

    if (error || !data) {
      console.error('[contratos-operacional] insert error:', error?.message);
      return res.status(500).json({ error: 'Erro ao criar contrato' });
    }

    await auditLog({
      acao: 'contrato_operacional_criado',
      user_id: user.id,
      ip,
      detalhes: { roleDestino, emailDestinatario, titulo, contrato_id: data?.id },
      sucesso: true,
    });

    return res.status(200).json({ ok: true, token: data.token });
  } catch (e) {
    console.error('[contratos-operacional]', e.message);
    return res.status(500).json({ error: 'Erro interno' });
  }
}
