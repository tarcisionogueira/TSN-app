export const config = { runtime: 'edge' };
import { getUser, getUserRoleById } from './_auth.js';
import { linkExternoDoAnexo } from './_anexo-externo.js';

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

  const [anexo] = await (await sb(`imovel_anexos?id=eq.${body.anexo_id}&select=id,imovel_id,storage_path,url,origem_url&limit=1`)).json().catch(() => []);
  if (!anexo?.id) return json({ error: 'Acesso negado' }, 403);

  // Autorização: equipe OU dono do arrematado daquele imóvel.
  const role = await getUserRoleById(user.id);
  let ok = ['admin', 'analista', 'advogado', 'consultor'].includes(role);
  if (!ok) {
    const [arr] = await (await sb(`arrematados?imovel_id=eq.${encodeURIComponent(String(anexo.imovel_id))}&user_id=eq.${user.id}&select=id&limit=1`)).json().catch(() => []);
    ok = !!arr?.id;
  }
  if (!ok) return json({ error: 'Acesso negado' }, 403);

  // ANEXO QUE MORA NO LEILOEIRO (07/10, relato do dono: "não consigo abrir os anexos").
  // Nem todo anexo tem arquivo NOSSO: o coletor grava o edital e a matrícula do leiloeiro com
  // `origem_url` e `storage_path` nulo — 25 mil linhas hoje. Este endpoint só sabia assinar
  // `storage_path`, então devolvia 404 "Anexo sem arquivo" para um documento que EXISTE e cujo
  // endereço está na própria linha: a tela dizia ao cliente que o arquivo sumiu quando o que
  // faltava era olhar a outra coluna. O link externo é a resposta certa, depois da autorização
  // (que é a mesma: quem não pode ver o anexo não recebe nem o endereço dele).
  if (!anexo.storage_path) {
    const externo = linkExternoDoAnexo(anexo);
    if (externo) return json({ url: externo, externo: true });
    // Sem arquivo e sem endereço: a linha é só um marcador que o leiloeiro nunca preencheu.
    return json({ error: 'O leiloeiro não disponibilizou o arquivo deste anexo.' }, 404);
  }

  const signRes = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${anexo.storage_path}`, {
    method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 1800 }),
  });
  if (!signRes.ok) return json({ error: 'Falha ao assinar' }, 500);
  const { signedURL } = await signRes.json().catch(() => ({}));
  if (!signedURL) return json({ error: 'Falha ao assinar' }, 500);
  return json({ url: `${SB}/storage/v1${signedURL}` });
}
