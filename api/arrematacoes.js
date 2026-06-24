export const config = { runtime: 'edge' };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
};
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

async function getAuthRole(req) {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  try {
    const [authR, perfisR] = await Promise.all([
      fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: SB_KEY, Authorization: `Bearer ${token}` } }),
    ]);
    if (!authR.ok) return null;
    const { id: userId } = await authR.json();
    if (!userId) return null;
    const pr = await fetch(`${SB_URL}/rest/v1/perfis?select=role,nome&id=eq.${userId}&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    if (!pr.ok) return null;
    const [p] = await pr.json();
    return p ? { userId, role: p.role, nome: p.nome } : null;
  } catch { return null; }
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const auth = await getAuthRole(req);
  if (!auth) return json({ error: 'Não autenticado' }, 401);

  const ROLES_ESCRITA = ['admin', 'analista'];
  const ROLES_LEITURA = ['admin', 'analista', 'advogado', 'consultor'];

  // ── GET: busca arrematação pelo imovel_id ou pelo id direto ──
  if (req.method === 'GET') {
    const imovelId = url.searchParams.get('imovel_id');
    const arrId = url.searchParams.get('id');

    // Retorna URL assinada para upload de arquivo
    if (url.searchParams.get('signed_url')) {
      if (!ROLES_ESCRITA.includes(auth.role) && auth.role !== 'advogado') return json({ error: 'Sem permissão' }, 403);
      const arrematacaoId = url.searchParams.get('arrematacao_id') || 'geral';
      const tipo = url.searchParams.get('tipo') || 'outro';
      const nome = url.searchParams.get('nome') || 'documento';
      const tabela = url.searchParams.get('tabela') || 'imovel'; // 'imovel' ou 'usuario'
      const bucket = 'arrematacoes';
      const path = `${arrematacaoId}/${tabela}/${tipo}/${nome}`;

      const signR = await fetch(`${SB_URL}/storage/v1/object/sign/${bucket}/${path}`, {
        method: 'POST',
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 600 }),
      });
      if (!signR.ok) return json({ error: 'Erro ao gerar URL de upload' }, 500);
      const { signedURL } = await signR.json();
      const publicUrl = `${SB_URL}/storage/v1/object/public/${bucket}/${path}`;
      return json({ signedURL: `${SB_URL}/storage/v1${signedURL}`, publicUrl, path });
    }

    if (!imovelId && !arrId) return json({ error: 'imovel_id ou id obrigatório' }, 400);

    const filter = arrId ? `id=eq.${arrId}` : `imovel_id=eq.${imovelId}`;
    const r = await sb(`arrematacoes?${filter}&select=*&order=criado_em.desc&limit=1`);
    if (!r.ok) return json({ error: 'Erro interno' }, 500);
    const [arr] = await r.json();
    if (!arr) return json({ arrematacao: null });

    // Verifica acesso: arrematante ou role com leitura
    if (arr.arrematante_id !== auth.userId && !ROLES_LEITURA.includes(auth.role)) {
      return json({ error: 'Sem permissão' }, 403);
    }

    // Busca anexos do processo e docs pessoais
    const [anexosR, docsR] = await Promise.all([
      sb(`imovel_anexos?arrematacao_id=eq.${arr.id}&select=*&order=criado_em.desc`),
      sb(`usuario_docs?arrematacao_id=eq.${arr.id}&user_id=eq.${auth.userId}&select=*&order=criado_em.desc`),
    ]);
    const anexos = anexosR.ok ? await anexosR.json() : [];
    const docs = docsR.ok ? await docsR.json() : [];

    // Busca nome do arrematante
    const pR = await fetch(`${SB_URL}/rest/v1/perfis?id=eq.${arr.arrematante_id}&select=nome,email&limit=1`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` },
    });
    const [perf] = pR.ok ? await pR.json() : [null];

    return json({ arrematacao: { ...arr, arrematante_nome: perf?.nome, arrematante_email: perf?.email }, anexos, docs });
  }

  // ── POST: cria arrematação ──
  if (req.method === 'POST') {
    if (!ROLES_ESCRITA.includes(auth.role)) return json({ error: 'Sem permissão' }, 403);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    const { imovel_id, arrematante_id, valor_arrematado, data_leilao, leiloeiro, numero_processo, observacoes } = body || {};
    if (!imovel_id || !arrematante_id) return json({ error: 'imovel_id e arrematante_id obrigatórios' }, 400);

    // Cria arrematação
    const r = await sb('arrematacoes', {
      method: 'POST',
      body: JSON.stringify({
        imovel_id, arrematante_id,
        valor_arrematado: valor_arrematado || null,
        data_leilao: data_leilao || null,
        leiloeiro: leiloeiro || null,
        numero_processo: numero_processo || null,
        observacoes: observacoes || null,
        criado_por: auth.userId,
        status: 'em_processo',
      }),
    });
    if (!r.ok) return json({ error: 'Erro ao criar arrematação' }, 500);
    const [arr] = await r.json();

    // Marca imóvel como arrematado e inativo (protege do cleanup do scraper)
    await sb(`imoveis_leilao?id=eq.${imovel_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'arrematado', ativo: false }),
      headers: { Prefer: 'return=minimal' },
    });

    return json({ ok: true, arrematacao: arr });
  }

  // ── PATCH: atualiza arrematação ──
  if (req.method === 'PATCH') {
    if (!ROLES_ESCRITA.includes(auth.role)) return json({ error: 'Sem permissão' }, 403);
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id obrigatório' }, 400);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    const campos = {};
    if (body.status) campos.status = body.status;
    if (body.observacoes !== undefined) campos.observacoes = body.observacoes;
    if (body.valor_arrematado !== undefined) campos.valor_arrematado = body.valor_arrematado;
    if (body.data_leilao !== undefined) campos.data_leilao = body.data_leilao;
    if (body.leiloeiro !== undefined) campos.leiloeiro = body.leiloeiro;
    if (body.numero_processo !== undefined) campos.numero_processo = body.numero_processo;
    campos.atualizado_em = new Date().toISOString();

    const r = await sb(`arrematacoes?id=eq.${id}`, { method: 'PATCH', body: JSON.stringify(campos) });
    if (!r.ok) return json({ error: 'Erro ao atualizar' }, 500);
    const [arr] = await r.json();
    return json({ ok: true, arrematacao: arr });
  }

  // ── POST /anexo: salva registro de anexo após upload ──
  if (req.method === 'POST' && url.searchParams.get('anexo')) {
    const canWrite = ROLES_ESCRITA.includes(auth.role) || auth.role === 'advogado';
    if (!canWrite) return json({ error: 'Sem permissão' }, 403);
    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    const { arrematacao_id, imovel_id, tipo, nome, url: fileUrl, tamanho_kb } = body || {};
    if (!imovel_id || !nome || !fileUrl) return json({ error: 'imovel_id, nome e url obrigatórios' }, 400);

    const r = await sb('imovel_anexos', {
      method: 'POST',
      body: JSON.stringify({ arrematacao_id, imovel_id, tipo: tipo || 'outro', nome, url: fileUrl, tamanho_kb, criado_por: auth.userId, role_criador: auth.role }),
    });
    if (!r.ok) return json({ error: 'Erro ao salvar anexo' }, 500);
    const [anexo] = await r.json();
    return json({ ok: true, anexo });
  }

  // ── DELETE /anexo?id=X ──
  if (req.method === 'DELETE') {
    if (!ROLES_ESCRITA.includes(auth.role)) return json({ error: 'Sem permissão' }, 403);
    const id = url.searchParams.get('id');
    const tabela = url.searchParams.get('tabela') || 'imovel_anexos';
    if (!id) return json({ error: 'id obrigatório' }, 400);
    const allowed = ['imovel_anexos', 'usuario_docs'];
    if (!allowed.includes(tabela)) return json({ error: 'Tabela inválida' }, 400);
    const r = await sb(`${tabela}?id=eq.${id}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
    if (!r.ok) return json({ error: 'Erro ao deletar' }, 500);
    return json({ ok: true });
  }

  return json({ error: 'Método não permitido' }, 405);
}
