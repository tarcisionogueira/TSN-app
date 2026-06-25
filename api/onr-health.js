/**
 * GET /api/onr-health
 * Healthcheck da integração ONR Digital.
 * - Testa login + chamada AJAX básica
 * - Persiste estado no Supabase (tabela system_health)
 * - Envia email de alerta ao admin se falhar
 * - Chamado pelo cron Vercel toda segunda-feira às 7h
 */

export const config = { runtime: 'edge' };

import { getSession, invalidateSession, onrAjax } from './_onr.js';
import { enviarAlertaOnr } from './_onr-alert.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;

/** Busca último estado salvo de saúde ONR */
async function buscarUltimoEstado() {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/system_health?servico=eq.onr_digital&order=criado_em.desc&limit=1`,
      { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
    );
    const rows = await res.json();
    return rows?.[0] || null;
  } catch { return null; }
}

/** Salva resultado do healthcheck no Supabase */
async function salvarEstado(ok, detalhe) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/system_health`, {
      method: 'POST',
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({
        servico:   'onr_digital',
        ok,
        detalhe,
        criado_em: new Date().toISOString(),
      }),
    });
  } catch {}
}

/** Dormir N ms */
const sleep = ms => new Promise(r => setTimeout(r, ms));

export default async function handler(req) {
  // Aceita cron (Authorization: Bearer CRON_SECRET) ou acesso manual com secret
  const { isCronAuthorized } = await import('./_auth.js');
  const isCron = isCronAuthorized(req);
  const isManual = req.headers.get('x-manual-health') === 'true' && isCron;

  if (!isCron && !isManual) {
    // Acesso manual sem secret: retorna só o último estado salvo
    const ultimo = await buscarUltimoEstado();
    return new Response(JSON.stringify(ultimo || { ok: null, detalhe: 'sem dados' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const ultimoEstado = await buscarUltimoEstado();
  const ultimoSucesso = ultimoEstado?.ok ? ultimoEstado.criado_em : ultimoEstado?.ultimo_sucesso || null;

  let ok = false;
  let detalhe = '';
  let tipoAlerta = null;

  // Tenta até 3 vezes com backoff exponencial
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    try {
      invalidateSession(); // força novo login a cada tentativa

      // 1. Testa login
      const cookie = await getSession();
      if (!cookie) throw new Error('getSession retornou vazio');

      // 2. Testa chamada AJAX básica (listar contratos — método confirmado via DevTools)
      const res = await onrAjax('sitearisp', 'Listagem_contratos', {}, true);

      // Qualquer resposta não-nula = API respondeu
      if (res === undefined || res === null) throw new Error('AJAX retornou nulo');

      ok = true;
      detalhe = `Login OK · AJAX respondeu (${typeof res === 'string' ? res.slice(0, 80) : 'JSON'})`;
      break;

    } catch (err) {
      detalhe = err.message;

      // Classifica o tipo de falha para o alerta
      if (err.message.includes('login falhou') || err.message.includes('credenciais')) {
        tipoAlerta = 'login_falhou';
      } else if (err.message.includes('campo') || err.message.includes('txtEmail') || err.message.includes('btnProsseguir')) {
        tipoAlerta = 'campo_alterado';
      } else if (err.message.includes('fetch') || err.message.includes('network') || err.message.includes('ECONNREFUSED')) {
        tipoAlerta = 'api_indisponivel';
      } else {
        tipoAlerta = 'login_falhou';
      }

      if (tentativa < 3) await sleep(tentativa * 3000); // 3s, 6s
    }
  }

  await salvarEstado(ok, detalhe);

  // Alerta apenas se falhou E (última vez estava ok OU nunca rodou antes)
  if (!ok && tipoAlerta) {
    const deveAlertar = !ultimoEstado || ultimoEstado.ok;
    if (deveAlertar) {
      await enviarAlertaOnr({ tipo: tipoAlerta, detalhe, ultimoSucesso });
    }
  }

  return new Response(JSON.stringify({ ok, detalhe, tentativas: ok ? 1 : 3 }), {
    status: ok ? 200 : 503,
    headers: { 'Content-Type': 'application/json' },
  });
}
