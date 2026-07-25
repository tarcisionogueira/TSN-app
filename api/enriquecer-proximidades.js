/**
 * GET /api/enriquecer-proximidades  (cron)
 * Para imóveis já geocodificados que ainda não têm `pontos_proximos`, consulta o
 * OpenStreetMap (Overpass, grátis) e guarda o ponto MAIS PRÓXIMO de cada categoria
 * (praia, transporte, mercado, farmácia, saúde, escola, shopping) com a distância.
 * Processa em lotes pequenos (Overpass é lento/rate-limited).
 */
// Runtime NODE: as consultas ao Overpass são LENTAS e o lote estourava o limite de
// 25s de RESPOSTA INICIAL do edge → "did not return an initial response within 25s"
// (504 a cada ciclo). No Node a função tem os 300s inteiros para o lote.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { consultarProximidades } from './_proximidades.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LOTE = Number(process.env.PROXIMIDADES_LOTE || 12);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    // Timeout p/ não travar o cron numa conexão pendurada ao Supabase (Overpass já
    // tem AbortSignal.timeout em _proximidades.js).
    signal: opts.signal || AbortSignal.timeout(15000),
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).send('Unauthorized');

  // Fila: sem pontos ainda E com menos de MAX_TENT falhas (não exclui para sempre por
  // uma falha transitória do Overpass — ver migration proximidades_tentativas_retry).
  const MAX_TENT = 5;
  const fila = await (await sb(`imoveis_leilao?select=id,latitude,longitude,proximidades_tentativas&proximidades_em=is.null&proximidades_tentativas=lt.${MAX_TENT}&latitude=not.is.null&latitude=neq.0&ativo=eq.true&order=proximidades_tentativas.asc,atualizado_em.desc&limit=${LOTE}`)).json();
  let ok = 0, falhas = 0;
  for (const im of (Array.isArray(fila) ? fila : [])) {
    try {
      const pontos = await consultarProximidades(Number(im.latitude), Number(im.longitude));
      // Sucesso (inclusive vazio {} = "sem POIs por perto", resultado válido): grava e
      // sai da fila via proximidades_em.
      await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ pontos_proximos: pontos, proximidades_em: new Date().toISOString() }) });
      ok++;
    } catch (_) {
      // FALHA real (Overpass fora/limite): NÃO marca proximidades_em — só incrementa o
      // contador, para ser re-tentado no próximo ciclo até MAX_TENT. Sem isto, uma falha
      // transitória excluía o imóvel da fila para sempre.
      await sb(`imoveis_leilao?id=eq.${im.id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ proximidades_tentativas: (Number(im.proximidades_tentativas) || 0) + 1 }) }).catch(() => {});
      falhas++;
    }
  }
  return res.status(200).json({ ok, falhas, lote: LOTE });
}
