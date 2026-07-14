export const config = { runtime: 'edge' };
import { getUser, getUserRoleById } from './_auth.js';

// POST /api/arrematado-ancora  { arrematado_id, modalidade?, numero_processo? }
// Garante um imóvel-âncora para um arrematado do usuário: sem ele não dá para
// anexar documentos (imovel_anexos exige imovel_id) nem entrar no corpus de
// aprendizado. Cria o imóvel oculto (ativo=false), vincula, semeia o corpus e —
// se houver nº de processo — registra o monitor CNJ. Devolve { imovel_id }.
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Content-Type': 'application/json' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;
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
  if (!SB || !KEY) return json({ error: 'Supabase não configurado' }, 500);

  let body = {};
  try { body = await req.json(); } catch { /* opcional */ }
  const arrematadoId = body?.arrematado_id;
  if (!isUuid(arrematadoId)) return json({ error: 'arrematado_id inválido' }, 400);

  const [arr] = await (await sb(`arrematados?id=eq.${arrematadoId}&select=id,user_id,imovel_id,titulo,cidade,estado,valor_arrematacao,imovel&limit=1`)).json().catch(() => []);
  if (!arr) return json({ error: 'Arrematado não encontrado' }, 404);

  // Dono do arrematado OU equipe (modo suporte).
  const role = await getUserRoleById(user.id);
  const equipe = role === 'admin' || role === 'analista';
  if (arr.user_id !== user.id && !equipe) return json({ error: 'Acesso negado' }, 403);

  // Já tem imóvel-âncora válido? devolve.
  if (isUuid(arr.imovel_id)) {
    const [im] = await (await sb(`imoveis_leilao?id=eq.${arr.imovel_id}&select=id&limit=1`)).json().catch(() => []);
    if (im?.id) return json({ ok: true, imovel_id: arr.imovel_id, criado: false });
  }

  const modalidade = /judicial/i.test(String(body.modalidade || arr.imovel?.modalidade || '')) && !/extra/i.test(String(body.modalidade || arr.imovel?.modalidade || '')) ? 'judicial' : 'extrajudicial';
  const numProc = (String(body.numero_processo || arr.imovel?.numero_processo || '').trim()) || null;
  const valor = Number(arr.valor_arrematacao) || null;

  // Cria o imóvel-âncora oculto.
  const imRes = await sb('imoveis_leilao', {
    method: 'POST', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      fonte: 'arrematado_manual', fonte_id: crypto.randomUUID(),
      titulo: arr.titulo || 'Imóvel arrematado', modalidade,
      estado: arr.estado || null, cidade: arr.cidade || null, valor_minimo: valor,
      numero_processo: numProc, ativo: false,
      descricao: 'Imóvel arrematado (portfólio do cliente) — âncora para documentos e aprendizado da IA.',
    }),
  });
  if (!imRes.ok) return json({ error: 'Falha ao criar o imóvel-âncora', detalhe: await imRes.text().catch(() => '') }, 500);
  const [imovel] = await imRes.json().catch(() => []);
  const imovelId = imovel?.id;
  if (!imovelId) return json({ error: 'Falha ao criar o imóvel-âncora' }, 500);

  await sb(`arrematados?id=eq.${arrematadoId}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ imovel_id: imovelId, updated_at: new Date().toISOString() }) }).catch(() => {});

  // Semeia o corpus de aprendizado.
  try {
    await sb('arremate_aprendizado?on_conflict=imovel_id', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ imovel_id: imovelId, user_id: arr.user_id, modalidade, origem: 'arrematado_usuario', realizado: valor ? { valor_arrematado: valor } : {} }),
    });
  } catch { /* best-effort */ }

  // Monitor CNJ (judicial sempre; extrajudicial só se houver processo de imissão).
  if (numProc) {
    try {
      await sb('processos_monitorados?on_conflict=numero_processo', {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify({ numero_processo: numProc, uf: arr.estado || null, imovel_id: imovelId, rotulo: `Arremate ${modalidade} ${(arr.titulo || '').slice(0, 80)}`.trim(), ativo: true, criado_por: user.id }),
      });
    } catch { /* best-effort */ }
  }

  return json({ ok: true, imovel_id: imovelId, criado: true });
}
