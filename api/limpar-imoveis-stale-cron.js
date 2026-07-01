/**
 * Cron — desativa imóveis CEF que saíram da Caixa (por estado).
 * Corrige o buraco do sweep do scraper (que filtrava fonte='caixa' enquanto o dado
 * é 'CEF' → nunca removia nada, acumulando imóveis vencidos que davam "imóvel não
 * disponível" ao clicar em Acessar leiloeiro). Chama a RPC segura por-estado.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
// Margem (horas) além da última varredura do estado — conservador p/ não remover
// imóveis de um estado varrido em um run que demorou.
const MARGEM_HORAS = Number(process.env.STALE_MARGEM_HORAS || 24);

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/desativar_imoveis_cef_vencidos`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ margem: `${MARGEM_HORAS} hours` }),
  });
  if (!r.ok) {
    const detalhe = await r.text().catch(() => '');
    return res.status(500).json({ error: 'Falha ao desativar vencidos', detalhe: detalhe.slice(0, 300) });
  }
  const desativados = await r.json().catch(() => 0);
  console.log('[limpar-imoveis-stale]', JSON.stringify({ desativados, margem_horas: MARGEM_HORAS }));
  return res.status(200).json({ ok: true, desativados });
}
