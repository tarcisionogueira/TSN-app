/**
 * POST /api/marcar-reuniao  (analista/admin)
 * O analista conclui a reunião com o cliente e registra o parecer de
 * arrematação: 'aprovado' (libera o encaminhamento ao jurídico) ou
 * 'reprovado' (encerra o fluxo). Marca a reunião como 'realizada',
 * avança o caso para 'reuniao_realizada' e registra no Atendimento interno.
 *
 * Body: { caso_id, reuniao_id, parecer: 'aprovado'|'reprovado', observacoes? }
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });
}
function sb(path, { method = 'GET', body, prefer } = {}) {
  const headers = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const [perfil] = await (await sb(`perfis?id=eq.${user.id}&select=role,nome`)).json();
  if (!perfil || !['analista', 'admin'].includes(perfil.role)) return json({ error: 'Apenas analista/admin' }, 403);

  let body; try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const { caso_id, reuniao_id, parecer, observacoes } = body || {};
  if (!caso_id || !reuniao_id) return json({ error: 'caso_id e reuniao_id são obrigatórios' }, 400);
  if (!['aprovado', 'reprovado'].includes(parecer)) return json({ error: "parecer deve ser 'aprovado' ou 'reprovado'" }, 400);

  const [caso] = await (await sb(`casos?id=eq.${encodeURIComponent(caso_id)}&select=id,analista_id,imovel_endereco`)).json();
  if (!caso) return json({ error: 'Caso não encontrado' }, 404);
  // Analista só conclui reunião do próprio caso; admin pode qualquer um.
  if (perfil.role === 'analista' && caso.analista_id && caso.analista_id !== user.id) {
    return json({ error: 'Este caso está atribuído a outro analista.' }, 403);
  }

  const [reuniao] = await (await sb(`reunioes?id=eq.${encodeURIComponent(reuniao_id)}&caso_id=eq.${encodeURIComponent(caso_id)}&select=id,numero,status`)).json();
  if (!reuniao) return json({ error: 'Reunião não encontrada para este caso' }, 404);
  if (reuniao.status === 'cancelada') return json({ error: 'Reunião cancelada não pode ser concluída.' }, 409);

  // Marca a reunião como realizada com o parecer do analista.
  const patchReuniao = {
    status: 'realizada',
    parecer_arrematacao: parecer,
    realizado_em: new Date().toISOString(),
  };
  if (typeof observacoes === 'string' && observacoes.trim()) patchReuniao.observacoes = observacoes.trim();

  const rReu = await sb(`reunioes?id=eq.${encodeURIComponent(reuniao_id)}`, { method: 'PATCH', prefer: 'return=minimal', body: patchReuniao });
  if (!rReu.ok) return json({ error: 'Falha ao atualizar a reunião' }, 502);

  // Avança a etapa do caso (idempotente: só faz sentido a partir da reunião).
  await sb(`casos?id=eq.${encodeURIComponent(caso_id)}`, { method: 'PATCH', prefer: 'return=minimal', body: { status_etapa: 'reuniao_realizada' } });

  // Registro no Atendimento interno (mesma trilha do encaminhamento jurídico).
  const refCurto = String(caso_id).split('-')[0].toUpperCase();
  let [chamado] = await (await sb(`chamados?caso_id=eq.${encodeURIComponent(caso_id)}&segmento=eq.interno&select=id&limit=1`)).json();
  if (!chamado) {
    [chamado] = await (await sb('chamados', { method: 'POST', prefer: 'return=representation',
      body: { user_id: null, user_email: null, user_nome: 'Análise', titulo: `Reunião — ${caso.imovel_endereco || refCurto}`, status: 'em_atendimento', segmento: 'interno', caso_id } })).json();
  }
  if (chamado?.id) {
    const rotulo = parecer === 'aprovado' ? '✅ APROVADO para arrematação' : '⛔ REPROVADO para arrematação';
    const proximo = parecer === 'aprovado'
      ? 'Liberado o encaminhamento ao jurídico.'
      : 'Fluxo de arrematação encerrado — não segue para o jurídico.';
    await sb('chamados_mensagens', { method: 'POST', prefer: 'return=minimal',
      body: {
        chamado_id: chamado.id, autor_id: user.id, autor_nome: perfil.nome || 'Analista', autor_tipo: 'sistema',
        conteudo: `🎥 Reunião ${reuniao.numero === 2 ? '2' : '1'} concluída. Parecer do analista: ${rotulo}. ${proximo}${patchReuniao.observacoes ? `\n\nObservações: ${patchReuniao.observacoes}` : ''}`,
        anexos: [],
      } });
  }

  return json({ ok: true, parecer });
}
