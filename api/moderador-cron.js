/**
 * Cron do AGENTE MODERADOR (semanal). Chama a RPC determinística
 * moderador_gerar_insights() — sem LLM (economia) — que destila padrões dos demais
 * agentes (calibração previsto×realizado, custo Bright Data, dívida de mapeamento,
 * saúde das fontes) para a tabela moderador_insights. Retorna os críticos no payload.
 * Autorizado por CRON_SECRET (header x-cron-secret).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/moderador_gerar_insights`, {
      method: 'POST', headers: h, body: '{}', signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return res.status(502).json({ error: `rpc moderador ${r.status}` });
    const total = await r.json().catch(() => null);

    // Retorna os insights que exigem atenção (atencao/critico) para o disparo/relatório.
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/moderador_insights?severidade=in.(atencao,critico)&select=categoria,severidade,agente,titulo,detalhe&order=severidade`, {
      headers: h, signal: AbortSignal.timeout(15000),
    });
    const relevantes = cr.ok ? (await cr.json().catch(() => [])) : [];
    return res.status(200).json({ ok: true, insights_total: total, relevantes });
  } catch (e) {
    return res.status(500).json({ error: String(e.message).slice(0, 200) });
  }
}
