/**
 * Cron diário — REGRA DE NÃO-ARREMATAÇÃO.
 * Apaga as análises geradas (analises_mercado) que NÃO foram arrematadas após o
 * leilão. Se arrematado, NUNCA apaga (vira operação real / portfólio).
 *
 *  - data_leilao conhecida  → apaga 15 dias após o leilão sem arrematar.
 *  - sem data_leilao (lote manual etc.) → fallback de 60 dias após a criação.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const DIAS_POS_LEILAO = Number(process.env.ANALISE_LIMPAR_DIAS || 15);
const DIAS_SEM_DATA   = Number(process.env.ANALISE_LIMPAR_DIAS_SEM_DATA || 60);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const corteLeilao = new Date(Date.now() - DIAS_POS_LEILAO * 86400000).toISOString();
  const corteSemData = new Date(Date.now() - DIAS_SEM_DATA * 86400000).toISOString();
  const out = {};

  // Mesma regra para a mercadológica E a documental: 15 dias após o leilão sem
  // arrematar → apaga; sem data → fallback de 60 dias por idade. Arrematado nunca apaga.
  for (const tabela of ['analises_mercado', 'analises_documental']) {
    const r1 = await sb(`${tabela}?arrematado=eq.false&data_leilao=not.is.null&data_leilao=lt.${corteLeilao}&select=id`, { method: 'DELETE' });
    const c1 = r1.ok ? ((await r1.json().catch(() => [])).length || 0) : 0;
    const r2 = await sb(`${tabela}?arrematado=eq.false&data_leilao=is.null&created_at=lt.${corteSemData}&select=id`, { method: 'DELETE' });
    const c2 = r2.ok ? ((await r2.json().catch(() => [])).length || 0) : 0;
    out[tabela] = { por_leilao: c1, sem_data: c2 };
  }

  const total = Object.values(out).reduce((s, v) => s + v.por_leilao + v.sem_data, 0);
  return res.status(200).json({ ok: true, ...out, total });
}
