/**
 * _meta-capi.js — Meta Conversions API (server-side), DORMENTE até as envs existirem.
 *
 * Dispara o evento Purchase do SERVIDOR, no webhook de pagamento (confirmação 100%
 * confiável), COMPLEMENTANDO o Pixel do navegador. Bloqueador de anúncio / iOS / aba
 * fechada podem impedir o beacon do Pixel de sair — o CAPI garante que a conversão
 * chega ao Meta mesmo assim, o que é essencial para a otimização de campanha e o ROI.
 *
 * DEDUPLICAÇÃO: o navegador (Pixel) e o servidor (CAPI) enviam o MESMO event_id
 * determinístico (purchaseEventId) → o Meta une os dois numa única conversão em vez
 * de contar em dobro. Quando o Pixel é bloqueado, sobra só o evento do servidor.
 *
 * Liga sozinho quando META_CAPI_TOKEN (+ um pixel id) existirem nas envs. Sem token = no-op.
 */
import crypto from 'crypto';

const PIXEL_ID = (process.env.META_PIXEL_ID || process.env.VITE_META_PIXEL_ID || '').trim();
const TOKEN = (process.env.META_CAPI_TOKEN || '').trim();
// Código de teste opcional (Events Manager → Testar eventos): setar META_CAPI_TEST_CODE
// faz os eventos aparecerem na aba de teste em tempo real; remover volta ao tráfego real.
const TEST_CODE = (process.env.META_CAPI_TEST_CODE || '').trim();
const API_VER = (process.env.META_GRAPH_VERSION || 'v21.0').trim();
const SITE_URL = 'https://www.bidprobrasil.com.br/';

export function capiAtivo() { return !!(PIXEL_ID && TOKEN); }

// SHA-256 minúsculo/trim — formato exigido pelo Meta para os campos de correspondência.
const sha256 = (v) => {
  const s = String(v ?? '').trim().toLowerCase();
  return s ? crypto.createHash('sha256').update(s).digest('hex') : undefined;
};

// event_id determinístico, COMPARTILHADO com o navegador (dedup). MESMO formato no
// cliente (src/utils/gtag.js → trackPlanContratado): pur_<userId>_<planoBase>_<YYYYMMDD UTC>.
// A data no id faz cada cobrança recorrente MENSAL contar como uma conversão distinta,
// enquanto o Pixel + CAPI do MESMO dia deduplicam.
export function purchaseEventId(userId, planoBase, date = new Date()) {
  const dia = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `pur_${userId}_${planoBase || 'plano'}_${dia}`;
}

export async function enviarPurchaseCapi({ userId, email, valor, planoBase, gateway, eventId } = {}) {
  if (!capiAtivo() || !userId) return { skipped: capiAtivo() ? 'sem_user' : 'capi_inativo' };
  const user_data = {};
  const ext = sha256(userId); if (ext) user_data.external_id = ext;
  const em = sha256(email); if (em) user_data.em = em;
  const evId = eventId || purchaseEventId(userId, planoBase);
  const evento = {
    event_name: 'Purchase',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: SITE_URL,
    event_id: evId,
    user_data,
    custom_data: { currency: 'BRL', value: Number(valor) || 0, ...(planoBase ? { content_name: planoBase } : {}) },
  };
  const body = { data: [evento], ...(TEST_CODE ? { test_event_code: TEST_CODE } : {}) };
  try {
    const r = await fetch(
      `https://graph.facebook.com/${API_VER}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error(`[meta-capi] Purchase HTTP ${r.status}:`, t.slice(0, 300));
      return { ok: false, http: r.status };
    }
    return { ok: true, event_id: evId };
  } catch (e) {
    console.error('[meta-capi] Purchase erro:', e?.message || e);
    return { ok: false, erro: String(e?.message || e) };
  }
}
