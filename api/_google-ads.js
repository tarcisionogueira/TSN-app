/**
 * _google-ads.js — Conversão OFFLINE do Google Ads (server-side), DORMENTE até as envs existirem.
 *
 * POR QUE ISTO EXISTE (furo registrado no HANDOFF, seção do marketing): a conversão do Google
 * hoje é disparada no NAVEGADOR, no fim do checkout. Isso funciona para cartão, que confirma na
 * hora — mas **PIX pago depois de o cliente sair do checkout não conta**. O Google nunca fica
 * sabendo da venda, e passa a otimizar as campanhas com dados incompletos: acha que o anúncio
 * não converte, tira verba de onde está vendendo. O Meta já não tem esse buraco porque o CAPI
 * manda a conversão do servidor (_meta-capi.js); aqui é o equivalente para o Google.
 *
 * COMO FUNCIONA: quando o visitante chega por um anúncio, o `gclid` da URL é capturado e
 * gravado em `perfis.mkt_gclid` (first-touch, janela de 90 dias — ver src/utils/marketing.js).
 * Confirmado o pagamento no webhook, mandamos ao Google: "este clique virou venda de R$ X".
 *
 * DEDUPLICAÇÃO: enviamos `orderId` = o mesmo id determinístico do evento do navegador. O Google
 * usa o orderId para não contar a mesma venda duas vezes quando o cliente pagou no cartão (e o
 * evento do navegador já saiu) — mesma ideia do event_id no Meta.
 *
 * SEGURANÇA/CUSTO: best-effort. Qualquer falha é engolida e registrada no log; a ativação do
 * plano NUNCA depende disto. Sem as envs, todas as funções viram no-op silencioso.
 *
 * ENVS (todas no painel da Vercel; nenhuma no repo — o repositório é público):
 *   GOOGLE_ADS_DEVELOPER_TOKEN     token de desenvolvedor da conta MCC (API Center)
 *   GOOGLE_ADS_CUSTOMER_ID         id da conta que roda os anúncios, só dígitos (sem hífens)
 *   GOOGLE_ADS_CONVERSION_ACTION_ID  id numérico da ação de conversão "importada" (offline)
 *   GOOGLE_ADS_REFRESH_TOKEN       refresh token OAuth com escopo .../auth/adwords
 *   GOOGLE_ADS_CLIENT_ID/SECRET    opcionais — sem eles reusa o GOOGLE_OAUTH_CLIENT_ID/SECRET
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID   opcional — id da MCC, quando o acesso é via gerenciadora
 */

const soDigitos = (v) => String(v || '').replace(/\D/g, '');

