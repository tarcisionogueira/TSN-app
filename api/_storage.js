// Assinatura de documentos SOB DEMANDA — nunca guardamos link de longa duração
// no banco. A partir do storage_path (bucket privado), gera uma signed URL CURTA
// na hora em que o documento vai ser lido/servido. Fecha a exposição de URLs de
// 1 ano gravadas em imovel_anexos.url.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'documentos';

export async function assinarDocumento(storagePath, expiresIn = 3600) {
  if (!storagePath || !SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${storagePath}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn }),
    });
    if (!r.ok) return null;
    const d = await r.json().catch(() => null);
    return d?.signedURL ? `${SUPABASE_URL}/storage/v1${d.signedURL}` : null;
  } catch { return null; }
}

// Dado um anexo {storage_path, url}, devolve uma URL utilizável: assina o
// storage_path (curta) e, se não houver path (linha legada), cai na url gravada.
export async function urlDocumento(anexo, expiresIn = 3600) {
  const assinada = anexo?.storage_path ? await assinarDocumento(anexo.storage_path, expiresIn) : null;
  return assinada || anexo?.url || null;
}
