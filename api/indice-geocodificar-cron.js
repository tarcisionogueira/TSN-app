// TRIANGULAÇÃO DA POSIÇÃO das amostras do ÍNDICE (pedido do dono: "mapear a cidade a ~250m").
// A busca de cidade semeia amostras com bairro/endereço/CEP mas SEM coordenada (todas caíam no
// mesmo ponto da consulta). Este cron pega as amostras sem lat/lng que expõem CEP ou endereço e
// roda a MESMA cascata do acervo (api/_geo.js: IBGE valida + Correios/ViaCEP normaliza + BrasilAPI/
// Nominatim dão a coordenada) — SÓ ROTAS GRÁTIS (permitirPago:false) → custo ~US$0. Assim cada
// imóvel ganha posição real e a resolução por 250m (indice_regiao_ponderado) entra de verdade.
// bairro-only não entra aqui: o "mesmo bairro" já vale nível 1 sem coordenada.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { geocodificarCascata } from './_geo.js';
import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    signal: opts.signal || AbortSignal.timeout(20000),
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
}

// marca a amostra: com coordenada (sucesso) ou só geocod_em (falha) — nos dois casos sai da fila
// (o índice parcial filtra por geocod_em is null), então cada amostra é tentada UMA vez.
async function marcar(id, coords) {
  const body = coords
    ? { lat: coords.lat, lng: coords.lng, geocod_em: new Date().toISOString(), ...(coords.cep ? { cep: coords.cep } : {}) }
    : { geocod_em: new Date().toISOString() };
  const res = await sb(`indice_amostras?id=eq.${id}`, {
    method: 'PATCH', body: JSON.stringify(body), headers: { Prefer: 'return=minimal' },
  });
  return res.ok;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) { res.status(500).json({ error: 'Config ausente' }); return; }

  const deadline = Date.now() + 250000; // folga sob o maxDuration de 300s
  const lote = Math.min(200, Math.max(10, Number(req.query?.lote) || 120));

  // Amostras SEM coordenada e ainda não tentadas que têm CEP ou endereço (sinal p/ nível rua).
  const r = await sb(
    `indice_amostras?select=id,cidade_norm,uf,bairro_norm,cep,endereco&lat=is.null&geocod_em=is.null&or=(cep.not.is.null,endereco.not.is.null)&order=criado_em.desc&limit=${lote}`
  );
  if (!r.ok) { res.status(502).json({ error: 'Falha ao listar', detalhe: (await r.text().catch(() => '')).slice(0, 200) }); return; }
  const amostras = await r.json();
  if (!amostras.length) { res.status(200).json({ ok: true, processadas: 0, geocodificadas: 0 }); return; }

  // Cache por endereço (CEP|endereço|bairro|cidade|uf): amostras iguais não re-chamam o Nominatim.
  const cache = new Map();
  const out = { processadas: 0, geocodificadas: 0, cache_hits: 0, falhas: 0, interrompido: false };

  for (const a of amostras) {
    if (Date.now() > deadline) { out.interrompido = true; break; }
    const key = `${a.cep || ''}|${a.endereco || ''}|${a.bairro_norm || ''}|${a.cidade_norm || ''}|${a.uf || ''}`;
    let coords = null;
    if (cache.has(key)) { coords = cache.get(key); out.cache_hits++; }
    else {
      coords = await geocodificarCascata(
        { endereco: a.endereco || '', bairro: a.bairro_norm || '', cidade: a.cidade_norm || '', estado: a.uf || '', cep: a.cep || '' },
        { permitirPago: false, sleepMs: 1100, deadline },
      ).catch(() => null);
      cache.set(key, coords);
    }
    await marcar(a.id, coords);
    out.processadas++;
    if (coords) out.geocodificadas++; else out.falhas++;
  }

  res.status(200).json({ ok: true, ...out });
}
