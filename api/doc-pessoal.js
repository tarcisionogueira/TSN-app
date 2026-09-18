/**
 * /api/doc-pessoal — documentos PESSOAIS do usuário (RG, CPF, comprovante de residência,
 * certidão de casamento, procuração…), anexados pela EQUIPE em nome do cliente.
 *
 * Por que não reusar /api/upload-anexo ou /api/arrematacoes: o primeiro grava em
 * `imovel_anexos` (chave é o IMÓVEL, não a pessoa — misturaria documento pessoal com
 * documento do imóvel); o segundo exige um `arrematacao_id` real na tabela `arrematacoes`
 * (o caso jurídico formal), que não existe para todo item de `arrematados` (o portfólio
 * que o próprio cliente registra em Meus Arrematados). Este endpoint grava direto em
 * `usuario_docs` por `user_id`, sem depender de nenhuma das duas.
 *
 * Upload client-side (Perfil.jsx/ImovelDetalhe.jsx) só funciona quando o UPLOADER é o
 * DONO do documento (RLS exige user_id = auth.uid()). Aqui é a equipe anexando em nome
 * de outra pessoa — por isso precisa de service key (servidor), como upload-anexo.js.
 *
 * GET    ?user_id=X          → lista os documentos pessoais de X
 * POST   multipart/form-data → upload (file, user_id, tipo, descricao?)
 * POST   ?action=abrir  {doc_id} → assina e devolve a URL de leitura
 * DELETE ?doc_id=X           → remove
 *
 * Acesso: staff (admin/consultor/analista/advogado) — mesma equipe já autorizada a
 * anexar documento do arremate em Arrematados.jsx.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BUCKET        = 'documentos';
const ROLES_STAFF   = ['admin', 'consultor', 'analista', 'advogado'];
const MAX_BYTES     = 20 * 1024 * 1024;
const TIPOS_OK = ['pessoal_rg_cnh', 'pessoal_cpf', 'pessoal_comprovante_residencia', 'pessoal_certidao', 'pessoal_procuracao', 'pessoal_outro'];
const TIPO_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/jpg'];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
function storage(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/storage/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...(opts.headers || {}) },
  });
}
function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }); }
const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!SERVICE_KEY || !SUPABASE_URL) return json({ error: 'Storage não configurado' }, 500);

  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);
  const perfilRes = await sb(`perfis?id=eq.${user.id}&select=role`);
  if (!perfilRes.ok) return json({ error: 'Não foi possível confirmar seu acesso' }, 500);
  const [perfil] = await perfilRes.json();
  if (!perfil || !ROLES_STAFF.includes(perfil.role)) return json({ error: 'Acesso restrito à equipe' }, 403);

  const url = new URL(req.url);

  if (req.method === 'GET') {
    const targetUserId = url.searchParams.get('user_id');
    if (!isUuid(targetUserId)) return json({ error: 'user_id inválido' }, 400);
    const r = await sb(`usuario_docs?user_id=eq.${targetUserId}&select=id,tipo,nome,url,tamanho_kb,descricao,criado_em&order=criado_em.desc`);
    if (!r.ok) return json({ error: 'Erro ao listar documentos' }, 500);
    return json({ docs: await r.json() });
  }

  if (req.method === 'POST' && url.searchParams.get('action') === 'abrir') {
    let body; try { body = await req.json(); } catch { body = {}; } // padrao-ok: body inválido/ausente cai no 400 de doc_id abaixo, não precisa de motivo à parte
    if (!isUuid(body?.doc_id)) return json({ error: 'doc_id inválido' }, 400);
    const docRes = await sb(`usuario_docs?id=eq.${body.doc_id}&select=url`);
    if (!docRes.ok) return json({ error: 'Erro ao buscar documento' }, 500);
    const [doc] = await docRes.json();
    if (!doc?.url) return json({ error: 'Documento não encontrado' }, 404);
    // `url` guarda o PATH cru no bucket (mesma convenção do KYC — quem assina é o
    // servidor, na hora, nunca um link de 1 ano gravado no banco).
    if (/^https?:\/\//i.test(doc.url)) return json({ url: doc.url });
    const signRes = await storage(`object/sign/${BUCKET}/${doc.url}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ expiresIn: 1800 }),
    });
    if (!signRes.ok) return json({ error: 'Falha ao assinar documento' }, 500);
    const { signedURL } = await signRes.json().catch(() => ({}));
    if (!signedURL) return json({ error: 'Falha ao assinar documento' }, 500);
    return json({ url: `${SUPABASE_URL}/storage/v1${signedURL}` });
  }

  if (req.method === 'POST') {
    let form;
    try { form = await req.formData(); } catch { return json({ error: 'Envio inválido (esperado multipart/form-data)' }, 400); }
    const file = form.get('file');
    const targetUserId = form.get('user_id');
    const tipo = String(form.get('tipo') || '').toLowerCase();
    const descricao = String(form.get('descricao') || '').trim().slice(0, 300) || null;

    if (!file || typeof file.arrayBuffer !== 'function') return json({ error: 'Arquivo obrigatório' }, 400);
    if (!isUuid(targetUserId)) return json({ error: 'user_id inválido' }, 400);
    if (!TIPOS_OK.includes(tipo)) return json({ error: `tipo inválido (use: ${TIPOS_OK.join(', ')})` }, 400);

    const contentType = file.type || 'application/octet-stream';
    if (!TIPO_MIME.includes(contentType)) return json({ error: 'Formato não suportado (use PDF, JPG ou PNG)' }, 415);
    if (file.size > MAX_BYTES) return json({ error: 'Arquivo excede 20 MB' }, 413);
    const buffer = await file.arrayBuffer();
    if (buffer.byteLength > MAX_BYTES) return json({ error: 'Arquivo excede 20 MB' }, 413);

    // Confere a assinatura real do arquivo — content-type é declarado pelo cliente e forjável.
    const head = new Uint8Array(buffer.slice(0, 4));
    const ehPDF = head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46;
    const ehPNG = head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47;
    const ehJPG = head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    if (!ehPDF && !ehPNG && !ehJPG) return json({ error: 'Conteúdo do arquivo não é um PDF/JPG/PNG válido' }, 415);

    const ext = contentType.includes('pdf') ? 'pdf' : contentType.includes('png') ? 'png' : 'jpg';
    const baseNome = (file.name || `${tipo}.${ext}`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `pessoais/${targetUserId}/${Date.now()}_${baseNome}`;

    const up = await storage(`object/${BUCKET}/${storagePath}`, { method: 'POST', headers: { 'Content-Type': contentType, 'x-upsert': 'true' }, body: buffer });
    if (!up.ok) { console.error('doc-pessoal storage erro:', await up.text()); return json({ error: 'Erro ao salvar no storage' }, 500); }

    const ins = await sb('usuario_docs', {
      method: 'POST',
      body: JSON.stringify({ user_id: targetUserId, tipo, nome: baseNome, url: storagePath, tamanho_kb: Math.round(buffer.byteLength / 1024), descricao }),
    });
    if (!ins.ok) {
      await storage(`object/${BUCKET}/${storagePath}`, { method: 'DELETE' }).catch(() => {});
      console.error('doc-pessoal insert erro:', await ins.text());
      return json({ error: 'Erro ao registrar documento' }, 500);
    }
    const [doc] = await ins.json();
    return json({ ok: true, doc });
  }

  if (req.method === 'DELETE') {
    const docId = url.searchParams.get('doc_id');
    if (!isUuid(docId)) return json({ error: 'doc_id inválido' }, 400);
    const docRes = await sb(`usuario_docs?id=eq.${docId}&select=url`);
    if (!docRes.ok) return json({ error: 'Erro ao buscar documento' }, 500);
    const [doc] = await docRes.json();
    // `.select` prova o que foi apagado — RLS/filtro que não alcance a linha devolve
    // error:null com zero linhas, e sem provar isso a tela afirmaria uma remoção que não
    // houve (mesma lição já aplicada em Arrematados.jsx/delDoc).
    const del = await sb(`usuario_docs?id=eq.${docId}`, { method: 'DELETE', headers: { Prefer: 'return=representation' } });
    if (!del.ok) return json({ error: 'Erro ao remover documento' }, 500);
    const apagados = await del.json().catch(() => []);
    if (!apagados?.length) return json({ error: 'Documento não encontrado' }, 404);
    if (doc?.url && !/^https?:\/\//i.test(doc.url)) await storage(`object/${BUCKET}/${doc.url}`, { method: 'DELETE' }).catch(() => {});
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
