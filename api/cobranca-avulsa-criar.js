/**
 * POST /api/cobranca-avulsa-criar
 * Admin cria uma cobrança avulsa (motivo + valor livres, fora do catálogo fechado de
 * PROPOSITOS de api/mp-checkout.js) e recebe de volta o link público pra mandar ao
 * cliente/terceiro. Preço nasce AQUI, gravado no banco — api/mp-checkout.js e o webhook
 * sempre leem de `cobrancas_avulsas`, nunca aceitam valor vindo do pagador.
 */
import { getUser, getUserRoleById } from './_auth.js';
import { checkRateLimit, getIP } from './_rate-limit.js';
import { auditLog } from './_audit.js';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const ip = getIP(req);
  const rl = await checkRateLimit(`cobranca-avulsa-criar:${ip}`, 10, 60_000);
  if (!rl.ok) return res.status(429).json({ error: 'Muitas tentativas. Aguarde.' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autorizado' });
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return res.status(403).json({ error: 'Só admin cria cobrança avulsa.' });

  const { descricao, valor, destinatario_nome, destinatario_email } = req.body || {};
  const desc = String(descricao || '').trim();
  const v = Number(valor);
  if (desc.length < 5) return res.status(400).json({ error: 'Descrição obrigatória (mín. 5 caracteres) — explique o motivo da cobrança.' });
  if (!(v > 0)) return res.status(400).json({ error: 'Valor deve ser maior que zero.' });

  try {
    const ins = await fetch(`${SB_URL}/rest/v1/cobrancas_avulsas`, {
      method: 'POST',
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({
        descricao: desc.slice(0, 500), valor: v,
        destinatario_nome: destinatario_nome ? String(destinatario_nome).slice(0, 200) : null,
        destinatario_email: destinatario_email ? String(destinatario_email).slice(0, 200) : null,
        criado_por: user.id,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!ins.ok) {
      const detalhe = await ins.json().catch(() => null);
      return res.status(500).json({ error: detalhe?.message || 'Não foi possível criar a cobrança.' });
    }
    const [criada] = await ins.json();
    await auditLog({ acao: 'cobranca_avulsa_criada', user_id: user.id, ip, detalhes: { id: criada.id, valor: v, descricao: desc }, sucesso: true });
    const base = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
    return res.status(200).json({ ok: true, cobranca: criada, link: `${base}/#/cobranca/${criada.id}` });
  } catch (e) {
    console.error('[cobranca-avulsa-criar]', e?.message || e);
    return res.status(500).json({ error: 'Erro interno ao criar cobrança.' });
  }
}
