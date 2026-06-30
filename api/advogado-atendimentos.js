/**
 * GET /api/advogado-atendimentos  (advogado/admin)
 * Devolve os casos do advogado logado com o histórico de e-mails (a demanda
 * enviada + as devolutivas dele) em UM único thread contínuo por caso.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
}

export default async function handler(req) {
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role`)).json();
  if (!perfil || !['advogado', 'admin'].includes(perfil.role)) return json({ error: 'Apenas advogado' }, 403);

  // Casos do advogado (admin vê todos com advogado definido)
  const filtro = perfil.role === 'admin' ? 'advogado_id=not.is.null' : `advogado_id=eq.${user.id}`;
  const casos = await (await sb(`casos?${filtro}&select=id,imovel_endereco,status_etapa,tipo_leilao,juridico_enviado_em&order=juridico_enviado_em.desc.nullslast`)).json();
  if (!Array.isArray(casos) || !casos.length) return json({ atendimentos: [] });

  const ids = casos.map(c => `"${c.id}"`).join(',');
  const emails = await (await sb(`juridico_emails?caso_id=in.(${ids})&select=caso_id,direcao,assunto,corpo,anexos,criado_em&order=criado_em.asc`)).json();
  const porCaso = {};
  for (const e of (Array.isArray(emails) ? emails : [])) (porCaso[e.caso_id] ||= []).push(e);

  const atendimentos = casos.map(c => ({
    caso_id: c.id,
    imovel: c.imovel_endereco,
    tipo_leilao: c.tipo_leilao,
    status_etapa: c.status_etapa,
    // thread contínuo: cada item é uma mensagem da mesma conversa
    thread: (porCaso[c.id] || []).map(e => ({
      tipo: e.direcao === 'saida' ? 'demanda' : 'devolutiva',
      assunto: e.assunto,
      texto: e.corpo,
      anexos: e.anexos || [],
      data: e.criado_em,
    })),
  })).filter(a => a.thread.length);

  return json({ atendimentos });
}
