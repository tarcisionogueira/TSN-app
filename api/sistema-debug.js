// Diagnóstico geral do sistema: banco, scrapers, geocodificação
// Acessível apenas por admin (JWT)
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

async function getAdminUserId(req) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace('Bearer ', '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${token}` },
  }).catch(() => null);
  if (!r?.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u?.id) return null;
  const pr = await sb(`perfis?select=role&id=eq.${u.id}&limit=1`);
  if (!pr.ok) return null;
  const rows = await pr.json().catch(() => []);
  return rows?.[0]?.role === 'admin' ? u.id : null;
}

async function countHead(path) {
  try {
    const r = await sb(path, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
    if (!r.ok) return { ok: false, status: r.status };
    const cr = r.headers.get('content-range') || '';
    return { ok: true, count: parseInt(cr.split('/')[1] || '0', 10) };
  } catch (e) {
    return { ok: false, erro: e.message };
  }
}

export default async function handler(req) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return json({ erro: 'Env vars ausentes (VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY)' }, 500);
  }

  const userId = await getAdminUserId(req).catch(() => null);
  if (!userId) return json({ erro: 'Não autorizado — faça login como admin' }, 401);

  const modulo = new URL(req.url).searchParams.get('modulo') || 'geral';
  const resultado = { modulo, timestamp: new Date().toISOString() };

  if (modulo === 'geral' || modulo === 'banco') {
    const [total, ativos, semGeoNull, semGeoZero, comGeo, comFoto] = await Promise.all([
      countHead('imoveis_leilao'),
      countHead('imoveis_leilao?ativo=eq.true'),
      countHead('imoveis_leilao?ativo=eq.true&latitude=is.null'),
      countHead('imoveis_leilao?ativo=eq.true&latitude=eq.0'),
      countHead('imoveis_leilao?ativo=eq.true&latitude=not.is.null&latitude=neq.0'),
      countHead('imoveis_leilao?ativo=eq.true&link_foto=like.*supabase*'),
    ]);
    const semGeoTotal = { ok: semGeoNull.ok && semGeoZero.ok, count: (semGeoNull.count || 0) + (semGeoZero.count || 0) };
    resultado.banco = { total, ativos, geocodificacao: { sem_coords_null: semGeoNull, sem_coords_zero: semGeoZero, sem_coords_total: semGeoTotal, com_coords: comGeo }, fotos: { com_foto: comFoto } };

    // Contagem por fonte — sem filtro de ativo para ver distribuição real
    try {
      const fontesR = await sb('imoveis_leilao?select=fonte,ativo');
      if (fontesR.ok) {
        const rows = await fontesR.json();
        const por_fonte = {}, por_fonte_ativo = {};
        rows.forEach(r => {
          por_fonte[r.fonte] = (por_fonte[r.fonte] || 0) + 1;
          if (r.ativo) por_fonte_ativo[r.fonte] = (por_fonte_ativo[r.fonte] || 0) + 1;
        });
        resultado.banco.por_fonte = por_fonte;
        resultado.banco.por_fonte_ativo = por_fonte_ativo;
      }
    } catch (_) {}
  }

  if (modulo === 'geral' || modulo === 'scraper') {
    // Verifica se a API de status do scraper responde
    try {
      const st = await fetch(`${new URL(req.url).origin}/api/scraper-status`, {
        headers: { Authorization: req.headers.get('authorization') || '' },
        signal: AbortSignal.timeout(5000),
      });
      resultado.scraper = { status_api: st.status, ok: st.ok };
      if (st.ok) {
        const d = await st.json().catch(() => null);
        resultado.scraper.ultima_atualizacao = d?.ultima_atualizacao;
        resultado.scraper.total_banco = d?.total;
        resultado.scraper.fontes = d?.por_fonte;
      }
    } catch (e) {
      resultado.scraper = { erro: e.message };
    }
  }

  if (modulo === 'geral' || modulo === 'geocod') {
    const [semNull, semZero, comCoords] = await Promise.all([
      countHead('imoveis_leilao?ativo=eq.true&latitude=is.null'),
      countHead('imoveis_leilao?ativo=eq.true&latitude=eq.0'),
      countHead('imoveis_leilao?ativo=eq.true&latitude=not.is.null&latitude=neq.0'),
    ]);
    resultado.geocodificacao = {
      sem_coords_null: semNull,
      sem_coords_zero: semZero,
      sem_coords_total: { ok: semNull.ok && semZero.ok, count: (semNull.count || 0) + (semZero.count || 0) },
      com_coords: comCoords,
      por_nivel: {},
    };
    for (const nivel of ['endereco', 'bairro', 'cidade']) {
      resultado.geocodificacao.por_nivel[nivel] = await countHead(`imoveis_leilao?ativo=eq.true&geocod_nivel=eq.${nivel}`);
    }
  }

  return json(resultado, 200);
}

function json(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
