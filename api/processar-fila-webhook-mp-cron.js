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
import { processarConfirmado, ativarPlanoDireto, buscarCliente } from './_webhook-core.js';
import { aplicarEfeitosDaCobranca } from './_cobranca-avulsa-efeitos.js';

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

// 08/11 (dono): cobrança avulsa paga ativa o produto e encerra o que ficou pendente nos gateways. Vale para os dois
// webhooks, que só dão a baixa. Falha repete a cada minuto até o teto; depois, pagamentos_sem_baixa() acusa no health-check.
const MAX_TENT_EFEITOS = 10;
async function drenarEfeitosDeCobranca() {
  const r = await sb(`cobrancas_avulsas?status=eq.paga&efeitos_em=is.null&efeitos_tentativas=lt.${MAX_TENT_EFEITOS}&order=pago_em.asc&limit=5&select=id,valor,descricao,destinatario_email,gateway_payment_id,produto_key,produto_ativado_em,efeitos_tentativas`);
  if (!r.ok) { console.error('[efeitos-cobranca] leitura falhou', r.status); return { erro: r.status }; }
  const lista = await r.json();
  let aplicados = 0, falhas = 0;
  for (const cob of lista) {
    // Reserva pela contagem: rodadas sobrepostas não ativam a mesma cobrança.
    const reserva = await sb(`cobrancas_avulsas?id=eq.${cob.id}&efeitos_em=is.null&efeitos_tentativas=eq.${cob.efeitos_tentativas}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ efeitos_tentativas: cob.efeitos_tentativas + 1 }),
    });
    const reservada = reserva.ok ? await reserva.json().catch(() => []) : [];
    if (reservada.length !== 1) continue;
    try {
      const rm = await sb(`mp_pagamentos?external_ref=eq.${encodeURIComponent(`cobranca:${cob.id}`)}&select=mp_payment_id,status,dados_mp`);
      if (!rm.ok) throw new Error(`mp_pagamentos HTTP ${rm.status}`);
      const pagamentos = await rm.json();
      const pagou = pagamentos.find((p) => String(p.mp_payment_id) === String(cob.gateway_payment_id));
      const liquido = Number(pagou?.dados_mp?.transaction_details?.net_received_amount);
      const resultado = await aplicarEfeitosDaCobranca(cob, {
        fetch,
        asaasUrl: process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3',
        asaasKey: (process.env.ASAAS_API_KEY || '').trim(),
        mpToken: process.env.MP_ACCESS_TOKEN,
        mpPendentes: pagamentos.filter((p) => ['pending', 'in_process'].includes(p.status)).map((p) => p.mp_payment_id),
        valorLiquido: liquido > 0 ? liquido : undefined,
        processarConfirmado, ativarPlanoDireto, buscarCliente,
        marcarAtivado: async (id) => {
          const m = await sb(`cobrancas_avulsas?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ produto_ativado_em: new Date().toISOString() }) });
          if (!m.ok) throw new Error(`marcar ativação HTTP ${m.status}`);
        },
      });
      const fim = await sb(`cobrancas_avulsas?id=eq.${cob.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ efeitos_em: new Date().toISOString(), efeitos_erro: null, efeitos_resultado: resultado }),
      });
      if (!fim.ok) throw new Error(`gravar resultado HTTP ${fim.status}`);
      if (resultado.mp_recusadas.length) console.error('[efeitos-cobranca] MP recusou cancelar', cob.id, resultado.mp_recusadas);
      console.log('[efeitos-cobranca]', cob.id, JSON.stringify(resultado));
      aplicados++;
    } catch (e) {
      falhas++;
      const motivo = String(e?.message || e).slice(0, 500);
      console.error('[efeitos-cobranca]', cob.id, motivo);
      const g = await sb(`cobrancas_avulsas?id=eq.${cob.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ efeitos_erro: motivo }) });
      if (!g.ok) console.error('[efeitos-cobranca] erro não registrado', cob.id, g.status);
    }
  }
  return { vistos: lista.length, aplicados, falhas };
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase ausente' }), { status: 500 });

  const agoraISO = new Date().toISOString();
  const livre = `or=(reservado_ate.is.null,reservado_ate.lt.${encodeURIComponent(agoraISO)})`;
  const r = await sb(`mp_webhook_fila?status=eq.pendente&tentativas=lt.${MAX_TENT}&${livre}&order=criado_em.asc&limit=${LOTE}&select=*`);
  if (!r.ok) return new Response(JSON.stringify({ error: 'query da fila falhou' }), { status: 500 });
  const fila = await r.json();

  let processados = 0, falhas = 0;
  for (const item of fila) {
    // 19/10 (#255): RESERVA atômica — rodadas sobrepostas não processam o mesmo evento. Só segue quem
    // conseguiu a linha (PATCH condicional devolve 1 linha); a reserva vence em 5 min se a rodada morrer.
    const rv = await sb(`mp_webhook_fila?id=eq.${item.id}&status=eq.pendente&${livre}`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ reservado_ate: new Date(Date.now() + 5 * 60_000).toISOString() }),
    });
    const reservada = rv.ok ? await rv.json().catch(() => []) : [];
    if (!Array.isArray(reservada) || reservada.length !== 1) continue;
    const fakeReq = { body: item.payload, headers: {} };
    const mockRes = criarResMock();
    try {
      await processarEventoMp(fakeReq, mockRes);
      const ok = mockRes.statusCode >= 200 && mockRes.statusCode < 300;
      if (!ok) throw new Error(`status_${mockRes.statusCode}_${JSON.stringify(mockRes.body).slice(0, 300)}`);
      processados++;
      const fim = await sb(`mp_webhook_fila?id=eq.${item.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'processado', processado_em: new Date().toISOString(), resultado: mockRes.body, reservado_ate: null }),
      });
      if (!fim.ok) console.error('[processar-fila-webhook-mp] processado mas NÃO marcado', item.id, fim.status);
    } catch (e) {
      falhas++;
      const tentativas = (item.tentativas || 0) + 1;
      const esgotou = tentativas >= MAX_TENT;
      const motivo = String(e?.message || e).slice(0, 500);
      await sb(`mp_webhook_fila?id=eq.${item.id}`, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ tentativas, ultimo_erro: motivo, reservado_ate: null, ...(esgotou ? { status: 'falhou' } : {}) }),
      }).then((x) => { if (!x.ok) console.error('[processar-fila-webhook-mp] falha não registrada', item.id, x.status); });
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
  const efeitos = await drenarEfeitosDeCobranca().catch((e) => {
    console.error('[efeitos-cobranca] rodada falhou', e?.message || e);
    return { erro: String(e?.message || e).slice(0, 200) };
  });
  return new Response(JSON.stringify({ ok: true, vistos: fila.length, processados, falhas, efeitos }), { headers: { 'Content-Type': 'application/json' } });
}
