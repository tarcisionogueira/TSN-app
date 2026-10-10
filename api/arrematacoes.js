import { getAuthUser, unauthorized, forbidden } from './_auth.js';
import { sanitizeText } from './_sanitize.js';
import { urlDocumento } from './_storage.js';
import { liquidarHonorario } from './_honorario-liquidacao.js';

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
  // Coluna é created_at ('criado_em' não existe em casos): o 42703 silencioso fazia
  // a arrematação nascer sem analista/advogado — e o rateio de honorários sem equipe.
  const r = await dbFetch(`casos?imovel_id=eq.${imovel_id}&cliente_id=eq.${cliente_id}&select=analista_id,advogado_id&order=created_at.desc&limit=1`);
  const c = r.data?.[0] || {};
  return { analista_id: c.analista_id || null, advogado_id: c.advogado_id || null };
}

// Distribui o honorário de êxito no ledger — desde 10/10 sobre o LÍQUIDO RECEBIDO e em parcelas,
// à medida que o dinheiro fica disponível (regra honorario.split_sobre_liquido; a conta toda é
// do banco, em honorario_liquidar — ver api/_honorario-liquidacao.js). Idempotente: rodar de novo
// só credita o que ainda falta e já está disponível. O cron honorarios-liquidar-cron continua de
// onde a finalização parou (cartão que compensa em D+30, cheque que compensa depois).
async function distribuirHonorarios(arr) {
  if (!arr || arr.honorarios_status === 'distribuido') return null;
  // GATE (16/09, pedido do dono): a equipe só pode ser creditada DEPOIS que o cliente pagou
  // os honorários de êxito (honorarios_status='pago', setado pelo trigger de
  // honorarios_recebimentos quando a soma bate o total).
  if (arr.honorarios_status !== 'pago') return { erro: 'honorario_nao_pago', distribuido: false };
  if (!(Number(arr.valor_arrematado || 0) > 0)) return null;
  try {
    return await liquidarHonorario(dbFetch, arr);
  } catch (e) {
    console.error('[arrematacoes] liquidar honorário', arr.id, e?.message);
    return { erro: 'falha_ao_liquidar', detalhe: String(e?.message || e).slice(0, 200), distribuido: false };
  }
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

    // Busca arrematacao (imovelId vem da query → encode para não injetar parâmetros PostgREST)
    const r = await dbFetch(
      `arrematacoes?imovel_id=eq.${encodeURIComponent(imovelId)}&select=*&limit=1`,
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
    // Assina cada documento SOB DEMANDA (curta duração) antes de devolver ao front.
    for (const a of imovelAnexos) if (a && a.storage_path) a.url = (await urlDocumento(a)) || a.url;

    // Busca usuario_docs (só para o próprio usuário ou gestor)
    let usuarioDocs = [];
    if (isArrematante || GESTORES.includes(userRole)) {
      const udRes = await dbFetch(
        `usuario_docs?arrematacao_id=eq.${arrematacao.id}&user_id=eq.${arrematacao.arrematante_id}&select=*&order=criado_em.asc`,
      );
      usuarioDocs = udRes.ok ? (udRes.data || []) : [];
      for (const d of usuarioDocs) if (d && d.storage_path) d.url = (await urlDocumento(d)) || d.url;
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

    const { imovel_id, arrematante_id: arrematanteIdBody, arrematante_email, valor_arrematado, data_leilao, leiloeiro, numero_processo, observacoes } = body;
    // O e-mail é resolvido AQUI (service key), não no navegador: `perfis` não tem coluna `email`
    // (fica em auth.users) e a RPC get_user_id_by_email é service-only de propósito — expor a
    // busca por e-mail ao cliente seria um oráculo de enumeração de contas. Só gestor chega aqui.
    let arrematante_id = arrematanteIdBody || null;
    if (!arrematante_id && arrematante_email) {
      const rid = await dbFetch('rpc/get_user_id_by_email', {
        method: 'POST',
        body: JSON.stringify({ p_email: String(arrematante_email).trim().toLowerCase() }),
      });
      arrematante_id = (rid.ok && typeof rid.data === 'string') ? rid.data : null;
      if (!arrematante_id) return json({ error: 'Nenhum usuário cadastrado com esse e-mail.' }, 404);
    }
    if (!imovel_id || !arrematante_id) {
      return json({ error: 'imovel_id e arrematante_id (ou arrematante_email) são obrigatórios' }, 400);
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
    // ADVOGADO/ESCRITÓRIO DO ÊXITO (07/10, pedido do dono): o caso do Marcos teve advogado, mas o
    // escritório ainda não tinha conta — sem vínculo, o rateio mandaria 100% para o admin. Só o
    // admin vincula; só perfil `advogado` ativo (PF ou escritório PJ); nunca depois de distribuído
    // (o snapshot do que foi pago não muda). `null` desvincula.
    if (body.advogado_id !== undefined) {
      if (userRole !== 'admin') return forbidden('Só o admin vincula o advogado do êxito');
      const atual = (await dbFetch(`arrematacoes?id=eq.${encodeURIComponent(id)}&select=honorarios_status`)).data?.[0];
      if (!atual) return json({ error: 'Arrematação não encontrada' }, 404);
      if (atual.honorarios_status === 'distribuido') return json({ error: 'Honorário já distribuído — o rateio não muda mais.' }, 409);
      if (body.advogado_id !== null) {
        if (!/^[0-9a-f-]{36}$/i.test(String(body.advogado_id))) return json({ error: 'advogado_id inválido' }, 400);
        const adv = (await dbFetch(`perfis?id=eq.${body.advogado_id}&select=id,role,ativo`)).data?.[0];
        if (!adv || adv.role !== 'advogado' || adv.ativo === false) return json({ error: 'Selecione um advogado/escritório ativo.' }, 400);
      }
      allowed.advogado_id = body.advogado_id;
    }
    if (body.status !== undefined) allowed.status = body.status;
    if (body.observacoes !== undefined) allowed.observacoes = body.observacoes;
    if (body.valor_arrematado !== undefined) allowed.valor_arrematado = body.valor_arrematado;
    allowed.atualizado_em = new Date().toISOString();

    // FINALIZAR SEM JURÍDICO NÃO PODE SER ACIDENTE (07/10): finalizar dispara a distribuição, e sem
    // advogado vinculado a fatia do jurídico vai inteira para o admin — e não volta. Exige a
    // confirmação explícita `sem_advogado: true` (a tela pergunta antes).
    if (allowed.status === 'finalizado' && body.sem_advogado !== true) {
      const atual = (await dbFetch(`arrematacoes?id=eq.${encodeURIComponent(id)}&select=advogado_id,honorarios_status`)).data?.[0];
      const advFinal = allowed.advogado_id !== undefined ? allowed.advogado_id : atual?.advogado_id;
      if (atual && atual.honorarios_status === 'pago' && !advFinal) {
        return json({ error: 'Sem advogado/escritório vinculado: a fatia do jurídico iria toda para o admin. Vincule no caso ou confirme a finalização sem advogado.', precisa_confirmar: 'sem_advogado' }, 409);
      }
    }

    const r = await dbFetch(`arrematacoes?id=eq.${encodeURIComponent(id)}`, {
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
