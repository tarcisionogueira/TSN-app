/**
 * /api/processar-fila-webhook-mp-cron — drena `mp_webhook_fila` (o que api/mp-webhook.js
 * enfileira em vez de processar na hora — ver comentário lá). Roda a cada 1 minuto
 * (vercel.json): dinheiro merece o intervalo mais curto que a Vercel permite, não o padrão de
 * 15-30min dos outros drenos deste projeto.
 *
 * Chama `processarEventoMp` — a MESMA função com a lógica de negócio que já existia dentro do
 * webhook (ativar plano, confirmar honorário, creditar comissão etc.), sem duplicar nem
 * reescrever nada dela. Um `res` fake captura o resultado (status/body) em vez de mandar pela
 * rede — assim o cron sabe se deu certo sem a função de negócio precisar saber que está sendo
 * chamada de um lugar diferente.
 *
 * MAX_TENT=5 espelha o padrão já usado em regenerar-relatorios-cron/login-rate: depois de
 * esgotar, marca 'falhou' e alerta por e-mail (alertarErro) em vez de tentar pra sempre — um
 * evento que sempre falha (ex.: bug real, referência que nunca vai existir) não pode represar a
 * fila competindo por espaço com eventos novos e legítimos.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { processarEventoMp } from './mp-webhook.js';
import { alertarErro } from './_error-alert.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MAX_TENT = 5;
const LOTE = 25;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// Captura o resultado de processarEventoMp sem mandar nada pela rede — a função de negócio
// continua achando que está respondendo a uma requisição HTTP de verdade.
function criarResMock() {
  const mock = { statusCode: 200, body: null };
  mock.status = (code) => { mock.statusCode = code; return mock; };
  mock.json = (obj) => { mock.body = obj; return mock; };
  return mock;
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase ausente' }), { status: 500 });

  const r = await sb(`mp_webhook_fila?status=eq.pendente&tentativas=lt.${MAX_TENT}&order=criado_em.asc&limit=${LOTE}&select=*`);
  if (!r.ok) return new Response(JSON.stringify({ error: 'query da fila falhou' }), { status: 500 });
  const fila = await r.json();

  let processados = 0, falhas = 0;
  for (const item of fila) {
    const fakeReq = { body: item.payload, headers: {} };
    const mockRes = criarResMock();
    try {
      await processarEventoMp(fakeReq, mockRes);
      const ok = mockRes.statusCode >= 200 && mockRes.statusCode < 300;
      if (!ok) throw new Error(`status_${mockRes.statusCode}_${JSON.stringify(mockRes.body).slice(0, 300)}`);
      processados++;
      await sb(`mp_webhook_fila?id=eq.${item.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'processado', processado_em: new Date().toISOString(), resultado: mockRes.body }),
      });
    } catch (e) {
      falhas++;
      const tentativas = (item.tentativas || 0) + 1;
      const esgotou = tentativas >= MAX_TENT;
      const motivo = String(e?.message || e).slice(0, 500);
      await sb(`mp_webhook_fila?id=eq.${item.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ tentativas, ultimo_erro: motivo, ...(esgotou ? { status: 'falhou' } : {}) }),
      });
      if (esgotou) {
        console.error('[processar-fila-webhook-mp] esgotou tentativas', item.id, item.mp_topic, item.mp_data_id, motivo);
        alertarErro({
          rota: '/api/processar-fila-webhook-mp-cron',
          erro: `Evento MP esgotou ${MAX_TENT} tentativas sem processar: ${item.mp_topic}/${item.mp_data_id}`,
          extra: { id: item.id, ultimo_erro: motivo },
        });
      }
    }
  }
  return new Response(JSON.stringify({ ok: true, vistos: fila.length, processados, falhas }), { headers: { 'Content-Type': 'application/json' } });
}
