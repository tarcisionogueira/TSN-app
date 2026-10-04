/**
 * POST /api/live-presenca  (SOMENTE admin)   Body: { inscricao_id, compareceu: true|false }
 *
 * Presença na aula (05/10, pendência 70): a sala é Google Meet, sem API de presença, então
 * `live_inscricoes.compareceu` só existe se o admin marcar — estava 0/17. Grava pela SERVICE KEY
 * em vez de abrir política de edição na tabela para o front (que guarda nome/e-mail/WhatsApp
 * de inscritos). `return=representation` prova que a linha foi alcançada (forma #3).
 */
export const config = { runtime: 'nodejs', maxDuration: 15 };

import { getUser, getUserRoleById } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido' });
  const user = await getUser(req).catch(() => null);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });
  const role = await getUserRoleById(user.id).catch(() => null);
  if (role !== 'admin') return res.status(403).json({ error: 'Somente admin' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const id = String(req.body?.inscricao_id || '');
  const valor = req.body?.compareceu;
  if (!/^[0-9a-f-]{36}$/i.test(id) || typeof valor !== 'boolean') return res.status(400).json({ error: 'inscricao_id (uuid) e compareceu (boolean) obrigatórios' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/live_inscricoes?id=eq.${id}&select=id,compareceu`, {
    method: 'PATCH',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify({ compareceu: valor }),
  });
  if (!r.ok) return res.status(502).json({ error: `Presença não gravou (HTTP ${r.status})` });
  const linhas = await r.json().catch(() => []);
  if (!linhas.length) return res.status(404).json({ error: 'Inscrição não encontrada — nada foi gravado' });
  return res.status(200).json({ ok: true, compareceu: linhas[0].compareceu });
}
