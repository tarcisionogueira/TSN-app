/**
 * POST /api/baixar-doc
 * Baixa um documento de uma URL e salva no Supabase Storage (bucket: documentos).
 * Nunca armazena apenas a URL — sempre o arquivo em si.
 *
 * Body: { url, tipo, imovel_id, caso_id?, nome?, data_leilao? }
 * Resposta: { storage_path, url_publica, anexo_id }
 *
 * Acesso: planos pagos (top2, assessorado, clube) + staff
 */

export const runtime = 'edge';

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET       = 'documentos';
const ROLES_PAGOS  = ['top2', 'assessorado', 'clube', 'analista', 'advogado', 'admin'];
const MAX_BYTES    = 20 * 1024 * 1024; // 20 MB

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

function storage(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  const user = await getAuthUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  // Verifica perfil e plano
  const perfRes = await sb(`perfis?id=eq.${user.id}&select=role`);
  const [perfil] = await perfRes.json();
  if (!perfil || !ROLES_PAGOS.includes(perfil.role)) {
    return new Response(JSON.stringify({ error: 'Plano não permite armazenamento de documentos' }), { status: 403 });
  }

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400 }); }

  const { url, tipo = 'outro', imovel_id, caso_id, nome, data_leilao } = body;
  if (!url || !imovel_id) {
    return new Response(JSON.stringify({ error: 'url e imovel_id são obrigatórios' }), { status: 400 });
  }

  // Baixa o arquivo da URL original
  let fileBuffer, contentType, fileName;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    const resp = await fetch(url, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);

    if (!resp.ok) throw new Error(`HTTP ${resp.status} ao baixar ${url}`);

    contentType = resp.headers.get('content-type') || 'application/octet-stream';

    // Verifica tamanho
    const cl = resp.headers.get('content-length');
    if (cl && parseInt(cl) > MAX_BYTES) throw new Error('Arquivo excede 20 MB');

    fileBuffer = await resp.arrayBuffer();
    if (fileBuffer.byteLength > MAX_BYTES) throw new Error('Arquivo excede 20 MB');

    // Infere extensão
    const ext = contentType.includes('pdf') ? 'pdf'
      : contentType.includes('png') ? 'png'
      : contentType.includes('jpeg') || contentType.includes('jpg') ? 'jpg'
      : contentType.includes('word') ? 'docx'
      : 'bin';

    fileName = nome || `${tipo}_${Date.now()}.${ext}`;
  } catch (e) {
    return new Response(JSON.stringify({ error: `Falha ao baixar documento: ${e.message}` }), { status: 422 });
  }

  // Salva no bucket
  const storagePath = `casos/${imovel_id}/${Date.now()}_${fileName.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const uploadRes = await storage(`object/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-upsert': 'true' },
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    const err = await uploadRes.text();
    console.error('baixar-doc storage erro:', err);
    return new Response(JSON.stringify({ error: 'Erro ao salvar no storage' }), { status: 500 });
  }

  const urlPublica = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${storagePath}`;

  // Registra em imovel_anexos
  const insertRes = await sb('imovel_anexos', {
    method: 'POST',
    body: JSON.stringify({
      imovel_id,
      caso_id: caso_id || null,
      tipo,
      nome: fileName,
      url: urlPublica,
      storage_path: storagePath,
      origem_url: url,
      data_leilao: data_leilao || null,
      arrematado: false,
      tamanho_kb: Math.round(fileBuffer.byteLength / 1024),
      criado_por: user.id,
    }),
  });

  if (!insertRes.ok) {
    // Remove arquivo do storage se falhar ao registrar
    await storage(`object/${BUCKET}/${storagePath}`, { method: 'DELETE' });
    const err = await insertRes.text();
    console.error('baixar-doc registrar anexo erro:', err);
    return new Response(JSON.stringify({ error: 'Erro ao registrar anexo' }), { status: 500 });
  }

  const [anexo] = await insertRes.json();
  return new Response(JSON.stringify({ storage_path: storagePath, url_publica: urlPublica, anexo_id: anexo.id }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
