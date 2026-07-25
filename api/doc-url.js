export const config = { runtime: 'edge' };
import { getAuthUser } from './_auth.js';

// POST /api/doc-url { anexo_id } → { url }
// Re-assina SOB DEMANDA uma URL curta para um documento do imóvel guardado no
// bucket (matrícula/edital/regras…). Necessário porque o `url` gravado em
// imovel_anexos é uma signed URL de 1h (gerar-documental assina com expiresIn:3600)
// que EXPIRA — depois disso o card "Documentos do lote" abria 404 mesmo com o
// arquivo ainda no bucket (storage_path presente). Causa do "armazenamos os
// documentos mas eles não ficam disponíveis": o leitor servia a URL vencida em vez
// de assinar na hora pelo storage_path (o próprio gerar-documental já previa isso —
// "os leitores assinam sob demanda pelo storage_path").
//
// Autorização = o RLS. Lemos o anexo COM O JWT do usuário: se o RLS devolver a
// linha, ele tem direito de ver (matrícula/edital/regras liberados a qualquer
// logado; laudo/outro só à equipe/arrematante). A service key entra apenas no
// passo de assinatura. Nenhuma exposição nova — mesma trava que já libera hoje.
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const CORS = { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'documentos';
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SB || !ANON || !SERVICE) return json({ error: 'Storage não configurado' }, 500);

  // Autenticação (401 limpo p/ token ausente/inválido).
  const user = await getAuthUser(req);
  if (!user?.id) return json({ error: 'Não autenticado' }, 401);
  const token = (req.headers.get('authorization') || req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();

  let body = {};
  try { body = await req.json(); } catch { /* ignore */ }
  if (!isUuid(body?.anexo_id)) return json({ error: 'anexo_id inválido' }, 400);

  // Lê o anexo COM O JWT do usuário → o RLS é a autorização. Se não devolver a
  // linha, o usuário não tem acesso (ou o anexo não existe).
  const r = await fetch(
    `${SB}/rest/v1/imovel_anexos?id=eq.${body.anexo_id}&select=id,storage_path&limit=1`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return json({ error: 'Falha ao consultar anexo' }, 502);
  const [anexo] = await r.json().catch(() => []);
  if (!anexo) return json({ error: 'Acesso negado' }, 403);
  if (!anexo.storage_path) return json({ error: 'Anexo sem arquivo' }, 404);

  // Assina na hora pelo storage_path (service key só para o passo de assinatura).
  const signRes = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${anexo.storage_path}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 1800 }),
  });
  if (!signRes.ok) return json({ error: 'Falha ao assinar' }, 500);
  const { signedURL } = await signRes.json().catch(() => ({}));
  if (!signedURL) return json({ error: 'Falha ao assinar' }, 500);
  return json({ url: `${SB}/storage/v1${signedURL}` });
}
