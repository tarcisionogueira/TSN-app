/**
 * POST /api/indice-consulta — consulta do Índice BidPro (só LEITURA do que já está mapeado).
 * Grátis para qualquer usuário logado (Explorador incluso): não roda IA, só lê a base.
 * Body: { cidade, uf, bairro? }. Retorna venda/locação R$/m², nível, nº de amostras e a
 * valorização por ano (venda). Se a região não está mapeada, mapeado=false (a GERAÇÃO para
 * regiões não mapeadas é recurso dos planos pagos — feita por outro endpoint, com quota).
 */
export const config = { runtime: 'edge' };

import { getUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
// Mesma normalização do banco (_bairro_norm): minúsculas, sem acento, só alfanumérico.
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

async function rpc(name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json().catch(() => null) : null;
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br', 'Access-Control-Allow-Headers': 'Authorization, Content-Type' };
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const headers = { 'Content-Type': 'application/json', ...cors };

  const rl = await checkRateLimit(`indice-consulta:${getIP(req)}`, 30, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getUser(req);
  if (!user) return unauthorized();

  let body; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const cidadeNorm = norm(body.cidade);
  const uf = String(body.uf || '').trim().toUpperCase();
  const bairroNorm = norm(body.bairro);
  // Segmento (apartamento/casa/terreno/comercial) — o índice é por segmento (unidades de m²
  // distintas). Default apartamento (o mais consultado). Rural fica fora (régua de hectare).
  const SEGS = ['apartamento', 'casa', 'terreno', 'comercial'];
  const tipo = SEGS.includes(String(body.tipo || '').toLowerCase()) ? String(body.tipo).toLowerCase() : 'apartamento';
  // Coordenadas do endereço/condomínio → o índice ponderado resolve o Nível 1 (≤250 m) e o
  // Nível 2 (~1 km) por raio, como no mercadológico. Sem lat/lng, cai no bairro/cidade (texto).
  const lat = Number.isFinite(+body.lat) ? +body.lat : null;
  const lng = Number.isFinite(+body.lng) ? +body.lng : null;
  if (!cidadeNorm || !/^[A-Z]{2}$/.test(uf)) {
    return new Response(JSON.stringify({ error: 'Informe a cidade e a UF (2 letras).' }), { status: 400, headers });
  }

  try {
    // Fonte PRIMÁRIA: AMOSTRAS DE MERCADO (indice_amostras — pesquisa web + backfill),
    // ponderadas por recência. É o que a GERAÇÃO (api/indice-mercado) grava — sem ler aqui,
    // a região recém-gerada continuava aparecendo como "não mapeada" (bug do "gerou e não
    // mostra"). Fallback: mediana do ACERVO (indice_bidpro_regiao) p/ regiões sem amostras.
    const pond = await rpc('indice_regiao_ponderado', {
      p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo,
    });
    let regiao = null;
    if (pond && (Number(pond.venda_m2) > 0 || Number(pond.locacao_m2) > 0)) {
      regiao = {
        fonte: 'mercado',
        venda_m2: pond.venda_m2,
        aluguel_m2: pond.locacao_m2 != null ? pond.locacao_m2 : (Number(pond.venda_m2) > 0 ? Math.round(pond.venda_m2 * 0.004 * 100) / 100 : null),
        n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0),
        nivel: Number(pond.nivel) === 1 ? 'rua' : Number(pond.nivel) === 2 ? 'grid' : 'cidade',
        nivel_label: Number(pond.nivel) === 1 ? 'rua/condomínio (~250 m)' : Number(pond.nivel) === 2 ? 'bairro e adjacências (~1 km)' : 'cidade',
        bairro_norm: bairroNorm || null,
      };
    } else {
      const acervo = await rpc('indice_bidpro_regiao', {
        p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro: bairroNorm, p_lat: null, p_lng: null, p_tipo: tipo,
      });
      if (acervo && (Number(acervo.venda_m2) > 0 || Number(acervo.aluguel_m2) > 0)) regiao = { fonte: 'acervo', ...acervo };
    }
    const valorizacao = await rpc('indice_valorizacao_anual', {
      p_cidade_norm: cidadeNorm, p_uf: uf, p_tipo: tipo, p_bairro_norm: bairroNorm, p_especie: 'venda', p_anos: 6,
    });

    // AMOSTRAS (rastreabilidade + gráfico): comparáveis de mercado que embasam o índice
    // do segmento na cidade — portal (fonte), preço, área e data. Alimentam a "relação
    // dos imóveis da amostra" e um gráfico de valorização por ano derivado das PRÓPRIAS
    // amostras (mais permissivo que a RPC, que exige muitas amostras/ano e some em região
    // com histórico curto). Lidos com service key (RLS não bloqueia leitura interna).
    const restGet = async (q) => {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/indice_amostra?${q}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        return r.ok ? await r.json().catch(() => []) : [];
      } catch { return []; }
    };
    const filtro = `cidade_norm=eq.${encodeURIComponent(cidadeNorm)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(tipo)}`;
    const [amostras, amostrasVenda] = await Promise.all([
      restGet(`${filtro}&select=especie,valor_m2,valor_total,area_m2,data_ref,fonte,criado_em&order=data_ref.desc,criado_em.desc&limit=20`),
      restGet(`${filtro}&especie=eq.venda&valor_m2=gte.200&valor_m2=lte.50000&select=valor_m2,data_ref&order=data_ref.desc&limit=500`),
    ]);
    // Agrega por ANO (mediana R$/m² de venda) — base do gráfico. Aparece com >=2 amostras/ano.
    const porAno = {};
    for (const a of (Array.isArray(amostrasVenda) ? amostrasVenda : [])) {
      const y = String(a.data_ref || '').slice(0, 4);
      if (/^\d{4}$/.test(y) && Number(a.valor_m2) > 0) (porAno[y] ||= []).push(Number(a.valor_m2));
    }
    const mediana = (arr) => { const s = arr.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
    const amostras_ano = Object.keys(porAno).sort()
      .map(y => ({ ano: Number(y), n: porAno[y].length, m2: mediana(porAno[y]) }))
      .filter(p => p.n >= 2 && p.m2 > 0);

    const mapeado = !!regiao;
    return new Response(JSON.stringify({ ok: true, mapeado, regiao, valorizacao: valorizacao || null, amostras: Array.isArray(amostras) ? amostras : [], amostras_ano }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Falha na consulta' }), { status: 500, headers });
  }
}
