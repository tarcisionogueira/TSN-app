/**
 * api/_inter.js — porta única para a API PJ do Banco Inter (conta 218211805, integração "Bidpro Brasil").
 *
 * O Inter exige mTLS em TODA chamada (inclusive no token): certificado + chave privada emitidos no
 * Internet Banking, junto com client_id/secret. Os quatro vivem só no painel da Vercel — o repo é
 * PÚBLICO, então aqui só aparecem os NOMES:
 *   INTER_CLIENT_ID · INTER_CLIENT_SECRET · INTER_CONTA
 *   INTER_CERT_BASE64 · INTER_KEY_BASE64  (o arquivo .crt/.key em base64; PEM cru também é aceito)
 *
 * Token: OAuth2 client_credentials, vale 3600 s. Fica em memória da instância e é renovado 5 min
 * antes de vencer — o Inter limita a emissão de tokens, pedir um por chamada esgota a cota.
 *
 * Retorno SEMPRE `{ ok, status, data, erro }` e nunca lança: o chamador precisa distinguir
 * "sem credencial" (`status: 0, erro: 'sem_credencial'`) de "o banco recusou" (status HTTP + corpo).
 * Foi a falta dessa distinção que fez o extrato carimbar `completo: true` sobre um 403 (CLAUDE.md, 10/08).
 */
import https from 'node:https';

const HOST = 'cdpj.partners.bancointer.com.br';
const ESCOPOS = 'extrato.read boleto-cobranca.read boleto-cobranca.write';

const env = (k) => (process.env[k] || '').trim();
// Aceita base64 do arquivo (o que a Vercel guarda sem quebrar linha) ou o PEM colado direto.
const pem = (v) => (!v ? null : v.includes('-----BEGIN') ? v.replace(/\\n/g, '\n') : Buffer.from(v, 'base64').toString('utf8'));

export const interConta = () => env('INTER_CONTA');
export function interConfigurado() {
  return !!(env('INTER_CLIENT_ID') && env('INTER_CLIENT_SECRET') && env('INTER_CERT_BASE64') && env('INTER_KEY_BASE64'));
}

let agente = null;
function getAgente() {
  if (!agente) {
    agente = new https.Agent({ cert: pem(env('INTER_CERT_BASE64')), key: pem(env('INTER_KEY_BASE64')), keepAlive: true });
  }
  return agente;
}

function requisitar(metodo, path, { headers = {}, body = null, timeout = 20000 } = {}) {
  return new Promise((resolve) => {
    const req = https.request({ host: HOST, path, method: metodo, agent: getAgente(), headers, timeout }, (res) => {
      const partes = [];
      res.on('data', (c) => partes.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(partes).toString('utf8');
        let data = null;
        try { data = texto ? JSON.parse(texto) : null; } catch { data = texto; } // padrao-ok: corpo não-JSON (PDF/erro em texto) segue como string
        const ok = res.statusCode >= 200 && res.statusCode < 300;
        resolve({ ok, status: res.statusCode, data: ok ? data : null, erro: ok ? null : (typeof data === 'string' ? data : JSON.stringify(data)).slice(0, 400) });
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolve({ ok: false, status: 0, data: null, erro: `rede: ${e.message}` }));
    if (body) req.write(body);
    req.end();
  });
}

let tokenCache = { valor: null, expiraEm: 0 };
async function getToken() {
  if (tokenCache.valor && Date.now() < tokenCache.expiraEm) return { ok: true, token: tokenCache.valor };
  const corpo = new URLSearchParams({
    client_id: env('INTER_CLIENT_ID'), client_secret: env('INTER_CLIENT_SECRET'),
    grant_type: 'client_credentials', scope: ESCOPOS,
  }).toString();
  const r = await requisitar('POST', '/oauth/v2/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(corpo) },
    body: corpo,
  });
  if (!r.ok || !r.data?.access_token) {
    console.error('[inter] token', r.status, r.erro);
    return { ok: false, status: r.status, erro: r.erro || 'token ausente na resposta' };
  }
  tokenCache = { valor: r.data.access_token, expiraEm: Date.now() + (Number(r.data.expires_in || 3600) - 300) * 1000 };
  return { ok: true, token: tokenCache.valor };
}

/** Chamada autenticada. `json` vira corpo JSON. */
export async function inter(metodo, path, json = null) {
  if (!interConfigurado()) return { ok: false, status: 0, data: null, erro: 'sem_credencial' };
  const t = await getToken();
  if (!t.ok) return { ok: false, status: t.status, data: null, erro: `token: ${t.erro}` };
  const body = json ? JSON.stringify(json) : null;
  const headers = { Authorization: `Bearer ${t.token}`, 'x-conta-corrente': interConta() };
  if (body) { headers['Content-Type'] = 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
  const r = await requisitar(metodo, path, { headers, body });
  if (r.status === 401) tokenCache = { valor: null, expiraEm: 0 }; // token revogado: o próximo pede outro
  if (!r.ok) console.error('[inter]', metodo, path.split('?')[0], r.status, r.erro);
  return r;
}
