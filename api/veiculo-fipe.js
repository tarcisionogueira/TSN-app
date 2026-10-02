/**
 * GET /api/veiculo-fipe?id=...   (logado, admin/analista — mesmo nível de acesso da tela
 * /admin/veiculos-leilao, ver App.jsx)
 *
 * On-demand: ao abrir a tela do veículo, busca o valor FIPE se ainda não tiver (ou estiver
 * velho) e grava. Se já tem valor fresco, devolve o cache sem gastar nem 1 chamada da cota
 * diária — a régua de "fresco" é a mesma do cron em lote (RETENTAR_*_DIAS em api/_fipe.js).
 * Cota esgotada não é erro: devolve o que já existe (mesmo velho) com `cota_esgotada: true`,
 * nunca finge que achou um valor que não achou.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 }; // 30 s: pode ler o edital (PDF) para achar o ano

import { getUser, getUserRoleById } from './_auth.js';
import { garantirFipe, COLUNAS_FIPE } from './_fipe-garantir.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  const user = await getUser(req);
  if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }
  const role = await getUserRoleById(user.id);
  if (!['admin', 'analista'].includes(role)) { res.status(403).json({ error: 'Sem acesso' }); return; }

  const params = new URL(req.url, 'http://localhost').searchParams;
  const id = params.get('id');
  if (!id) { res.status(400).json({ error: 'id obrigatório' }); return; }

  const [v] = await (await sb(`veiculos_leilao?id=eq.${encodeURIComponent(id)}&select=${COLUNAS_FIPE}`)).json();
  if (!v) { res.status(404).json({ error: 'Veículo não encontrado' }); return; }
  res.status(200).json(await garantirFipe(v));
}
