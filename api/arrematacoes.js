import { getAuthUser, unauthorized, forbidden } from './_auth.js';
import { sanitizeText } from './_sanitize.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const CORS = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

async function dbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { ok: res.ok, status: res.status, data };
}

async function getRoleFor(userId) {
  const r = await dbFetch(`perfis?id=eq.${userId}&select=role`);
  return r.data?.[0]?.role || null;
}

// Herda a equipe já sorteada no caso (analista na reunião, advogado no jurídico).
// O sorteio NÃO acontece aqui — apenas reaproveita quem o fluxo já definiu.
async function equipeDoCaso(imovel_id, cliente_id) {
  const r = await dbFetch(`casos?imovel_id=eq.${imovel_id}&cliente_id=eq.${cliente_id}&select=analista_id,advogado_id&order=criado_em.desc&limit=1`);
  const c = r.data?.[0] || {};
  return { analista_id: c.analista_id || null, advogado_id: c.advogado_id || null };
}

// Distribui o honorário de êxito (10% do valor) no ledger. Idempotente.
// Envolvidos = os DESIGNADOS no fluxo daquele cliente: advogado/analista por sorteio
// no caso; consultor = quem CAPTOU (indicado_por). O ADMIN é BACKUP — absorve a fatia
// de cada papel SEM pessoa designada. Se o admin editou o split da operação
// (arr.honorarios_split), esse override vale sobre config/designação — só para ela.
async function distribuirHonorarios(arr) {
  if (!arr || arr.honorarios_status === 'distribuido') return null;
  const valor = Number(arr.valor_arrematado || 0);
  if (valor <= 0) return null;

  const split = arr.honorarios_split && typeof arr.honorarios_split === 'object' ? arr.honorarios_split : null;
  const cfg = split
    || (await dbFetch('config_honorarios?id=eq.1&select=admin_pct,advogado_pct,analista_pct,consultor_pct')).data?.[0]
    || { admin_pct: 4.5, advogado_pct: 5, analista_pct: 0.5, consultor_pct: 0 };
  const adminRow = (await dbFetch('perfis?role=eq.admin&ativo=eq.true&select=id&order=criado_em.asc&limit=1')).data?.[0];

  // Quem recebe cada papel: do override (se editado), senão os designados no fluxo.
  const advogadoId  = split?.advogado_id  ?? arr.advogado_id  ?? null;
  const analistaId  = split?.analista_id  ?? arr.analista_id  ?? null;
  let   consultorId = split?.consultor_id ?? null;
  // Consultor não editado = quem captou o cliente (indicado_por), se for consultor ativo.
  if (consultorId == null && arr.cliente_id) {
    const cli = (await dbFetch(`perfis?id=eq.${arr.cliente_id}&select=indicado_por`)).data?.[0];
    if (cli?.indicado_por) {
      const ind = (await dbFetch(`perfis?id=eq.${cli.indicado_por}&select=id,role,ativo`)).data?.[0];
      if (ind && ind.role === 'consultor' && ind.ativo !== false) consultorId = ind.id;
    }
  }

  const lancamentos = [];
  const add = (uid, pct, label) => {
    if (!uid || !pct) return;
    lancamentos.push({
      user_id: uid, tipo: 'honorario_exito', valor: +(valor * pct / 100).toFixed(2),
      origem_tipo: 'arrematacao', origem_id: String(arr.id),
      descricao: `Honorário de êxito (${label} ${Number(pct).toFixed(2)}%) — arremate #${arr.id}`, status: 'disponivel',
    });
  };
  // Admin = BACKUP: absorve a fatia de cada papel SEM pessoa designada (total = 10%).
  let adminPct = Number(cfg.admin_pct) || 0;
  if (!advogadoId)  adminPct += Number(cfg.advogado_pct)  || 0;
  if (!analistaId)  adminPct += Number(cfg.analista_pct)  || 0;
  if (!consultorId) adminPct += Number(cfg.consultor_pct) || 0;
  add(adminRow?.id, adminPct, 'admin');
  add(advogadoId,  cfg.advogado_pct,  'advogado');
  add(analistaId,  cfg.analista_pct,  'analista');
  add(consultorId, cfg.consultor_pct, 'consultor');

  if (lancamentos.length) {
    await dbFetch('saldo_lancamentos', { method: 'POST', body: JSON.stringify(lancamentos), headers: { Prefer: 'return=minimal' } });
  }
  const total = lancamentos.reduce((s, l) => s + l.valor, 0);
  await dbFetch(`arrematacoes?id=eq.${arr.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ honorarios_valor: total, honorarios_status: 'distribuido' }),
    headers: { Prefer: 'return=minimal' },
  });
  return { total, lancamentos: lancamentos.length };
}

export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  const url = new URL(req.url);
  const userRole = await getRoleFor(user.id);
  const EQUIPE = ['admin', 'analista', 'advogado', 'consultor'];
  const GESTORES = ['admin', 'analista'];

  // ── GET ?signed_url=1 ─────────────────────────────────────────────────────
  if (req.method === 'GET' && url.searchParams.get('signed_url') === '1') {
    const arrematacaoId = url.searchParams.get('arrematacao_id');
    const tipo = url.searchParams.get('tipo') || 'outro';
    const nome = url.searchParams.get('nome');
    const docType = url.searchParams.get('doc_type') || 'imovel_anexo';

    if (!arrematacaoId || !nome) {
      return json({ error: 'arrematacao_id e nome são obrigatórios' }, 400);
    }

    // Permissão: gestores e advogados para imovel_anexo; arrematante para usuario_doc
    if (docType === 'imovel_anexo') {
      if (!['admin', 'analista', 'advogado'].includes(userRole)) {
        return forbidden('Apenas admin/analista/advogado podem enviar documentos do processo');
      }
    } else {
      // usuario_doc: só o próprio usuário ou gestor
      if (!GESTORES.includes(userRole)) {
        // verifica se é arrematante desta arrematacao
        const check = await dbFetch(`arrematacoes?id=eq.${arrematacaoId}&arrematante_id=eq.${user.id}&select=id`);
        if (!check.data?.length) {
          return forbidden('Acesso negado');
        }
      }
    }

    const bucket = 'arrematacoes';
    const filePath = `${arrematacaoId}/${tipo}/${nome}`;

    const signRes = await fetch(
      `${SUPABASE_URL}/storage/v1/object/upload/sign/${bucket}/${filePath}`,
      {
        method: 'POST',
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ upsert: true }),
      }
    );

    if (!signRes.ok) {
      const err = await signRes.text();
      return json({ error: 'Falha ao gerar URL assinada', detail: err }, 500);
    }
    const signData = await signRes.json();
    return json({ signedUrl: signData.url || signData.signedUrl, token: signData.token, path: filePath });
  }

  // ── GET ?save_doc=1 is handled via POST below ──────────────────────────────

  // ── DELETE ?doc_id=X&doc_type=Y ───────────────────────────────────────────
  if (req.method === 'DELETE') {
    const docId = url.searchParams.get('doc_id');
    const docType = url.searchParams.get('doc_type');

    if (!docId || !docType) {
      return json({ error: 'doc_id e doc_type são obrigatórios' }, 400);
    }

    if (docType === 'imovel_anexo') {
      if (!GESTORES.includes(userRole)) return forbidden();
      const r = await dbFetch(`imovel_anexos?id=eq.${docId}`, { method: 'DELETE' });
      if (!r.ok) return json({ error: 'Erro ao deletar documento' }, 500);
      return json({ ok: true });
    } else if (docType === 'usuario_doc') {
      if (!GESTORES.includes(userRole)) {
        // Só pode deletar os seus próprios
        const check = await dbFetch(`usuario_docs?id=eq.${docId}&user_id=eq.${user.id}&select=id`);
        if (!check.data?.length) return forbidden();
      }
      const r = await dbFetch(`usuario_docs?id=eq.${docId}`, { method: 'DELETE' });
      if (!r.ok) return json({ error: 'Erro ao deletar documento' }, 500);
      return json({ ok: true });
    }

    return json({ error: 'doc_type inválido' }, 400);
  }

  // ── GET ────────────────────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const imovelId = url.searchParams.get('imovel_id');
    if (!imovelId) return json({ error: 'imovel_id obrigatório' }, 400);

    // Busca arrematacao
    const r = await dbFetch(
      `arrematacoes?imovel_id=eq.${imovelId}&select=*&limit=1`,
    );
    if (!r.ok) return json({ error: 'Erro ao buscar arrematação' }, 500);

    const arrematacao = r.data?.[0] || null;

    if (!arrematacao) return json({ arrematacao: null, imovel_anexos: [], usuario_docs: [] });

    // Verifica acesso
    const isArrematante = arrematacao.arrematante_id === user.id;
    const isEquipe = EQUIPE.includes(userRole);
    if (!isArrematante && !isEquipe) return forbidden();

    // Busca imovel_anexos
    const anexosRes = await dbFetch(
      `imovel_anexos?arrematacao_id=eq.${arrematacao.id}&select=*&order=criado_em.asc`,
    );
    const imovelAnexos = anexosRes.ok ? (anexosRes.data || []) : [];

    // Busca usuario_docs (só para o próprio usuário ou gestor)
    let usuarioDocs = [];
    if (isArrematante || GESTORES.includes(userRole)) {
      const udRes = await dbFetch(
        `usuario_docs?arrematacao_id=eq.${arrematacao.id}&user_id=eq.${arrematacao.arrematante_id}&select=*&order=criado_em.asc`,
      );
      usuarioDocs = udRes.ok ? (udRes.data || []) : [];
    }

    return json({ arrematacao, imovel_anexos: imovelAnexos, usuario_docs: usuarioDocs });
  }

  // ── POST ───────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { body = {}; }

    // Sub-resource: save_doc
    if (url.searchParams.get('save_doc') === '1') {
      const { arrematacao_id, imovel_id, tipo, url: fileUrl, tamanho_kb, doc_type } = body;
      const nome = sanitizeText(body.nome, 300);
      if (!nome || !fileUrl) return json({ error: 'nome e url são obrigatórios' }, 400);

      if (doc_type === 'imovel_anexo') {
        if (!['admin', 'analista', 'advogado'].includes(userRole)) return forbidden();
        const r = await dbFetch('imovel_anexos', {
          method: 'POST',
          body: JSON.stringify({
            arrematacao_id,
            imovel_id,
            tipo: tipo || 'outro',
            nome,
            url: fileUrl,
            tamanho_kb: tamanho_kb || null,
            criado_por: user.id,
            role_criador: userRole,
          }),
        });
        if (!r.ok) return json({ error: 'Erro ao salvar documento', detail: r.data }, 500);
        return json({ ok: true, doc: Array.isArray(r.data) ? r.data[0] : r.data });
      } else if (doc_type === 'usuario_doc') {
        if (!GESTORES.includes(userRole)) {
          // Verifica que é o arrematante
          const check = await dbFetch(`arrematacoes?id=eq.${arrematacao_id}&arrematante_id=eq.${user.id}&select=id`);
          if (!check.data?.length) return forbidden();
        }
        const targetUserId = GESTORES.includes(userRole) ? (body.user_id || user.id) : user.id;
        const r = await dbFetch('usuario_docs', {
          method: 'POST',
          body: JSON.stringify({
            user_id: targetUserId,
            arrematacao_id: arrematacao_id || null,
            tipo: tipo || 'outro',
            nome,
            url: fileUrl,
            tamanho_kb: tamanho_kb || null,
          }),
        });
        if (!r.ok) return json({ error: 'Erro ao salvar documento', detail: r.data }, 500);
        return json({ ok: true, doc: Array.isArray(r.data) ? r.data[0] : r.data });
      }

      return json({ error: 'doc_type inválido' }, 400);
    }

    // Criar arrematacao
    if (!GESTORES.includes(userRole)) return forbidden('Apenas admin/analista podem registrar arrematações');

    const { imovel_id, arrematante_id, valor_arrematado, data_leilao, leiloeiro, numero_processo, observacoes } = body;
    if (!imovel_id || !arrematante_id) {
      return json({ error: 'imovel_id e arrematante_id são obrigatórios' }, 400);
    }

    // Herda a equipe sorteada no caso (analista na reunião, advogado no jurídico)
    const equipe = await equipeDoCaso(imovel_id, arrematante_id);

    // Cria arrematacao
    const r = await dbFetch('arrematacoes', {
      method: 'POST',
      body: JSON.stringify({
        imovel_id,
        arrematante_id,
        valor_arrematado: valor_arrematado || null,
        data_leilao: data_leilao || null,
        leiloeiro: leiloeiro || null,
        numero_processo: numero_processo || null,
        observacoes: observacoes || null,
        criado_por: user.id,
        status: 'em_processo',
        analista_id: equipe.analista_id,
        advogado_id: equipe.advogado_id,
        honorarios_status: 'pendente',
      }),
    });
    if (!r.ok) return json({ error: 'Erro ao criar arrematação', detail: r.data }, 500);

    // Atualiza status do imóvel
    await dbFetch(`imoveis_leilao?id=eq.${imovel_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'arrematado', ativo: false }),
      headers: { Prefer: 'return=minimal' },
    });

    // Documentos do imóvel passam a ser PERMANENTES (o cron de retenção só apaga
    // anexos com arrematado=false). Garante que matrícula/edital do lote arrematado
    // não sejam removidos após o leilão.
    await dbFetch(`imovel_anexos?imovel_id=eq.${imovel_id}`, {
      method: 'PATCH',
      body: JSON.stringify({ arrematado: true }),
      headers: { Prefer: 'return=minimal' },
    });

    const arrematacao = Array.isArray(r.data) ? r.data[0] : r.data;
    return json({ ok: true, arrematacao }, 201);
  }

  // ── PATCH ?id=X ───────────────────────────────────────────────────────────
  if (req.method === 'PATCH') {
    if (!GESTORES.includes(userRole)) return forbidden();
    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'id obrigatório' }, 400);

    let body;
    try { body = await req.json(); } catch { body = {}; }

    const allowed = {};
    if (body.status !== undefined) allowed.status = body.status;
    if (body.observacoes !== undefined) allowed.observacoes = body.observacoes;
    if (body.valor_arrematado !== undefined) allowed.valor_arrematado = body.valor_arrematado;
    allowed.atualizado_em = new Date().toISOString();

    const r = await dbFetch(`arrematacoes?id=eq.${id}`, {
      method: 'PATCH',
      body: JSON.stringify(allowed),
    });
    if (!r.ok) return json({ error: 'Erro ao atualizar arrematação', detail: r.data }, 500);
    const updated = Array.isArray(r.data) ? r.data[0] : r.data;

    // Êxito → distribui o honorário de 10% (idempotente)
    let honorarios = null;
    if (allowed.status === 'finalizado') {
      try { honorarios = await distribuirHonorarios(updated); } catch (e) { console.error('honorarios', e); }
    }
    return json({ ok: true, arrematacao: updated, honorarios });
  }

  return json({ error: 'Método não permitido' }, 405);
}
