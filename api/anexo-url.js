export const config = { runtime: 'edge' };
import { getUser, getUserRoleById } from './_auth.js';

// POST /api/anexo-url { anexo_id } → { url }
// Assina sob demanda uma URL curta para abrir um anexo do arremate. Acesso: equipe
// (admin/analista/advogado/consultor) OU o dono do arrematado daquele imóvel.
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'documentos';
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

function sb(path, opts = {}) {
  return fetch(`${SB}/rest/v1/${path}`, { ...opts, headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const user = await getUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  if (!SB || !KEY) return json({ error: 'Storage não configurado' }, 500);

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (!isUuid(body?.anexo_id)) return json({ error: 'anexo_id inválido' }, 400);

  const [anexo] = await (await sb(`imovel_anexos?id=eq.${body.anexo_id}&select=id,imovel_id,storage_path&limit=1`)).json().catch(() => []);
  if (!anexo?.storage_path) return json({ error: 'Anexo sem arquivo' }, 404);

  // Autorização: equipe OU dono do arrematado daquele imóvel.
  const role = await getUserRoleById(user.id);
  let ok = ['admin', 'analista', 'advogado', 'consultor'].includes(role);
  if (!ok) {
    const [arr] = await (await sb(`arrematados?imovel_id=eq.${encodeURIComponent(String(anexo.imovel_id))}&user_id=eq.${user.id}&select=id&limit=1`)).json().catch(() => []);
    ok = !!arr?.id;
  }
  if (!ok) return json({ error: 'Acesso negado' }, 403);

  const signRes = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${anexo.storage_path}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 1800 }),
  });
  if (!signRes.ok) return json({ error: 'Falha ao assinar' }, 500);
  const { signedURL } = await signRes.json().catch(() => ({}));
  if (!signedURL) return json({ error: 'Falha ao assinar' }, 500);
  return json({ url: `${SB}/storage/v1${signedURL}` });
}
