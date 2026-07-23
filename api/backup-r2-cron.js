/**
 * /api/backup-r2-cron — BACKUP EXTERNO OFF-REGION (Cloudflare R2), para DR.
 *
 * POR QUÊ: o backup diário do Supabase Pro cobre o BANCO (7 dias, MESMA região), mas NÃO
 * cobre o Storage (arquivos), e fica tudo na mesma região (sa-east-1). Para recuperação de
 * desastre com cópia "em local distinto", espelhamos no R2:
 *   1) STORAGE IRRECUPERÁVEL: os uploads do próprio usuário (matrícula manual, KYC, contrato,
 *      comprovantes) — hoje 33 arquivos / ~11 MB. Tudo que é `_auto` (matrícula/edital/anexo
 *      raspado dos leiloeiros, ~14 GB) FICA DE FORA: é recuperável pela própria captura.
 *   2) SNAPSHOT DO NEGÓCIO: as tabelas irrecuperáveis e pequenas (perfis, arremates, índice,
 *      indicadores, planos) viram JSON e vão para o R2 — cópia off-region do estado do negócio,
 *      complementando o backup nativo do banco.
 *
 * DORMENTE POR PADRÃO: sem as env do R2, apenas responde {dormant:true} (nada roda). Ative
 * criando o bucket no Cloudflare e definindo na Vercel:
 *   R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET   (opcional: R2_PREFIX)
 * SigV4 é assinado à mão com o crypto do Node (R2 é S3-compatível) — sem dependência nova.
 *
 * SEGURO/ECONÔMICO: best-effort (nunca derruba), volume minúsculo (11 MB), re-espelha só o
 * que mudou (compara tamanho via HEAD). Autorizado por CRON_SECRET. Registrado no vercel.json.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import crypto from 'node:crypto';
import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const R2 = {
  account: (process.env.R2_ACCOUNT_ID || '').trim(),
  keyId: (process.env.R2_ACCESS_KEY_ID || '').trim(),
  secret: (process.env.R2_SECRET_ACCESS_KEY || '').trim(),
  bucket: (process.env.R2_BUCKET || '').trim(),
  prefix: (process.env.R2_PREFIX || '').trim().replace(/^\/+|\/+$/g, ''),
};
const R2_ON = !!(R2.account && R2.keyId && R2.secret && R2.bucket);

// Tabelas irrecuperáveis e PEQUENAS → snapshot JSON off-region (o banco já tem backup nativo;
// isto é a cópia em local distinto). Fora: imoveis_leilao/editais (recapturáveis pela captura).
const TABELAS_NEGOCIO = [
  'perfis', 'arrematacoes', 'arrematados', 'planos_config',
  'indice_amostra', 'cidade_indicadores', 'leiloeiro_conhecimento',
];

function sbHeaders() { return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` }; }
const sha256hex = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
const hmac = (key, str) => crypto.createHmac('sha256', key).update(str).digest();

// Assinatura AWS SigV4 para um PUT/HEAD único no R2 (region "auto", service "s3").
function assinar(method, key, payloadHash, extraHeaders = {}) {
  const host = `${R2.account}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const uri = '/' + [R2.bucket, ...key.split('/')].map(encodeURIComponent).join('/');
  const headers = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...extraHeaders };
  const signedNames = Object.keys(headers).map((h) => h.toLowerCase()).sort();
  const canonicalHeaders = signedNames.map((h) => `${h}:${String(headers[Object.keys(headers).find((k) => k.toLowerCase() === h)]).trim()}\n`).join('');
  const signedHeaders = signedNames.join(';');
  const canonicalRequest = `${method}\n${uri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(Buffer.from(canonicalRequest))}`;
  const kSigning = hmac(hmac(hmac(hmac('AWS4' + R2.secret, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${R2.keyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { url: `https://${host}${uri}`, headers: { ...headers, Authorization: authorization } };
}

// Tamanho já espelhado no R2 (HEAD) — para re-espelhar só o que mudou. -1 se não existe/erro.
async function r2Tamanho(key) {
  try {
    const { url, headers } = assinar('HEAD', key, sha256hex(Buffer.alloc(0)));
    const r = await fetch(url, { method: 'HEAD', headers, signal: AbortSignal.timeout(15000) });
    if (r.status === 200) return Number(r.headers.get('content-length') || -1);
  } catch { /* trata como ausente */ }
  return -1;
}

async function r2Put(key, body, contentType) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const { url, headers } = assinar('PUT', key, sha256hex(buf), { 'content-type': contentType || 'application/octet-stream' });
  const r = await fetch(url, { method: 'PUT', headers, body: buf, signal: AbortSignal.timeout(60000) });
  return r.ok;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'env Supabase ausente' }); return; }
  if (!R2_ON) { res.status(200).json({ ok: true, dormant: true, motivo: 'R2 não configurado (defina R2_ACCOUNT_ID/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_BUCKET)' }); return; }

  const pfx = R2.prefix ? R2.prefix + '/' : '';
  const out = { storage: { total: 0, enviados: 0, iguais: 0, falhas: 0 }, negocio: { tabelas: 0, falhas: 0 } };

  // 1) STORAGE IRRECUPERÁVEL → R2 (espelha só o que mudou de tamanho)
  try {
    const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/rpc/backup_manifesto_irrecuperaveis`, {
      method: 'POST', headers: { ...sbHeaders(), 'Content-Type': 'application/json' }, body: '{}',
    })).json();
    if (Array.isArray(rows)) {
      out.storage.total = rows.length;
      for (const o of rows) {
        try {
          const destino = `${pfx}storage/${o.bucket}/${o.name}`;
          if ((await r2Tamanho(destino)) === Number(o.tamanho)) { out.storage.iguais++; continue; }
          const dl = await fetch(`${SUPABASE_URL}/storage/v1/object/${o.bucket}/${o.name.split('/').map(encodeURIComponent).join('/')}`, {
            headers: sbHeaders(), signal: AbortSignal.timeout(45000),
          });
          if (!dl.ok) { out.storage.falhas++; continue; }
          const bytes = Buffer.from(await dl.arrayBuffer());
          if (await r2Put(destino, bytes, dl.headers.get('content-type') || 'application/octet-stream')) out.storage.enviados++;
          else out.storage.falhas++;
        } catch { out.storage.falhas++; }
      }
    }
  } catch { /* storage best-effort */ }

  // 2) SNAPSHOT DO NEGÓCIO (tabelas pequenas irrecuperáveis) → R2 como JSON
  const carimbo = new Date().toISOString().slice(0, 10);
  for (const t of TABELAS_NEGOCIO) {
    try {
      const r = await fetch(`${SUPABASE_URL}/rest/v1/${t}?select=*`, { headers: sbHeaders(), signal: AbortSignal.timeout(45000) });
      if (!r.ok) { out.negocio.falhas++; continue; }
      const json = Buffer.from(await r.text());
      if (await r2Put(`${pfx}db/${carimbo}/${t}.json`, json, 'application/json')) out.negocio.tabelas++;
      else out.negocio.falhas++;
    } catch { out.negocio.falhas++; }
  }

  res.status(200).json({ ok: true, r2: `${R2.account}/${R2.bucket}`, ...out });
}
