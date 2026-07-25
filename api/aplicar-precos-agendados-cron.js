/**
 * /api/aplicar-precos-agendados-cron — aplica os preços AGENDADOS (gatilho de preço, passo 8)
 * cuja vigência já chegou. Vira o preço direto no planos_config (fonte única lida pelo front e
 * pelo back), então a partir da virada todo novo checkout já cobra o preço novo. Idempotente:
 * se nada venceu, não faz nada. Roda 1×/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'env ausente' }); return; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/aplicar_precos_agendados`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const aplicados = await r.json().catch(() => null);
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, aplicados });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
