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
import { composicaoTemporal, avisoFrescor } from './_indice-composicao.js';

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
    // COERÊNCIA (pedido do dono): o VALOR, a COMPOSIÇÃO (lista) e o GRÁFICO saem da MESMA
    // base e do MESMO recorte da região — as amostras de mercado com FONTE REAL
    // (indice_amostra: anúncios/revendas capturados pelos relatórios). Assim o número
    // reflete exatamente os comparáveis mostrados, e o dono confere a composição. Só cai
    // no ponderado-com-geo (indice_amostras) / acervo quando a região não tem amostras.
    const restGet = async (path, q) => {
      try {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${q}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
        return r.ok ? await r.json().catch(() => []) : [];
      } catch { return []; }
    };
    // Defesa em LEITURA anti-leilão (a base já é limpa na gravação; cobre legado).
    const FONTE_LEILAO = /leil[ãa]o|arremat|hasta.?p[uú]bl|\bcef\b|caixa\s*econ|aliena[çc]|extrajud|retomad|venda\s*direta|megaleil|zukerman|foreclos/i;
    const semLeilao = (arr) => (Array.isArray(arr) ? arr : []).filter(a => !FONTE_LEILAO.test(String(a.fonte || '')));
    // Fontes SINTÉTICAS/agregadas (não são um anúncio real): FipeZAP, "média (da) cidade", índice,
    // valor estimado. Entravam como uma amostra na composição por período e distorciam a mediana.
    const FONTE_SINTETICA = /fipezap|m[ée]dia\s*(da\s*)?cidade|[íi]ndice\s*bidpro|valor\s*estimad|sint[ée]tic/i;
    const ehSintetica = (a) => FONTE_SINTETICA.test(String(a.fonte || ''));
    const filtro = `cidade_norm=eq.${encodeURIComponent(cidadeNorm)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(tipo)}`;

    // Amostras de mercado da REGIÃO solicitada (venda + locação), sem leilão. Traz o geo (bairro/
    // grid/lat/lng) para o recorte por RAIO.
    const regCidade = semLeilao(await restGet('indice_amostra',
      `${filtro}&valor_m2=gte.200&valor_m2=lte.50000&select=especie,valor_m2,valor_total,area_m2,data_ref,fonte,criado_em,bairro_norm,geo_grid,lat,lng&order=data_ref.desc,criado_em.desc&limit=800`));

    // RECORTE POR RAIO (pedido do dono — classificar a ~250m, rua/condomínio). Com coordenada na
    // consulta, prioriza as amostras REAIS mais próximas: ≤250 m (rua) → ≤1 km (microrregião) →
    // cidade, usando o 1º nível com amostras de VENDA suficientes. Amostras sem lat/lng (legado/seed
    // de cidade) só contam no nível cidade → sem regressão. Distância equirretangular (m), como no ponderado.
    const MIN_GEO = 6;
    let nivelGeo = 'cidade';
    let regSamples = regCidade;
    if (lat != null && lng != null) {
      const distM = (aLat, aLng) => (Number.isFinite(+aLat) && Number.isFinite(+aLng))
        ? 111320 * Math.sqrt(Math.pow(+aLat - lat, 2) + Math.pow((+aLng - lng) * Math.cos(lat * Math.PI / 180), 2)) : null;
      const nivelDe = (a) => {
        const d = distM(a.lat, a.lng);
        if ((d != null && d <= 250) || (bairroNorm && a.bairro_norm && a.bairro_norm === bairroNorm)) return 1;
        if (d != null && d <= 1000) return 2;
        return 3;
      };
      const marc = regCidade.map(a => ({ a, nv: nivelDe(a) }));
      const vendaAte = (nv) => marc.filter(x => x.nv <= nv && x.a.especie === 'venda').length;
      const escolhido = vendaAte(1) >= MIN_GEO ? 1 : (vendaAte(2) >= MIN_GEO ? 2 : 3);
      if (escolhido < 3) { regSamples = marc.filter(x => x.nv <= escolhido).map(x => x.a); nivelGeo = escolhido === 1 ? 'rua' : 'grid'; }
    }
    const num = (arr) => arr.map(Number).filter(v => v > 0).sort((a, b) => a - b);
    const vendaVals = num(regSamples.filter(a => a.especie === 'venda').map(a => a.valor_m2));
    const locVals   = num(regSamples.filter(a => a.especie === 'locacao').map(a => a.valor_m2));
    const pct = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
    const mediana = (arr) => { if (!arr.length) return null; const m = Math.floor(arr.length / 2); return arr.length % 2 ? arr[m] : Math.round((arr[m - 1] + arr[m]) / 2); };

    // GRÁFICO por ano (curva) — mediana R$/m² de venda por ano, das próprias amostras.
    // Calculado ANTES do valor: a composição temporal usa essa curva para a taxa de projeção.
    const porAno = {};
    for (const a of regSamples) {
      if (a.especie !== 'venda' || ehSintetica(a)) continue;
      const y = String(a.data_ref || '').slice(0, 4);
      if (/^\d{4}$/.test(y) && Number(a.valor_m2) > 0) (porAno[y] ||= []).push(Number(a.valor_m2));
    }
    const amostras_ano = Object.keys(porAno).sort()
      .map(y => ({ ano: Number(y), n: porAno[y].length, m2: mediana(porAno[y].slice().sort((a, b) => a - b)) }))
      .filter(p => p.n >= 2 && p.m2 > 0);

    // BANDA CENTRAL (p25–p75) dos R$/m² de venda REAIS (sem leilão e sem sintéticas) da região —
    // usada para estabilizar a composição por período contra a bimodalidade popular × alto padrão.
    const vendaReaisVals = num(regSamples.filter(a => a.especie === 'venda' && !ehSintetica(a)).map(a => a.valor_m2));
    const bandaCentral = vendaReaisVals.length >= 6 ? { lo: pct(vendaReaisVals, 0.25), hi: pct(vendaReaisVals, 0.75) } : null;

    // COMPOSIÇÃO TEMPORAL (pedido do dono): períodos de 4 meses, quantitativo total e valor
    // RECENTE quando há amostra nova; senão PROJETA os anúncios antigos p/ hoje pela curva da região.
    // Amostras REAIS (sem sintéticas) + banda central (padrão consistente no tempo).
    const vendaSamplesReais = regSamples.filter(a => a.especie === 'venda' && !ehSintetica(a)).map(a => ({ valor_m2: a.valor_m2, data_ref: a.data_ref }));
    const comp = composicaoTemporal(vendaSamplesReais, amostras_ano, Date.now(), bandaCentral);

    let regiao = null;
    if (vendaVals.length >= 4 || locVals.length >= 4) {
      // Valor de venda = composição temporal (recente OU projetado p/ hoje); locação segue mediana.
      const vMed = (comp.valor_m2 != null ? comp.valor_m2 : mediana(vendaVals));
      regiao = {
        fonte: 'mercado',
        venda_m2: vMed,
        aluguel_m2: locVals.length ? mediana(locVals) : (vMed ? Math.round(vMed * 0.004 * 100) / 100 : null),
        n_amostras: vendaVals.length + locVals.length,
        nivel: nivelGeo,
        nivel_label: nivelGeo === 'rua' ? 'rua/condomínio (~250 m)' : nivelGeo === 'grid' ? 'microrregião (~1 km)' : 'cidade (composição de mercado)',
        bairro_norm: bairroNorm || null,
        // COMPOSIÇÃO TEMPORAL — frescor + projeção + quantitativo (pedido do dono).
        total_anuncios: comp.total_anuncios,
        n_recentes: comp.n_recentes,
        projetado: comp.projetado,
        sem_amostras_recentes: comp.sem_amostras_recentes,
        taxa_aa: comp.taxa_aa,
        base_periodos: comp.base_periodos,
        periodos: comp.periodos,
        // BANDAS DE PADRÃO (percentis de R$/m² de venda): popular (p25) · médio (p50) · alto
        // (p75). Uma referência de ALTO PADRÃO deve olhar a banda "alto", não a mediana geral.
        bandas: vendaReaisVals.length >= 6 ? { popular: pct(vendaReaisVals, 0.25), medio: pct(vendaReaisVals, 0.50), alto: pct(vendaReaisVals, 0.75) } : null,
      };
    } else {
      // Fallback (região sem amostras de mercado): ponderado com geo → acervo.
      const pond = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
      if (pond && (Number(pond.venda_m2) > 0 || Number(pond.locacao_m2) > 0)) {
        regiao = { fonte: 'mercado', venda_m2: pond.venda_m2,
          aluguel_m2: pond.locacao_m2 != null ? pond.locacao_m2 : (Number(pond.venda_m2) > 0 ? Math.round(pond.venda_m2 * 0.004 * 100) / 100 : null),
          n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0),
          nivel: Number(pond.nivel) === 1 ? 'rua' : Number(pond.nivel) === 2 ? 'grid' : 'cidade',
          nivel_label: Number(pond.nivel) === 1 ? 'rua/condomínio (~250 m)' : Number(pond.nivel) === 2 ? 'bairro e adjacências (~1 km)' : 'cidade',
          bairro_norm: bairroNorm || null };
      } else {
        const acervo = await rpc('indice_bidpro_regiao', { p_cidade_norm: cidadeNorm, p_uf: uf, p_bairro: bairroNorm, p_lat: null, p_lng: null, p_tipo: tipo });
        if (acervo && (Number(acervo.venda_m2) > 0 || Number(acervo.aluguel_m2) > 0)) regiao = { fonte: 'acervo', ...acervo };
      }
    }
    const valorizacao = await rpc('indice_valorizacao_anual', { p_cidade_norm: cidadeNorm, p_uf: uf, p_tipo: tipo, p_bairro_norm: bairroNorm, p_especie: 'venda', p_anos: 6 });

    // LISTA (rastreabilidade) — da MESMA base regSamples (coerente com o valor). O gráfico por
    // ano (amostras_ano) e os períodos de 4 meses (comp.periodos) já foram calculados acima.
    const amostras = regSamples.slice(0, 20);

    const mapeado = !!regiao;
    // aviso de frescor/projeção só quando o VALOR veio da composição temporal (ramo de mercado);
    // no fallback (ponderado/acervo) o número não é projeção, então não confunde o usuário.
    const aviso = (regiao && regiao.periodos) ? avisoFrescor(comp) : null;
    // MAPA DA CIDADE POR REGIÃO: quando é consulta de CIDADE (sem bairro/coordenadas), devolve o
    // R$/m² ponderado de cada BAIRRO já mapeado (>=3 amostras). Bairro fino cai na média (nível 3).
    const cidadeAmpla = !bairroNorm && lat == null && lng == null;
    const regioes = cidadeAmpla
      ? await rpc('indice_bairros_cidade', { p_cidade_norm: cidadeNorm, p_uf: uf, p_tipo: tipo }).then(r => Array.isArray(r) ? r : []).catch(() => [])
      : [];
    return new Response(JSON.stringify({ ok: true, mapeado, regiao, valorizacao: valorizacao || null, amostras: Array.isArray(amostras) ? amostras : [], amostras_ano, periodos: (regiao && regiao.periodos) ? comp.periodos : [], aviso, regioes }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message || 'Falha na consulta' }), { status: 500, headers });
  }
}
