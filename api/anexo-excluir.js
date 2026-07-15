/**
 * POST /api/anexo-excluir { anexo_id }
 * Exclui um anexo do arremate (arquivo no storage + registro em imovel_anexos) e
 * REGISTRA a exclusão em anexo_auditoria (quem/quando). É o caminho único de exclusão
 * pela UI (cliente e admin) — assim toda remoção fica rastreada.
 *
 * Acesso: equipe (admin/analista/advogado/consultor) OU o dono do arrematado daquele
 * imóvel. Usa service key (server-side) para apagar e para gravar o log fora do RLS.
 */
export const config = { runtime: 'edge' };

import { getUser, getUserRoleById } from './_auth.js';
import { atorInfo, logAnexoAudit } from './_anexo-audit.js';

const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
const BUCKET = 'documentos';
const STAFF = ['admin', 'analista', 'advogado', 'consultor'];
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

  const [anexo] = await (await sb(`imovel_anexos?id=eq.${body.anexo_id}&select=id,imovel_id,nome,tipo,storage_path&limit=1`)).json().catch(() => []);
  if (!anexo?.id) return json({ error: 'Anexo não encontrado' }, 404);

  // Autorização: equipe OU dono do arrematado daquele imóvel.
  const role = await getUserRoleById(user.id);
  let ok = STAFF.includes(role);
  if (!ok) {
    const [arr] = await (await sb(`arrematados?imovel_id=eq.${encodeURIComponent(String(anexo.imovel_id))}&user_id=eq.${user.id}&select=id&limit=1`)).json().catch(() => []);
    ok = !!arr?.id;
  }
  if (!ok) return json({ error: 'Acesso negado' }, 403);

  // Remove o registro (fonte da verdade). O arquivo no storage é best-effort.
  const del = await sb(`imovel_anexos?id=eq.${anexo.id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
  if (!del.ok) return json({ error: 'Falha ao remover o anexo', detalhe: await del.text().catch(() => '') }, 500);
  if (anexo.storage_path) {
    await fetch(`${SB}/storage/v1/object/${BUCKET}/${anexo.storage_path}`, { method: 'DELETE', headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } }).catch(() => {});
  }

  // Rastreio da exclusão (best-effort).
  const { nome, role: atorRole } = await atorInfo(user.id);
  await logAnexoAudit({
    imovel_id: anexo.imovel_id, anexo_id: anexo.id, anexo_nome: anexo.nome, anexo_tipo: anexo.tipo,
    acao: 'exclusao', ator_id: user.id, ator_nome: nome, ator_role: atorRole || role || null,
    detalhe: { motivo: (body?.motivo && String(body.motivo).slice(0, 200)) || null },
  });

  return json({ ok: true });
}
