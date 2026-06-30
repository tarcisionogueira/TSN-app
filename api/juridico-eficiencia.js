/**
 * GET /api/juridico-eficiencia  (analista/admin)
 * Monitor de eficiência do jurídico: ranking dos advogados por score (taxa de
 * resposta + no prazo + velocidade), da view advogado_eficiencia, e a fila atual
 * (casos em revisão com prazo/atraso). Base para a reatribuição por urgência.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path) { return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }); }

export default async function handler(req) {
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !['analista', 'admin'].includes(perfil.role)) return json({ error: 'Apenas analista/admin' }, 403);

  const ranking = await (await sb(`advogado_eficiencia?select=*`)).json();
  const fila = await (await sb(`casos?juridico_status=eq.em_revisao&select=id,imovel_endereco,advogado_id,juridico_enviado_em,prazo_juridico,juridico_lembretes,juridico_reatribuicoes&order=prazo_juridico.asc.nullslast`)).json();

  const agora = Date.now();
  const filaView = (Array.isArray(fila) ? fila : []).map(c => ({
    ...c,
    atrasado: c.prazo_juridico ? new Date(c.prazo_juridico).getTime() < agora : false,
  }));

  return json({
    ranking: Array.isArray(ranking) ? ranking : [],
    fila: filaView,
    pendentes: filaView.length,
    atrasados: filaView.filter(c => c.atrasado).length,
  });
}
