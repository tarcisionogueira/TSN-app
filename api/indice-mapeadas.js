/**
 * GET /api/indice-mapeadas — lista as CIDADES já mapeadas no Índice (amostras de mercado),
 * por volume. Serve para o usuário NAVEGAR/consultar direto (chips) em vez de adivinhar —
 * e reforça que qualquer endereço/bairro/cidade pode ser gerado na hora. Logado (grátis).
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Title-case simples p/ exibir a cidade normalizada ("feira de santana" → "Feira de Santana").
const MINUS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
const titulo = (s) => String(s || '').split(' ').filter(Boolean)
  .map((w, i) => (i > 0 && MINUS.has(w)) ? w : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const headers = { 'Content-Type': 'application/json', ...cors };

  const user = await getUser(req);
  if (!user) return unauthorized();
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ regioes: [] }), { status: 200, headers });

  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/indice_regioes_mapeadas`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_limite: 40 }),
    });
    const rows = r.ok ? (await r.json().catch(() => [])) : [];
    const regioes = (Array.isArray(rows) ? rows : []).map(x => ({
      cidade: titulo(x.cidade_norm), cidade_norm: x.cidade_norm, uf: x.uf,
      n_amostras: x.n_amostras, tipos: x.tipos,
    }));
    return new Response(JSON.stringify({ ok: true, regioes }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, regioes: [], error: e.message }), { status: 200, headers });
  }
}
