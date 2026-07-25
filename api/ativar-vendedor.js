/**
 * POST /api/ativar-vendedor  { token }
 * Ativa a CAPACIDADE de vender na conta do usuário LOGADO (mantém plano/função).
 * Feito no servidor (service key) porque comissao_afiliado_pct/vendedor_tipo não
 * podem ser auto-definidos pelo cliente — senão qualquer um se daria 100%.
 *   1. valida o convite (ativo + validade)
 *   2. seta vendedor_tipo (afiliado/consultor) + comissao_afiliado_pct do convite
 *   3. gera o código de indicação se ainda não tiver
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';

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
  if (req.method === 'OPTIONS') { res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization'); return res.status(204).end(); }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Faça login para ativar a venda na sua conta.' });

  // VENDA AVULSA (afiliado/consultor) ENCERRADA — substituída pelo Programa de Parceiros (MLM).
  // Nenhum convite ativa mais o papel de vendedor; todos ganham indicando e sendo pagantes.
  return res.status(410).json({ error: 'O programa de venda avulsa foi encerrado. Participe do Programa de Parceiros na sua conta — indique com seu link e receba as comissões sendo assinante em dia.' });
  /* eslint-disable no-unreachable */

  const token = String((req.body || {}).token || '').trim();
  if (!token) return res.status(400).json({ error: 'Convite ausente.' });

  const [conv] = await sb(`convites_vendedor?token=eq.${encodeURIComponent(token)}&ativo=eq.true&select=tipo,comissao_pct,expira_em`).then(r => r.json()).catch(() => []);
  if (!conv) return res.status(404).json({ error: 'Convite inválido ou desativado.' });
  if (conv.expira_em && new Date(conv.expira_em) < new Date()) return res.status(410).json({ error: 'Convite expirado.' });

  // Consultor APOSENTADO (o MLM/Programa de Parceiros o substitui): qualquer convite — mesmo
  // um legado com tipo='consultor' — passa a ativar como AFILIADO (só comissão, sem carteira).
  const tipo = 'afiliado';
  const pct = Math.max(0, Math.min(100, Number(conv.comissao_pct) || 0));

  // Gera código de indicação se ainda não tiver (RPC já existente).
  let codigo = null;
  const [perf] = await sb(`perfis?id=eq.${user.id}&select=codigo_indicacao`).then(r => r.json()).catch(() => []);
  codigo = perf?.codigo_indicacao || null;
  if (!codigo) {
    try {
      const rc = await sb('rpc/gerar_codigo_indicacao', { method: 'POST', body: JSON.stringify({ p_id: user.id }) });
      codigo = await rc.json().catch(() => null);
    } catch { /* segue sem código */ }
  }

  const patch = await sb(`perfis?id=eq.${user.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ vendedor_tipo: tipo, comissao_afiliado_pct: pct }),
  });
  if (!patch.ok) {
    const t = await patch.text().catch(() => '');
    return res.status(500).json({ error: 'Falha ao ativar.', detalhe: t.slice(0, 200) });
  }

  // Single-use: desativa o convite após ativar (não pode ser reutilizado — um token
  // concede um % de comissão, então não deve valer para vários cadastros).
  await sb(`convites_vendedor?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ ativo: false }),
  }).catch(() => {});

  return res.status(200).json({ ok: true, tipo, comissao_pct: pct, codigo });
}
