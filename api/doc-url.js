export const config = { runtime: 'edge' };
import { getAuthUser } from './_auth.js';

// POST /api/doc-url { anexo_id } | { anexo_ids: [...] } → { url } | { urls: {id:url} }
// Re-assina SOB DEMANDA uma URL curta para documento(s) do imóvel guardado(s) no
// bucket (matrícula/edital/regras…). Necessário porque o `url` gravado em
// imovel_anexos é uma signed URL de 1h (gerar-documental assina com expiresIn:3600)
// que EXPIRA — depois disso os cards de documento abriam 404 mesmo com o arquivo
// ainda no bucket (storage_path presente). Causa do "armazenamos os documentos mas
// eles não ficam disponíveis": o leitor servia a URL vencida em vez de assinar na
// hora pelo storage_path (o próprio gerar-documental já previa isso).
//
// Autorização = o RLS. Lemos os anexos COM O JWT do usuário: se o RLS devolver a
// linha, ele tem direito de ver (matrícula/edital/regras liberados a qualquer
// logado; laudo/outro só à equipe/arrematante). A service key entra apenas no
// passo de assinatura. Nenhuma exposição nova — mesma trava que já libera hoje.
//
// O modo LOTE (anexo_ids) resolve a tela inteira numa só chamada (menos invocações
// edge por navegação — economia a 10k usuários).
const APP_ORIGIN = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
const CORS = { 'Access-Control-Allow-Origin': APP_ORIGIN, 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const ANON = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'documentos';
const MAX_LOTE = 30; // teto defensivo por chamada
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: CORS });
const isUuid = (s) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(s || ''));

async function assinar(storagePath) {
  const r = await fetch(`${SB}/storage/v1/object/sign/${BUCKET}/${storagePath}`, {
    method: 'POST',
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ expiresIn: 1800 }),
  });
  if (!r.ok) return null;
  const { signedURL } = await r.json().catch(() => ({}));
  return signedURL ? `${SB}/storage/v1${signedURL}` : null;
}

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

  // Conjunto de ids pedidos (single ou lote), validados como uuid e limitados.
  const pedidos = Array.isArray(body?.anexo_ids) ? body.anexo_ids : (body?.anexo_id ? [body.anexo_id] : []);
  const ids = [...new Set(pedidos.filter(isUuid))].slice(0, MAX_LOTE);
  if (!ids.length) return json({ error: 'anexo_id inválido' }, 400);

  // Lê os anexos COM O JWT do usuário → o RLS é a autorização. Só voltam os que ele
  // pode ver; os demais simplesmente não aparecem no resultado. (ids já validados
  // como uuid, então o in-list é seguro sem aspas — mesma convenção do restante.)
  const r = await fetch(
    `${SB}/rest/v1/imovel_anexos?id=in.(${ids.join(',')})&select=id,storage_path`,
    { headers: { apikey: ANON, Authorization: `Bearer ${token}` } },
  );
  if (!r.ok) return json({ error: 'Falha ao consultar anexo' }, 502);
  const linhas = await r.json().catch(() => []);
  const comArquivo = (Array.isArray(linhas) ? linhas : []).filter((a) => a?.storage_path);

  // Assina em paralelo (curta duração) só o que passou pelo RLS e tem arquivo.
  const assinados = await Promise.all(comArquivo.map(async (a) => [a.id, await assinar(a.storage_path)]));
  const urls = {};
  for (const [id, url] of assinados) if (url) urls[id] = url;

  // Modo single: mantém a forma { url } (ou os erros equivalentes) para compatibilidade.
  if (!Array.isArray(body?.anexo_ids)) {
    const url = urls[ids[0]];
    if (!url) {
      const existe = (Array.isArray(linhas) ? linhas : []).some((a) => a?.id === ids[0]);
      return json({ error: existe ? 'Anexo sem arquivo' : 'Acesso negado' }, existe ? 404 : 403);
    }
    return json({ url });
  }
  return json({ urls });
}
