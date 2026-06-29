/**
 * GET/POST /api/admin-chargebacks
 * Retorna os chargebacks (com dossiê de defesa) e os aceites de termos mais
 * recentes, para acompanhamento no painel Admin. Acesso: admin apenas.
 * A tabela `chargebacks` é server-only (RLS sem policy) — por isso passa por aqui.
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) return res.status(401).json({ error: 'Não autenticado' });

  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });

  try {
    const [chargebacks, aceites] = await Promise.all([
      (await sb('chargebacks?select=*&order=aberto_em.desc&limit=300')).json(),
      (await sb('aceites_plano?select=*&order=aceito_em.desc&limit=300')).json(),
    ]);
    return res.status(200).json({
      chargebacks: Array.isArray(chargebacks) ? chargebacks : [],
      aceites: Array.isArray(aceites) ? aceites : [],
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
