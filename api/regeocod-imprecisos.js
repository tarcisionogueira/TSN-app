// Re-enfileira imóveis com geocoding IMPRECISO (bairro/cidade) ou que FALHARAM,
// marcando-os como 'refazer' para o cron de geocodificação tentar de novo com a
// cascata melhorada (retry/backoff + Google). Rotaciona por geocod_reproc_em para
// não re-tentar sempre os mesmos: cada linha volta à fila no máx. 1x a cada 14 dias.
// Objetivo: subir o % de nível ENDEREÇO ao longo do tempo (destrava o score de
// localização, que só roda em nível endereço, e melhora pins/raio).
export const config = { runtime: 'nodejs', maxDuration: 60 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const LIMITE = parseInt(process.env.REGEOCOD_LIMITE || '500', 10);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    signal: opts.signal || AbortSignal.timeout(20000),
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

export default async function handler(req, resp) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return resp.status(403).json({ error: 'CRON_SECRET não configurado' });
  const auth = (req.headers.get ? req.headers.get('authorization') : req.headers['authorization']) || '';
  const url = new URL(req.url, 'http://localhost');
  const sent = (req.headers.get ? req.headers.get('x-cron-secret') : req.headers['x-cron-secret'])
    || url.searchParams.get('secret') || auth.replace(/^Bearer\s+/i, '');
  if (sent !== cronSecret) return resp.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return resp.status(500).json({ error: 'Supabase env vars ausentes' });

  const corte = new Date(Date.now() - 14 * 86400000).toISOString();
  // Imprecisos (bairro/cidade) ou que falharam, ainda não reprocessados neste ciclo.
  const sel = `imoveis_leilao?select=id&ativo=eq.true`
    + `&geocod_nivel=in.(bairro,cidade,falhou)`
    + `&or=(geocod_reproc_em.is.null,geocod_reproc_em.lt.${corte})`
    + `&order=geocod_reproc_em.asc.nullsfirst&limit=${LIMITE}`;
  const r = await sb(sel);
  if (!r.ok) return resp.status(500).json({ error: 'select falhou', detalhe: (await r.text()).slice(0, 200) });
  const linhas = await r.json();
  if (!linhas.length) return resp.status(200).json({ reenfileirados: 0, msg: 'nada a reprocessar' });

  const ids = linhas.map(x => x.id);
  const agora = new Date().toISOString();
  // Marca como 'refazer' (entra na fila do cron geocodificar) e carimba o reproc.
  const up = await sb(`imoveis_leilao?id=in.(${ids.join(',')})`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ geocod_nivel: 'refazer', geocod_reproc_em: agora }),
  });
  if (!up.ok) return resp.status(500).json({ error: 'patch falhou', detalhe: (await up.text()).slice(0, 200) });
  return resp.status(200).json({ reenfileirados: ids.length });
}
