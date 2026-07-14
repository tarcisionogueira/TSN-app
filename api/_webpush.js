/**
 * Web Push — VAPID + criptografia de payload (aes128gcm), 100% Web Crypto
 * (roda no Edge Runtime da Vercel, sem dependências Node).
 *
 * Antes o `push-send.js` (1) importava a chave PRIVADA VAPID com format:'raw'
 * (só válido para chave PÚBLICA EC → o import lançava e o JWT nunca era gerado)
 * e (2) mandava o JSON em texto puro com `Content-Encoding: aes128gcm` — o
 * serviço de push/navegador não consegue decifrar → a notificação era descartada.
 * Resultado: push NUNCA chegava. Este módulo corrige os dois pontos:
 *   - JWT VAPID (ES256) importando a chave privada via JWK (d/x/y).
 *   - Payload cifrado conforme RFC 8291 (Message Encryption for Web Push) +
 *     RFC 8188 (aes128gcm content coding). O `keyid` do cabeçalho carrega a
 *     chave pública efêmera do servidor, então NÃO usamos os headers legados
 *     `Crypto-Key`/`Encryption` (esses são do esquema antigo `aesgcm`).
 */

const enc = new TextEncoder();

// ── base64url ↔ bytes ───────────────────────────────────────────────────────
export function b64urlToBytes(b64) {
  const pad = b64.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64.length / 4) * 4, '=');
  const bin = atob(pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
export function bytesToB64url(bytes) {
  let bin = '';
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]);
  return btoa(bin).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function concatBytes(...arrs) {
  const total = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// HKDF (Extract + Expand em uma chamada do Web Crypto): dado (salt, ikm, info)
// devolve L bytes. deriveBits com HKDF faz exatamente Extract(salt,ikm) seguido
// de Expand(info) — que é o que a RFC 8291/8188 pede.
async function hkdf(saltBytes, ikmBytes, infoBytes, length) {
  const key = await crypto.subtle.importKey('raw', ikmBytes, 'HKDF', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: infoBytes },
    key,
    length * 8,
  );
  return new Uint8Array(bits);
}

// ── VAPID JWT (ES256) ───────────────────────────────────────────────────────
// Importa a chave privada como JWK montada a partir do escalar privado (d) e do
// ponto público (x,y). A assinatura do Web Crypto para ECDSA já sai em r||s
// (IEEE P-1363, 64 bytes) — exatamente o formato que o JWT ES256 exige.
export async function gerarVapidJwt(audience, { publicKey, privateKey, subject }) {
  const pub = b64urlToBytes(publicKey); // 65 bytes: 0x04 || X(32) || Y(32)
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY inválida (esperado ponto EC não comprimido de 65 bytes)');
  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: publicKey && privateKey ? bytesToB64url(b64urlToBytes(privateKey)) : undefined,
    x: bytesToB64url(pub.slice(1, 33)),
    y: bytesToB64url(pub.slice(33, 65)),
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject || 'mailto:alertas@bidprobrasil.com.br',
  };
  const headerB64 = bytesToB64url(enc.encode(JSON.stringify(header)));
  const payloadB64 = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const toSign = `${headerB64}.${payloadB64}`;
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(toSign));
  return `${toSign}.${bytesToB64url(new Uint8Array(sig))}`;
}

// ── Criptografia do payload (RFC 8291 + RFC 8188 aes128gcm) ──────────────────
// Devolve o corpo binário pronto para enviar (header || ciphertext).
export async function encriptarPayload(plaintext, { p256dh, auth }) {
  const uaPublic = b64urlToBytes(p256dh); // chave pública do assinante (65 bytes)
  const authSecret = b64urlToBytes(auth); // 16 bytes
  const data = plaintext instanceof Uint8Array ? plaintext : enc.encode(String(plaintext));

  // 1) Par efêmero ECDH do servidor + segredo compartilhado com o assinante.
  const asKeys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', asKeys.publicKey)); // 65 bytes
  const uaPubKey = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, asKeys.privateKey, 256));

  // 2) IKM = HKDF(salt=auth, ikm=ecdh, info="WebPush: info\0"||uaPub||asPub, 32)
  const keyInfo = concatBytes(enc.encode('WebPush: info\0'), uaPublic, asPublic);
  const ikm = await hkdf(authSecret, ecdhSecret, keyInfo, 32);

  // 3) salt de 16 bytes + deriva CEK (16) e NONCE (12) a partir do IKM.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cekBytes = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);

  // 4) Registro único: plaintext || 0x02 (delimitador de último registro).
  const record = concatBytes(data, new Uint8Array([0x02]));
  const cek = await crypto.subtle.importKey('raw', cekBytes, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, cek, record));

  // 5) Cabeçalho aes128gcm: salt(16) || rs(4, big-endian) || idlen(1) || keyid(asPub).
  const rs = 4096;
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, rs, false);
  header[20] = asPublic.length; // 65
  header.set(asPublic, 21);

  return concatBytes(header, ciphertext);
}

/**
 * Envia UMA notificação cifrada para uma subscription.
 * `sub`: { endpoint, p256dh, auth }. `payload`: objeto serializável.
 * `vapid`: { publicKey, privateKey, subject }.
 * Retorna { ok, status } ou { ok:false, erro }.
 */
export async function enviarWebPush(sub, payload, vapid, { ttl = 86400 } = {}) {
  if (!sub?.endpoint || !sub?.p256dh || !sub?.auth) return { ok: false, erro: 'subscription incompleta' };
  if (!vapid?.publicKey || !vapid?.privateKey) return { ok: false, erro: 'VAPID keys ausentes' };
  try {
    const url = new URL(sub.endpoint);
    const audience = `${url.protocol}//${url.host}`;
    const jwt = await gerarVapidJwt(audience, vapid);
    const body = await encriptarPayload(JSON.stringify(payload), sub);

    const res = await fetch(sub.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Encoding': 'aes128gcm',
        Authorization: `vapid t=${jwt},k=${vapid.publicKey}`,
        TTL: String(ttl),
      },
      body,
      signal: AbortSignal.timeout(10000),
    });
    return { ok: res.ok, status: res.status };
  } catch (e) {
    return { ok: false, erro: e?.message || 'erro ao enviar push' };
  }
}
