/**
 * /api/track — ingest de eventos de atividade do cliente (navegação, cliques, falhas de API).
 * Alimenta o Cliente 360 (diagnóstico de possíveis falhas). Só registra usuários IDENTIFICADOS
 * (user_id do token — o cliente não escolhe o user_id). Escrita só pelo servidor (service key).
 * Fire-and-forget: nunca quebra o cliente.
 */
export const config = { runtime: 'nodejs', maxDuration: 10 };

import { getUser, getUserRoleById } from './_auth.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const TIPOS = new Set(['pageview', 'click', 'api_erro']);

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).end(); return; }
  try {
    const b = req.body || {};
    const eventos = Array.isArray(b.eventos) ? b.eventos.slice(0, 30) : [];
    if (!eventos.length || !SB || !KEY) { res.status(204).end(); return; }

    let userId = null, role = null;
    try { const u = await getUser(req); userId = u?.id || null; if (userId) role = await getUserRoleById(userId); } catch { /* anônimo */ }
    if (!userId) { res.status(204).end(); return; } // só usuários logados

    const rows = eventos
      .filter((e) => e && TIPOS.has(e.tipo))
      .map((e) => ({
        user_id: userId, role: role || null, tipo: e.tipo,
        rota: (String(e.rota || '').slice(0, 200)) || null,
        alvo: (String(e.alvo || '').slice(0, 200)) || null,
        detalhe: (String(e.detalhe || '').slice(0, 300)) || null,
      }));
    if (rows.length) {
      await fetch(`${SB}/rest/v1/eventos_atividade`, {
        method: 'POST',
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify(rows), signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }
  } catch { /* nunca falha o cliente por causa do track */ }
  res.status(204).end();
}
