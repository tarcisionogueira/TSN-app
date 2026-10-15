/**
 * /api/caso-documentos — documentos do caso organizados pela IA (15/10, pedido do dono). Só equipe.
 *
 *   GET  ?caso_id=<uuid>          → { documentos: [...] }  (lista de caso_documentos, sem links)
 *   GET  ?id=<uuid>               → { url }  (link assinado de 30 min ao arquivo no bucket privado)
 *   POST { id, grupo }            → move o documento de grupo (pessoal / arrematacao / outro)
 *
 * A classificação vem do caso-documentos-cron. A correção manual fica gravada com `corrigido_por`: é o
 * sinal de que a IA errou, e o próprio registro serve de exemplo para revisar o prompt depois.
 * Advogado só vê o caso em que está vinculado (mesma cerca de `casos_advogado`).
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET       = 'documentos';
const ROLES_STAFF  = ['admin', 'consultor', 'analista', 'advogado'];
const GRUPOS       = ['pessoal', 'arrematacao', 'outro'];
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

async function podeVerCaso(perfil, userId, casoId) {
  if (perfil.role !== 'advogado') return true;
  const r = await sb(`casos?id=eq.${casoId}&select=advogado_id`);
  if (!r.ok) return false;
  const [c] = await r.json();
  return c?.advogado_id === userId;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'Servidor não configurado' }, 500);
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const pr = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!pr.ok) return json({ error: 'Não foi possível confirmar seu acesso' }, 500);
  const [perfil] = await pr.json();
  if (!perfil || !ROLES_STAFF.includes(perfil.role)) return json({ error: 'Acesso restrito à equipe' }, 403);

  const url = new URL(req.url);
  if (req.method === 'GET' && url.searchParams.get('caso_id')) {
    const casoId = url.searchParams.get('caso_id');
    if (!isUuid(casoId)) return json({ error: 'caso_id inválido' }, 400);
    if (!(await podeVerCaso(perfil, user.id, casoId))) return json({ error: 'Caso não encontrado' }, 404);
    const r = await sb(`caso_documentos?caso_id=eq.${casoId}&select=id,grupo,tipo,titulo,resumo,data_documento,pessoa,nome,lido,corrigido_por,criado_em&order=data_documento.asc.nullslast,criado_em.asc`);
    if (!r.ok) return json({ error: 'Não foi possível ler os documentos' }, 500);
    // Relatórios do BidPro do imóvel do caso (15/10, dono: "inclua os relatórios mercadológico e documental
    // nos anexos do imóvel"). São os do CLIENTE (user_id = cliente do caso), os mesmos que ele vê.
    const cr = await sb(`casos?id=eq.${casoId}&select=imovel_id,cliente_id,imovel_endereco,imovel_valor,tipo_leilao`);
    if (!cr.ok) return json({ error: 'Não foi possível ler o caso' }, 500);
    const [caso] = await cr.json();
    let relatorios = [];
    let cliente = null;
    if (caso?.imovel_id && caso?.cliente_id) {
      const filtro = `imovel_id=eq.${encodeURIComponent(caso.imovel_id)}&user_id=eq.${caso.cliente_id}&select=status,updated_at&limit=1`;
      const [m, d, l, p] = await Promise.all([
        sb(`analises_mercado?${filtro}`), sb(`analises_documental?${filtro}`), sb(`analises_laudo?${filtro}`),
        sb(`perfis?id=eq.${caso.cliente_id}&select=id,nome,role`),
      ]);
      if (![m, d, l, p].every((x) => x.ok)) return json({ error: 'Não foi possível ler os relatórios do caso' }, 500);
      const [[rm], [rd], [rl], [pc]] = await Promise.all([m.json(), d.json(), l.json(), p.json()]);
      relatorios = [
        { tipo: 'mercadologico', titulo: 'Relatório mercadológico', ...(rm || { status: null }) },
        { tipo: 'documental', titulo: 'Relatório documental', ...(rd || { status: null }) },
        { tipo: 'laudo', titulo: 'Laudo de viabilidade', ...(rl || { status: null }) },
      ];
      cliente = pc || null;
    }
    // O imóvel do caso vai junto: arremate atribuído pela equipe costuma ser lote FORA do acervo, e a tela
    // /analise só gera com o endereço em mãos (mesmo state do Admin em prosseguirGerarRelatorios).
    const m = /([^,—–]+)\/([A-Z]{2})\s*$/.exec(caso?.imovel_endereco || '');
    const imovel = caso ? { endereco: caso.imovel_endereco || '', cidade: m ? m[1].trim() : '', estado: m ? m[2] : '',
      valorMinimo: Number(caso.imovel_valor) || 0, modalidade: /judicial/i.test(caso.tipo_leilao || '') && !/extra/i.test(caso.tipo_leilao || '') ? 'judicial' : 'extrajudicial' } : null;
    return json({ documentos: await r.json(), relatorios, imovel_id: caso?.imovel_id || null, cliente, imovel });
  }

  const docId = req.method === 'GET' ? url.searchParams.get('id') : null;
  let body = null;
  if (req.method === 'POST') { try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); } }
  const id = docId || body?.id;
  if (!isUuid(id)) return json({ error: 'id inválido' }, 400);
  const dr = await sb(`caso_documentos?id=eq.${id}&select=id,caso_id,storage_path,grupo`);
  if (!dr.ok) return json({ error: 'Não foi possível ler o documento' }, 500);
  const [doc] = await dr.json();
  if (!doc || !(await podeVerCaso(perfil, user.id, doc.caso_id))) return json({ error: 'Documento não encontrado' }, 404);

  if (req.method === 'GET') {
    const s = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${doc.storage_path}`, {
      method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ expiresIn: 1800 }),
    });
    if (!s.ok) return json({ error: 'Falha ao abrir o documento' }, 500);
    const { signedURL } = await s.json().catch(() => ({}));
    if (!signedURL) return json({ error: 'Falha ao abrir o documento' }, 500);
    return json({ url: `${SUPABASE_URL}/storage/v1${signedURL}` });
  }

  if (req.method === 'POST') {
    if (perfil.role === 'advogado') return json({ error: 'Só a equipe reorganiza documentos' }, 403);
    if (!GRUPOS.includes(body?.grupo)) return json({ error: 'grupo inválido' }, 400);
    // return=representation: só a linha devolvida prova que a mudança aconteceu.
    const up = await sb(`caso_documentos?id=eq.${id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ grupo: body.grupo, corrigido_por: user.id, corrigido_em: new Date().toISOString(), grupo_ia: doc.grupo }) });
    const linhas = up.ok ? await up.json() : [];
    if (!linhas.length) return json({ error: 'Não foi possível mover o documento' }, 500);
    return json({ ok: true, grupo: linhas[0].grupo });
  }
  return json({ error: 'Método não suportado' }, 405);
}
