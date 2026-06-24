/**
 * POST /api/leiloeiro-webhook
 * Recebe lotes de leiloeiros parceiros via API key.
 *
 * Headers: X-Leiloeiro-Key: <chave gerada no portal>
 * Actions: upsert_lote, fechar_lote
 * GET    : listar_lotes (com ?key=<chave>)
 */

export const config = { runtime: 'edge' };

const SUPABASE  = process.env.VITE_SUPABASE_URL;
const SVC_KEY   = process.env.SUPABASE_SERVICE_KEY;

async function sb(method, path, body) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SVC_KEY,
      Authorization: `Bearer ${SVC_KEY}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation,resolution=merge-duplicates' : 'return=minimal',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 404) {
    const t = await res.text();
    throw new Error(t);
  }
  return res.status === 204 ? null : res.json();
}

async function resolverLeiloeiro(key) {
  const rows = await sb('GET', `perfis?leiloeiro_webhook_key=eq.${encodeURIComponent(key)}&role=eq.leiloeiro&select=id,nome,ativo&limit=1`);
  const p = Array.isArray(rows) ? rows[0] : null;
  if (!p || !p.ativo) return null;
  return p;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);

  // GET: listar lotes
  if (req.method === 'GET') {
    const key = searchParams.get('key') || req.headers.get('x-leiloeiro-key') || '';
    if (!key) return json({ error: 'Chave não informada' }, 401);
    const leiloeiro = await resolverLeiloeiro(key);
    if (!leiloeiro) return json({ error: 'Chave inválida ou conta inativa' }, 401);
    const lotes = await sb('GET', `imoveis_leiloeiro?leiloeiro_id=eq.${leiloeiro.id}&status=eq.ativo&order=data_leilao.asc`);
    return json({ lotes: lotes || [] });
  }

  if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);

  const key = req.headers.get('x-leiloeiro-key') || '';
  if (!key) return json({ error: 'Header X-Leiloeiro-Key obrigatório' }, 401);

  const leiloeiro = await resolverLeiloeiro(key);
  if (!leiloeiro) return json({ error: 'Chave inválida ou conta inativa' }, 401);

  let body;
  try { body = await req.json(); } catch { return json({ error: 'Body JSON inválido' }, 400); }

  const { action, lote } = body;

  try {
    if (action === 'upsert_lote') {
      if (!lote?.id_externo) return json({ error: 'id_externo obrigatório' }, 400);
      const row = {
        leiloeiro_id:    leiloeiro.id,
        id_externo:      String(lote.id_externo),
        titulo:          lote.titulo || null,
        tipo:            lote.tipo || null,
        endereco:        lote.endereco || null,
        cidade:          lote.cidade || null,
        estado:          lote.estado || null,
        valor_avaliacao: lote.valor_avaliacao ? Number(lote.valor_avaliacao) : null,
        valor_minimo:    lote.valor_minimo    ? Number(lote.valor_minimo)    : null,
        area_m2:         lote.area_m2         ? Number(lote.area_m2)         : null,
        data_leilao:     lote.data_leilao || null,
        modalidade:      lote.modalidade || null,
        url_lote:        lote.url_lote || null,
        descricao:       lote.descricao || null,
        status:          'ativo',
        dados_raw:       lote,
        atualizado_em:   new Date().toISOString(),
      };
      const result = await sb('POST', 'imoveis_leiloeiro', row);
      return json({ ok: true, id: Array.isArray(result) ? result[0]?.id : result?.id });
    }

    if (action === 'fechar_lote') {
      if (!lote?.id_externo) return json({ error: 'id_externo obrigatório' }, 400);
      await fetch(`${SUPABASE}/rest/v1/imoveis_leiloeiro?leiloeiro_id=eq.${leiloeiro.id}&id_externo=eq.${encodeURIComponent(lote.id_externo)}`, {
        method: 'PATCH',
        headers: { apikey: SVC_KEY, Authorization: `Bearer ${SVC_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: lote.motivo || 'encerrado', atualizado_em: new Date().toISOString() }),
      });
      return json({ ok: true });
    }

    return json({ error: `Action desconhecida: ${action}` }, 400);
  } catch (err) {
    console.error('[leiloeiro-webhook]', err.message);
    return json({ error: err.message }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
}
