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

  // ⚠️ `on_conflict` É OBRIGATÓRIO AQUI, e a falta dele parou a agenda por 18 dias (28/08).
  //
  // `resolution=ignore-duplicates` SEM `on_conflict` resolve pela CHAVE PRIMÁRIA. O `id` é
  // gerado, então nunca há conflito de PK — e o lote seguia em frente até bater na UNIQUE real
  // (`slots_reuniao_analista_id_data_hora_key`), que derruba o INSERT INTEIRO com 409.
  //
  // Como o cron gera SEMPRE os próximos 21 dias, todo lote contém dias que já existem. Logo
  // TODO lote falhava, e nenhum slot novo era criado desde 10/08: 126 slots no banco, criados
  // em 01/07, 20/07 e 10/08, e só 6 ainda no futuro. A agenda ia simplesmente acabar em 31/08 —
  // o cliente veria "Nenhum horário disponível" e a reunião, que é o gargalo do produto, ficaria
  // sem porta de entrada.
  //
  // Com o alvo declarado, o conflito é ignorado linha a linha e os dias novos entram.
  const insertRes = await sb('slots_reuniao?on_conflict=analista_id,data_hora', {
    method: 'POST',
    headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(todosSlots),
  });

  // E FALHA ALTO. A versão anterior devolvia HTTP 200 com `ok: false` no corpo: para o cron da
  // Vercel isso é sucesso, então 18 dias de agenda vazia não geraram um único alerta. Um cron
  // que não consegue fazer o trabalho tem de dizer isso no código de status — é a diferença
  // entre um problema que aparece e um que só é descoberto quando o cliente não consegue
  // marcar. `gerados` também passa a distinguir o que foi TENTADO do que foi GRAVADO.
  if (!insertRes.ok) {
    const det = await insertRes.text().catch(() => '');
    console.error('[gerar-slots] INSERT falhou', insertRes.status, det.slice(0, 300));
    return new Response(JSON.stringify({
      error: 'slots_nao_gravados', http: insertRes.status, tentados: todosSlots.length, detalhe: det.slice(0, 300),
    }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    tentados: todosSlots.length,
    ok: true,
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}
