/**
 * /api/pagamentos-conferencia — FILA de dinheiro que o webhook NÃO aplicou (pendências 231/232, 20/10).
 *
 * Desde 19/10 o webhook não descarta mais pagamento aprovado: excedente, pagamento de honorário/cobrança já
 * quitado e estorno sobre repasse já creditado vão para `pagamentos_conferencia` (invariante crítico
 * `pagamento_sem_conferencia`). Mas a fila não tinha TELA: o caso alertava uma vez e só saía dali por SQL — que
 * o conector nem roda. Fila que ninguém consegue trabalhar é o mesmo silêncio com um passo a mais.
 *
 *   GET   (admin) → pendentes primeiro, depois os conferidos dos últimos 90 dias.
 *   PATCH (admin) → { id, obs } marca conferido: o que foi feito (devolvido, aplicado à mão, estorno lançado…).
 * Nada é apagado; a decisão de mexer em saldo de terceiro ou devolver segue com a equipe, fora daqui.
 */
export const config = { runtime: 'nodejs', maxDuration: 15 };

import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function db(path, opts = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
    signal: AbortSignal.timeout(10000),
  });
  const t = await r.text();
  let d; try { d = JSON.parse(t); } catch { d = t; }
  return { ok: r.ok, status: r.status, data: d };
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') { res.status(405).json({ error: 'Método não permitido' }); return; }
  const user = await getUser(req);
  if (!user?.id) { res.status(401).json({ error: 'Não autenticado' }); return; }
  const quem = await db(`perfis?id=eq.${user.id}&select=role`);
  if (!quem.ok) { res.status(503).json({ error: 'Não consegui conferir seu acesso agora.' }); return; }
  if (quem.data?.[0]?.role !== 'admin') { res.status(403).json({ error: 'Apenas administrador.' }); return; }

  if (req.method === 'GET') {
    const desde = new Date(Date.now() - 90 * 86400000).toISOString();
    const [pend, feitos] = await Promise.all([
      db('pagamentos_conferencia?conferido_em=is.null&select=*&order=criado_em.asc'),
      db(`pagamentos_conferencia?conferido_em=gte.${desde}&select=*&order=conferido_em.desc`),
    ]);
    // Leitura que falhou não é fila vazia — "nada a conferir" esconderia dinheiro parado.
    if (!pend.ok || !Array.isArray(pend.data) || !feitos.ok || !Array.isArray(feitos.data)) {
      res.status(503).json({ error: 'Não consegui ler a fila agora.' }); return;
    }
    res.status(200).json({ pendentes: pend.data, conferidos: feitos.data });
    return;
  }

  let body = {};
  try { body = typeof req.body === 'object' && req.body ? req.body : JSON.parse(req.body || '{}'); } catch { /* vazio */ }
  const id = Number(body.id);
  const obs = String(body.obs || '').trim().slice(0, 500);
  if (!Number.isInteger(id) || id <= 0) { res.status(400).json({ error: 'Item inválido.' }); return; }
  if (obs.length < 5) { res.status(400).json({ error: 'Escreva o que foi feito (devolvido, aplicado à mão, estorno lançado…).' }); return; }
  // Filtro `conferido_em=is.null` NA escrita + linha devolvida = prova de que mudou (forma 3).
  const up = await db(`pagamentos_conferencia?id=eq.${id}&conferido_em=is.null`, {
    method: 'PATCH',
    body: JSON.stringify({ conferido_em: new Date().toISOString(), conferido_obs: `${obs} — por ${user.email || user.id}` }),
  });
  if (!up.ok) { res.status(500).json({ error: 'Não consegui gravar a conferência.' }); return; }
  if (!Array.isArray(up.data) || !up.data.length) { res.status(409).json({ error: 'Este item já foi conferido.' }); return; }
  res.status(200).json({ ok: true, item: up.data[0] });
}
