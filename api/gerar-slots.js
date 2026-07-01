/**
 * POST /api/gerar-slots
 * Gera slots de 30 min para os próximos N dias com base na disponibilidade_analista.
 * Chamado pelo cron diário ou manualmente pelo admin.
 */
// `export const runtime = 'edge'` (convenção Next) NÃO é reconhecida nestas
// funções /api → rodava no Node e o `new Response()` era ignorado (504). O correto
// aqui é o config.runtime edge — o trabalho é leve (bem abaixo dos 25s do edge).
export const config = { runtime: 'edge' };

import { isCronAuthorized, getAuthUser, getUserRoleById } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const DIAS_FRENTE  = 21; // gera slots para as próximas 3 semanas

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

// Gera array de datas dos próximos DIAS_FRENTE dias
function proxDias(n) {
  const dias = [];
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  for (let i = 1; i <= n; i++) {
    const d = new Date(hoje);
    d.setDate(d.getDate() + i);
    dias.push(d);
  }
  return dias;
}

// Gera slots de 30 min entre hora_inicio e hora_fim
function gerarSlots30min(data, horaInicio, horaFim, analistaId) {
  const slots = [];
  const [hI, mI] = horaInicio.split(':').map(Number);
  const [hF, mF] = horaFim.split(':').map(Number);
  let cur = hI * 60 + mI;
  const fim = hF * 60 + mF;

  while (cur + 30 <= fim) {
    const dt = new Date(data);
    dt.setHours(Math.floor(cur / 60), cur % 60, 0, 0);
    // Converte para UTC assumindo horário de Brasília (UTC-3)
    const utc = new Date(dt.getTime() + 3 * 60 * 60 * 1000);
    slots.push({ analista_id: analistaId, data_hora: utc.toISOString(), duracao_min: 30, disponivel: true });
    cur += 30;
  }
  return slots;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

  // Aceita cron ou admin autenticado
  const isCron = isCronAuthorized(req);
  if (!isCron) {
    const user = await getAuthUser(req);
    if (!user) return new Response('Unauthorized', { status: 401 });
    const role = await getUserRoleById(user.id);
    if (role !== 'admin') return new Response(JSON.stringify({ error: 'Apenas administradores' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  // Busca todas as disponibilidades ativas
  const dispRes = await sb('disponibilidade_analista?ativo=eq.true&select=analista_id,dia_semana,hora_inicio,hora_fim');
  if (!dispRes.ok) return new Response(JSON.stringify({ error: 'Erro ao buscar disponibilidades' }), { status: 500 });
  const disponibilidades = await dispRes.json();

  if (!disponibilidades.length) {
    return new Response(JSON.stringify({ msg: 'Nenhuma disponibilidade cadastrada', gerados: 0 }), { status: 200 });
  }

  const dias = proxDias(DIAS_FRENTE);
  const todosSlots = [];

  for (const dia of dias) {
    const diaSemana = dia.getDay(); // 0=Dom ... 6=Sab
    const disps = disponibilidades.filter(d => d.dia_semana === diaSemana);
    for (const disp of disps) {
      const slots = gerarSlots30min(dia, disp.hora_inicio, disp.hora_fim, disp.analista_id);
      todosSlots.push(...slots);
    }
  }

  if (!todosSlots.length) {
    return new Response(JSON.stringify({ msg: 'Nenhum slot gerado', gerados: 0 }), { status: 200 });
  }

  // Upsert — ignora conflitos (slot já existe)
  const insertRes = await sb('slots_reuniao', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(todosSlots),
  });

  return new Response(JSON.stringify({
    gerados: todosSlots.length,
    ok: insertRes.ok,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