const DEV_TOKEN = (process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
const CUSTOMER_ID = soDigitos(process.env.GOOGLE_ADS_CUSTOMER_ID);
const ACTION_ID = soDigitos(process.env.GOOGLE_ADS_CONVERSION_ACTION_ID);
const REFRESH = (process.env.GOOGLE_ADS_REFRESH_TOKEN || '').trim();
const CLIENT_ID = (process.env.GOOGLE_ADS_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
const CLIENT_SECRET = (process.env.GOOGLE_ADS_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim();
const LOGIN_CID = soDigitos(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);
const API_VER = (process.env.GOOGLE_ADS_API_VERSION || 'v18').trim();

export function googleAdsAtivo() {
  return !!(DEV_TOKEN && CUSTOMER_ID && ACTION_ID && REFRESH && CLIENT_ID && CLIENT_SECRET);
}

/** Diagnóstico legível: o que falta para ligar (sem revelar valor de env). */
export function googleAdsFaltando() {
  const faltas = [];
  if (!DEV_TOKEN) faltas.push('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!CUSTOMER_ID) faltas.push('GOOGLE_ADS_CUSTOMER_ID');
  if (!ACTION_ID) faltas.push('GOOGLE_ADS_CONVERSION_ACTION_ID');
  if (!REFRESH) faltas.push('GOOGLE_ADS_REFRESH_TOKEN');
  if (!CLIENT_ID) faltas.push('GOOGLE_ADS_CLIENT_ID (ou GOOGLE_OAUTH_CLIENT_ID)');
  if (!CLIENT_SECRET) faltas.push('GOOGLE_ADS_CLIENT_SECRET (ou GOOGLE_OAUTH_CLIENT_SECRET)');
  return faltas;
}

// Cache do access token no escopo do módulo: uma instância quente reaproveita por ~55 min em
// vez de pedir um token novo a cada webhook (o token do Google vale 1h).
let _tok = { valor: null, expiraEm: 0 };

async function accessToken() {
  if (_tok.valor && Date.now() < _tok.expiraEm) return _tok.valor;
  const body = new URLSearchParams({
    grant_type: 'refresh_token', refresh_token: REFRESH,
    client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
  });
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body, signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`oauth ${r.status}: ${(await r.text()).slice(0, 180)}`);
  const j = await r.json();
  if (!j.access_token) throw new Error('oauth sem access_token');
  _tok = { valor: j.access_token, expiraEm: Date.now() + Math.max(60, (j.expires_in || 3600) - 300) * 1000 };
  return _tok.valor;
}

// O Google exige "yyyy-MM-dd HH:mm:ss+|-HH:mm". Fixamos -03:00 (horário de Brasília), que é o
// fuso da operação — mandar UTC sem o deslocamento certo joga a conversão para outro dia.
function dataGoogle(d = new Date()) {
  const br = new Date(d.getTime() - 3 * 3600 * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${br.getUTCFullYear()}-${p(br.getUTCMonth() + 1)}-${p(br.getUTCDate())} `
    + `${p(br.getUTCHours())}:${p(br.getUTCMinutes())}:${p(br.getUTCSeconds())}-03:00`;
}

/**
 * Envia UMA conversão offline. Devolve sempre um objeto (nunca lança).
 * @param {object} p
 * @param {string} p.gclid      clique do anúncio (perfis.mkt_gclid). Sem ele não há o que enviar.
 * @param {number} p.valor      valor da venda em BRL
 * @param {string} [p.orderId]  id determinístico p/ dedup com o evento do navegador
 * @param {Date}   [p.quando]   momento da conversão (padrão: agora)
 */
export async function enviarConversaoOffline({ gclid, valor, orderId, quando } = {}) {
  if (!googleAdsAtivo()) return { skipped: 'google_ads_inativo' };
  const clique = String(gclid || '').trim();
  if (!clique) return { skipped: 'sem_gclid' };          // venda orgânica: nada a atribuir
  const v = Number(valor) || 0;
  if (!(v > 0)) return { skipped: 'valor_zero' };

  const url = `https://googleads.googleapis.com/${API_VER}/customers/${CUSTOMER_ID}:uploadClickConversions`;
  const corpo = {
    conversions: [{
      gclid: clique,
      conversionAction: `customers/${CUSTOMER_ID}/conversionActions/${ACTION_ID}`,
      conversionDateTime: dataGoogle(quando instanceof Date ? quando : new Date()),
      conversionValue: v,
      currencyCode: 'BRL',
      ...(orderId ? { orderId: String(orderId).slice(0, 64) } : {}),
    }],
    // partialFailure: uma conversão problemática volta descrita no corpo em vez de derrubar
    // a chamada inteira — é o que permite logar a causa real em vez de um 400 opaco.
    partialFailure: true,
  };
  try {
    const token = await accessToken();
    const r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'developer-token': DEV_TOKEN,
        ...(LOGIN_CID ? { 'login-customer-id': LOGIN_CID } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(corpo), signal: AbortSignal.timeout(12000),
    });
    const txt = await r.text();
    if (!r.ok) { console.error('[google-ads] HTTP', r.status, txt.slice(0, 300)); return { ok: false, http: r.status }; }
    // partialFailureError chega com HTTP 200 — sem olhar aqui, erro de conversão passaria
    // por sucesso e o furo do PIX continuaria aberto, agora em silêncio.
    let j = {}; try { j = JSON.parse(txt); } catch { /* resposta vazia = ok */ }
    if (j?.partialFailureError) {
      console.error('[google-ads] partialFailure:', JSON.stringify(j.partialFailureError).slice(0, 300));
      return { ok: false, parcial: true };
    }
    return { ok: true };
  } catch (e) {
    console.error('[google-ads] falha:', e?.message || e);
    return { ok: false, erro: String(e?.message || e) };
  }
}
