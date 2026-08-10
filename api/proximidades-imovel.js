/**
 * GET /api/proximidades-imovel?imovel_id=...   (logado)
 * On-demand: se o imóvel já tem pontos_proximos, devolve; senão calcula na hora
 * (OSM/Overpass), salva e devolve. Usado quando o imóvel é aberto antes do cron.
 */
export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';
import { consultarProximidades, haversine } from './_proximidades.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function json(o, s = 200) { return new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } }); }
function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
}

export default async function handler(req) {
  const user = await getAuthUser(req);
  if (!user) return json({ error: 'Não autenticado' }, 401);

  const id = new URL(req.url).searchParams.get('imovel_id');
  if (!id) return json({ error: 'imovel_id obrigatório' }, 400);

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=latitude,longitude,pontos_proximos,proximidades_em`)).json();
  if (!im) return json({ error: 'Imóvel não encontrado' }, 404);

  const lat = Number(im.latitude), lng = Number(im.longitude);

  // Cache válido SÓ se foi calculado para as coordenadas ATUAIS. Se o imóvel foi
  // re-geocodificado depois (ex.: centroide → endereço exato), os pontos guardados
  // ficam a quilômetros do local certo: a distância recalculada (coord atual → ponto)
  // não bate com o dist_m gravado. Nesse caso ignora o cache e recalcula no local certo.
  // (Sintoma: todas as proximidades aparecendo ~10 km numa cidade densa.)
  // VAZIO TEM VALIDADE (10/08). Um `{}` em cache é indistinguível de uma consulta que falhou
  // em silêncio, e o cache o devolvia PARA SEMPRE: `Object.values({})` é `[]`, `pts.some(...)`
  // é `false`, então o resultado nunca era considerado velho. Foi o que congelou 51% do acervo
  // em "Nenhum ponto de interesse mapeado nas proximidades". Agora o vazio vale 30 dias; depois
  // disso é recalculado na hora, para o cliente que abre a página não ficar preso ao engano.
  const VALIDADE_VAZIO_MS = 30 * 86400000;
  const vazioEmCache = im.pontos_proximos && Object.keys(im.pontos_proximos).length === 0;
  const vazioVencido = vazioEmCache
    && (!im.proximidades_em || (Date.now() - new Date(im.proximidades_em).getTime()) > VALIDADE_VAZIO_MS);

  if (im.pontos_proximos && !vazioVencido && lat && lng) {
    const pts = Object.values(im.pontos_proximos).filter(p => p && p.lat != null && p.lng != null);
    const stale = pts.some(p => Math.abs(haversine(lat, lng, Number(p.lat), Number(p.lng)) - (Number(p.dist_m) || 0)) > 500);
    if (!stale) return json({ pontos: im.pontos_proximos, cache: true });
  } else if (im.pontos_proximos && !vazioVencido && (!lat || !lng)) {
    return json({ pontos: im.pontos_proximos, cache: true });
  }

  if (!lat || !lng) return json({ pontos: null, sem_coordenada: true });

  try {
    const pontos = await consultarProximidades(lat, lng);
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ pontos_proximos: pontos, proximidades_em: new Date().toISOString() }) });
    return json({ pontos });
  } catch (e) {
    // Falha REAL (Overpass fora/limite em todos os espelhos) → status de ERRO, não
    // 200 com null. Assim o cliente distingue "sem pontos por perto" de "não deu p/
    // buscar agora" e mostra "tentar novamente" em vez de ficar em branco.
    return json({ pontos: null, erro: String(e?.message || e), retryable: true }, 502);
  }
}
