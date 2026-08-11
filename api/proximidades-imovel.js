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

  const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=latitude,longitude,pontos_proximos,proximidades_em,proximidades_vazios,proximidades_vazio_em`)).json();
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

  // VIZINHO DE MESMA COORDENADA (11/08). Antes de gastar uma requisição a uma instância
  // pública do Overpass — que é a causa de fundo dos vazios falsos —, aproveita o que outro
  // lote na coordenada IDÊNTICA já calculou. `around:RAIO` a partir da mesma coordenada dá a
  // mesma resposta, e o `dist_m` é medido dela: a cópia é exata. Ganho maior no centroide de
  // cidade, onde dezenas de lotes caem no mesmo ponto. Se não houver vizinho, segue o
  // caminho normal — o atalho nunca vira "não há pontos".
  try {
    const r = await sb(`imoveis_leilao?select=pontos_proximos&ativo=eq.true&latitude=eq.${encodeURIComponent(im.latitude)}&longitude=eq.${encodeURIComponent(im.longitude)}&pontos_proximos=not.is.null&pontos_proximos=neq.${encodeURIComponent('{}')}&limit=1`);
    if (r.ok) {
      const [v] = await r.json();
      const p = v?.pontos_proximos;
      if (p && typeof p === 'object' && Object.keys(p).length > 0) {
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ pontos_proximos: p, proximidades_em: new Date().toISOString(), proximidades_vazios: 0, proximidades_vazio_em: null }) });
        return json({ pontos: p, vizinho: true });
      }
    }
  } catch { /* padrao-ok: atalho opcional; sem ele consulta o Overpass como antes */ }

  try {
    const { pontos, vazio } = await consultarProximidades(lat, lng);

    if (vazio) {
      // UMA observação de vazio NÃO autoriza dizer ao cliente "não há nada por perto" (10/08).
      // É indício: conta para a corroboração TEMPORAL do cron (`proximidades_vazios`) e devolve
      // o estado honesto de "não consegui determinar agora", que a tela já sabe pintar —
      // "Não foi possível carregar os pontos próximos agora" + "Tentar novamente".
      // Quando o cron confirmar o vazio em execuções diferentes, ele grava `{}` e AÍ a tela
      // passa a dizer "nenhum ponto de interesse" — que nesse momento é verdade.
      // Gravar `{}` aqui era o que congelava o engano: o cache devolvia o vazio para sempre.
      // INTERVALO MÍNIMO entre observações (11/08): a corroboração é TEMPORAL, então duas
      // observações dentro da mesma janela de 6h contam como UMA. Sem isto, o cliente que
      // abre e reabre a página em minutos "corrobora" sozinho o vazio que o cron depois grava.
      const ultimo = im.proximidades_vazio_em ? Date.parse(im.proximidades_vazio_em) : 0;
      if (!ultimo || Date.now() - ultimo >= 6 * 3600000) {
        await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, {
          method: 'PATCH', headers: { Prefer: 'return=minimal' },
          // `proximidades_vazios` incrementado no servidor seria melhor, mas PostgREST não faz
          // expressão em PATCH; ler-e-somar aqui é aceitável porque um contador de corroboração
          // que perde uma contagem por concorrência apenas ADIA a conclusão — nunca a antecipa.
          body: JSON.stringify({ proximidades_vazios: (Number(im.proximidades_vazios) || 0) + 1, proximidades_vazio_em: new Date().toISOString() }),
        }).catch(() => { /* padrao-ok: contagem best-effort; perder uma só adia a conclusão */ });
      }
      return json({ pontos: null, indeterminado: true, retryable: true }, 502);
    }

    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ pontos_proximos: pontos, proximidades_em: new Date().toISOString(), proximidades_vazios: 0, proximidades_vazio_em: null }) });
    return json({ pontos });
  } catch (e) {
    // Falha REAL (Overpass fora/limite em todos os espelhos) → status de ERRO, não
    // 200 com null. Assim o cliente distingue "sem pontos por perto" de "não deu p/
    // buscar agora" e mostra "tentar novamente" em vez de ficar em branco.
    return json({ pontos: null, erro: String(e?.message || e), retryable: true }, 502);
  }
}
