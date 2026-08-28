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

export async function enviarPurchaseCapi({ userId, email, valor, planoBase, gateway, eventId, testCode } = {}) {
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
  // testCode por chamada (diagnóstico) tem prioridade sobre a env META_CAPI_TEST_CODE.
  const codigoTeste = (testCode || TEST_CODE || '').trim();
  const body = { data: [evento], ...(codigoTeste ? { test_event_code: codigoTeste } : {}) };
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

// ─── LEAD (inscrição na aula ao vivo) ────────────────────────────────────────────────────
//
// POR QUE (28/08): a campanha da aula roda sobre tráfego pago e o Meta só recebia PageView e,
// muito depois, Purchase. Sem um sinal de INSCRIÇÃO, ele otimiza pelo único evento que
// enxerga — o clique — e não há como montar lookalike de inscrito nem público de remarketing.
// Numa campanha de captação é a diferença entre pagar por curioso e pagar por inscrito.
//
// `trackAlertaCriado` (src/utils/gtag.js) já disparava `Lead` no navegador, mas NUNCA foi
// chamada de lugar nenhum — evento definido e nunca emitido é o mesmo que não existir.
//
// O EVENT_ID VEM DAQUI E VOLTA PARA O NAVEGADOR, e essa direção é deliberada. O Purchase
// duplica o formato do id nos dois lados (o comentário acima admite: "MESMO formato no
// cliente"), e duas cópias da mesma regra é uma que vai divergir. Aqui o servidor calcula, o
// cliente recebe pronto na resposta da inscrição, e a deduplicação não depende de ninguém
// lembrar de manter dois arquivos iguais.
export function leadEventId(eventoSlug, email) {
  // Hash do e-mail em vez do e-mail: o id trafega em log e no painel do Meta, e não há
  // motivo para carregar PII em claro num identificador. `slice(16)` é folga de sobra contra
  // colisão dentro de um único evento.
  const h = crypto.createHash('sha256').update(String(email || '').trim().toLowerCase()).digest('hex').slice(0, 16);
  return `lead_${String(eventoSlug || 'live').slice(0, 40)}_${h}`;
}

/**
 * Envia o Lead pelo servidor. Sempre chamado DEPOIS de a inscrição estar gravada — um Lead
 * sobre uma inscrição que falhou ensinaria o Meta a comprar o público errado.
 *
 * Devolve `{ skipped: 'capi_inativo' }` quando falta env. É um "não" por CONFIGURAÇÃO, e por
 * isso ele é NOMEADO em vez de virar um `ok:false` genérico — quem chama registra a diferença
 * (a forma nº 5 do CLAUDE.md: freio de configuração entregue como se fosse resultado).
 */
export async function enviarLeadCapi({
  eventoSlug, email, telefone, nome, cidade, uf, userId, eventId,
  fbc, fbp, clientIp, userAgent, sourceUrl, valor, testCode,
} = {}) {
  if (!capiAtivo()) return { skipped: 'capi_inativo' };
  if (!email) return { skipped: 'sem_email' };

  const user_data = {};
  const em = sha256(email); if (em) user_data.em = em;
  // Telefone no formato que o Meta casa: só dígitos COM código do país e sem '+'.
  const tel = String(telefone || '').replace(/\D/g, '');
  if (tel) {
    const ph = sha256(tel.length <= 11 ? `55${tel}` : tel);
    if (ph) user_data.ph = ph;
  }
  const partes = String(nome || '').trim().split(/\s+/).filter(Boolean);
  if (partes.length) {
    const fn = sha256(partes[0]); if (fn) user_data.fn = fn;
    if (partes.length > 1) { const ln = sha256(partes[partes.length - 1]); if (ln) user_data.ln = ln; }
  }
  // Cidade sem espaço nem acento e UF minúscula — normalização que o Meta exige para casar.
  const ct = sha256(String(cidade || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ''));
  if (ct) user_data.ct = ct;
  const st = sha256(uf); if (st) user_data.st = st;
  if (cidade || uf) user_data.country = sha256('br');
  const ext = sha256(userId); if (ext) user_data.external_id = ext;
  // fbc/fbp e IP/User-Agent são o que mais levanta a qualidade da correspondência. Sem eles o
  // evento chega, mas o Meta casa com muito menos gente — e um Lead que não casa com ninguém
  // não constrói lookalike, que é o motivo de existir deste evento.
  if (fbc) user_data.fbc = fbc;
  if (fbp) user_data.fbp = fbp;
  if (clientIp) user_data.client_ip_address = clientIp;
  if (userAgent) user_data.client_user_agent = userAgent;

  const evento = {
    event_name: 'Lead',
    event_time: Math.floor(Date.now() / 1000),
    action_source: 'website',
    event_source_url: sourceUrl || SITE_URL,
    event_id: eventId || leadEventId(eventoSlug, email),
    user_data,
    custom_data: {
      currency: 'BRL',
      // Valor 0 é legítimo: a inscrição não movimenta dinheiro. O que dá utilidade ao evento
      // é o `content_name` — separa a aula que gerou o lead quando houver mais de uma.
      value: Number(valor) || 0,
      content_name: String(eventoSlug || 'live').slice(0, 60),
      content_category: 'aula_ao_vivo',
    },
  };
  const codigoTeste = (testCode || TEST_CODE || '').trim();
  const body = { data: [evento], ...(codigoTeste ? { test_event_code: codigoTeste } : {}) };
  try {
    const r = await fetch(
      `https://graph.facebook.com/${API_VER}/${PIXEL_ID}/events?access_token=${encodeURIComponent(TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error(`[meta-capi] Lead HTTP ${r.status}:`, t.slice(0, 300));
      return { ok: false, http: r.status };
    }
    return { ok: true, event_id: evento.event_id };
  } catch (e) {
    console.error('[meta-capi] Lead erro:', e?.message || e);
    return { ok: false, erro: String(e?.message || e) };
  }
}
