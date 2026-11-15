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
import { referenciaPonderada } from './_indice-ponderacao.js';
import { aplicarPesos } from './_indice-peso.js';
import { ehAmostraDeLeilao } from './_valor-mercado.js';

// AMOSTRA SEM COORDENADA NÃO ESTÁ EM (0, 0) (15/11). `Number.isFinite(+null)` é true (+null === 0): a amostra sem
// lat/lng aparecia a "5.855.390 m" de Capão da Canoa — a distância até o Golfo da Guiné.
const coordOk = (v) => v != null && v !== '' && Number.isFinite(+v) && +v !== 0;
// 15/11 (corpus único): só coordenada GEOCODIFICADA por nós mede distância. A do relatório é a do imóvel analisado,
// carimbada quando a IA declara "mesmo condomínio/rua" — contava como vizinhança de 0 m.
const temPosicao = (a) => a?.coord_origem === 'geocodificada' && coordOk(a.lat) && coordOk(a.lng);

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
  // NORMALIZAÇÃO POR DESTINO: a base PRÓPRIA (indice_amostra) e o acervo (imoveis_leilao/
  // cidade_indicadores) gravam a cidade SEM separadores ("são paulo"→"saopaulo"); só a tabela GEO
  // (indice_amostras, usada no ponderado/bairros) mantém o espaço. Sem esta 2ª forma, cidade de
  // nome COMPOSTO não casava na base própria → gráfico de valorização e lista de amostras vinham
  // VAZIOS e o valor caía no fallback ponderado. cidadeNorm já só tem [a-z0-9 ]; tirar o espaço dá
  // exatamente o formato do banco (mesma regra do _cidadeNorm de gerar-analise).
  const cidadeNormDb = cidadeNorm.replace(/\s+/g, '');
  const uf = String(body.uf || '').trim().toUpperCase();
  const bairroNorm = norm(body.bairro);
  // Segmento (apartamento/casa/terreno/comercial) — o índice é por segmento (unidades de m²
  // distintas). Default apartamento (o mais consultado). Rural fica fora (régua de hectare).
  const SEGS = ['apartamento', 'casa', 'terreno', 'comercial'];
  const tipo = SEGS.includes(String(body.tipo || '').toLowerCase()) ? String(body.tipo).toLowerCase() : 'apartamento';
  // Faixa PLAUSÍVEL de R$/m² de VENDA por TIPO — barra outlier que distorcia a mediana/bandas do
  // índice (ex.: terreno mal-rotulado como apto a R$260/m², ou área errada). Locação (R$/m²/mês)
  // usa 1–500. Mesma régua da RPC public.indice_plausivel (índice coerente entre leitura e escrita).
  const VFAIXA = ({ apartamento: [800, 60000], casa: [600, 50000], comercial: [400, 80000], terreno: [20, 20000] })[tipo] || [200, 200000];
  const vendaPlausivel = (v) => { const n = Number(v); return n >= VFAIXA[0] && n <= VFAIXA[1]; };
  const amostraPlausivel = (a) => a.especie === 'locacao' ? (Number(a.valor_m2) >= 1 && Number(a.valor_m2) <= 500) : vendaPlausivel(a.valor_m2);
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
    // "NÃO CONSEGUI LER" NÃO É "SEM AMOSTRAS" (15/11, achado do juiz da arena). Devolvia [] em HTTP não-2xx e em
    // exceção: um 400 ou o timeout de 8 s virava "região sem amostras" e a tela caía calada no ponderado/acervo —
    // número de outra base apresentado como se fosse o desta. Agora lança; quem chama decide (a leitura principal
    // responde 503, a auxiliar segue sem o complemento e deixa rastro).
    const restGet = async (path, q) => {
      let r;
      try {
        r = await fetch(`${SUPABASE_URL}/rest/v1/${path}?${q}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      } catch (e) { const err = new Error(`leitura de ${path} falhou: ${e?.message || e}`); err.leitura = true; throw err; }
      if (!r.ok) { const err = new Error(`leitura de ${path} falhou: HTTP ${r.status} ${(await r.text().catch(() => '')).slice(0, 160)}`); err.leitura = true; throw err; }
      const j = await r.json().catch(() => null);
      if (!Array.isArray(j)) { const err = new Error(`leitura de ${path} devolveu corpo ilegível`); err.leitura = true; throw err; }
      return j;
    };
    // Defesa em LEITURA anti-leilão (a base já é limpa na gravação; cobre legado).
    const semLeilao = (arr) => (Array.isArray(arr) ? arr : []).filter(a => !ehAmostraDeLeilao(a));
    // Fontes SINTÉTICAS/agregadas (não são um anúncio real): FipeZAP, "média (da) cidade", índice,
    // valor estimado. Entravam como uma amostra na composição por período e distorciam a mediana.
    const FONTE_SINTETICA = /fipezap|m[ée]dia\s*(da\s*)?cidade|[íi]ndice\s*bidpro|valor\s*estimad|sint[ée]tic/i;
    const ehSintetica = (a) => FONTE_SINTETICA.test(String(a.fonte || ''));
    const filtro = `cidade_norm=eq.${encodeURIComponent(cidadeNormDb)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(tipo)}`;

    // NÚMERO INVENTADO NÃO ENTRA (regra do dono, 06/08): "se não encontra, informa que não
    // localizou anúncios — fica melhor do que fazer um cálculo infundado". A regra de bolso de
    // 0,4%/mês sobre a venda saía como se fosse mercado: em Alphaville dava R$ 28/m²·mês contra
    // R$ 65–92 dos anúncios reais do ZAP, e em TERRENO — que não se aluga — inventava
    // R$ 3/m²·mês a partir do preço de venda. Agora o aluguel só existe MEDIDO; sem anúncio, o
    // campo vem vazio e a tela diz que não localizou.
    const ehTerreno = tipo === 'terreno';
    const semAluguelMotivo = ehTerreno
      ? 'terreno não tem mercado de locação — lote não se aluga'
      : 'nenhum anúncio de locação com metragem localizado nesta região';

    // ESCADA DO ALUGUEL (achado do dono, 06/08). Antes era binário: ou havia locação COM
    // metragem no recorte, ou caía direto na regra de bolso de 0,4%/mês. Só que o aluguel
    // MEDIDO da mesma cidade existia em OUTRAS duas bases e ninguém olhava: em Barueri, a base
    // geolocalizada tinha 5 locações a R$ 41,61/m² e o cidade_indicadores tinha dois bairros
    // com R$ 39,44 e R$ 50,40 — enquanto a tela mostrava R$ 28 "estimado". Agora, antes de
    // estimar, sobe a escada do que EXISTE e diz de onde veio. Só devolve MEDIDA; quem não
    // achar nada continua caindo no 0,4%, agora como último degrau de verdade.
    const aluguelAmplo = async () => {
      const pond = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
      if (pond && Number(pond.locacao_m2) > 0) {
        const n = Number(pond.n_locacao) || 0;
        return { valor: Number(pond.locacao_m2), origem: `mediana de ${n} anúncio(s) de locação da base geolocalizada da cidade` };
      }
      // Bairros JÁ medidos da mesma cidade (média ponderada pelo nº de amostras de cada um).
      // Só nivel='bairro': as linhas 'grid' repetem o mesmo valor e contariam em dobro.
      const linhas = await restGet('cidade_indicadores',
        `nivel=eq.bairro&cidade_norm=eq.${encodeURIComponent(cidadeNormDb)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(tipo)}&aluguel_m2=not.is.null&select=bairro_norm,aluguel_m2,n_amostras&limit=200`)
        .catch((e) => { console.error('[indice-consulta] aluguel por bairros sem leitura:', e.message); return null; });
      if (linhas === null) return null;   // não consegui ler: sem complemento (não é "nenhum bairro medido")
      const vals = (Array.isArray(linhas) ? linhas : [])
        .map(l => ({ v: Number(l.aluguel_m2), n: Math.max(1, Number(l.n_amostras) || 1) }))
        .filter(x => x.v >= 1 && x.v <= 500);
      if (vals.length) {
        const somaN = vals.reduce((s, x) => s + x.n, 0);
        const media = vals.reduce((s, x) => s + x.v * x.n, 0) / somaN;
        return { valor: Math.round(media * 100) / 100, origem: `média de ${vals.length} bairro(s) já medido(s) da cidade (${somaN} amostras)` };
      }
      return null;
    };

    // Amostras de mercado da REGIÃO solicitada (venda + locação), sem leilão. Traz o geo (bairro/
    // grid/lat/lng) para o recorte por RAIO.
    // Busca ARROJADA (teto 2000, era 800) + faixa ampla p/ INCLUIR locação (R$/m²/mês ~1–500,
    // antes barrada pelo piso 200 → locação caía num sintético 0,4%). A plausibilidade POR TIPO
    // (venda) e por natureza (locação) é aplicada em JS logo abaixo — tira o outlier da conta.
    // 15/11: unidades INDEPENDENTES (view indice_amostra_indep) — a mesma unidade anunciada em vários portais, ou gravada
    // 4× pelo mesmo relatório, conta uma vez. Ver supabase/migrations/20261115_indice_amostra_independente.sql.
    const regLidas = semLeilao(await restGet('indice_amostra_indep',
      `${filtro}&valor_m2=gte.1&valor_m2=lte.200000&select=especie,valor_m2,valor_total,area_m2,data_ref,fonte,criado_em,bairro_norm,geo_grid,lat,lng,coord_origem,endereco,condominio,url,n_copias,prova,prova_em&order=data_ref.desc,criado_em.desc&limit=2000`))
      .filter(amostraPlausivel);
    // LINK MORTO NÃO SUSTENTA NÚMERO (15/11, conferência ao vivo — indice-prova-cron): 404/410, domínio inexistente ou
    // página genérica no lugar do anúncio. Sai do cálculo e é contado à parte no selo.
    const regCidade = regLidas.filter((a) => a.prova !== 'morto');
    const mortosFora = regLidas.length - regCidade.length;

    // RECORTE POR RAIO (pedido do dono — classificar a ~250m, rua/condomínio). Com coordenada na
    // consulta, prioriza as amostras REAIS mais próximas: ≤250 m (rua) → ≤1 km (microrregião) →
    // cidade, usando o 1º nível com amostras de VENDA suficientes. Amostras sem lat/lng (legado/seed
    // de cidade) só contam no nível cidade → sem regressão. Distância equirretangular (m), como no ponderado.
    const MIN_GEO = 6;
    // PISO DE UNIDADES (15/11, arena #484 item 3): abaixo de 5 unidades INDEPENDENTES de venda o nível não sustenta
    // número — sobe (vizinhança → 1 km → cidade → base ponderada/acervo → estado) e DIZ por quê (`nivel_aviso`).
    const MIN_UNIDADES = 5;
    let nivelAviso = null;
    let nivelGeo = 'cidade';
    let regSamples = regCidade;
    if (lat != null && lng != null) {
      const distM = (aLat, aLng) => (coordOk(aLat) && coordOk(aLng))
        ? 111320 * Math.sqrt(Math.pow(+aLat - lat, 2) + Math.pow((+aLng - lng) * Math.cos(lat * Math.PI / 180), 2)) : null;
      const nivelDe = (a) => {
        const d = temPosicao(a) ? distM(a.lat, a.lng) : null;
        if ((d != null && d <= 250) || (bairroNorm && a.bairro_norm && a.bairro_norm === bairroNorm)) return 1;
        if (d != null && d <= 1000) return 2;
        return 3;
      };
      const marc = regCidade.map(a => ({ a, nv: nivelDe(a) }));
      const vendaAte = (nv) => marc.filter(x => x.nv <= nv && x.a.especie === 'venda').length;
      const escolhido = vendaAte(1) >= MIN_GEO ? 1 : (vendaAte(2) >= MIN_GEO ? 2 : 3);
      if (escolhido < 3) { regSamples = marc.filter(x => x.nv <= escolhido).map(x => x.a); nivelGeo = escolhido === 1 ? 'rua' : 'grid'; }
      if (escolhido > 1) {
        nivelAviso = `Na vizinhança do endereço há ${vendaAte(1)} unidade(s) de venda independente(s)`
          + (escolhido === 3 ? ` e até 1 km, ${vendaAte(2)}` : '')
          + ` (mínimo ${MIN_GEO}) — o valor usa ${escolhido === 2 ? 'a microrregião (~1 km)' : 'a cidade inteira'}.`;
      }
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
    // 15/11 (#484): cada unidade pesa pela PROVA (conferido 1 · link próprio 0,5 · busca 0,3 · sem link 0,2) e nenhuma
    // origem passa de 35% do peso — ver api/_indice-peso.js.
    const vendaSamplesReais = aplicarPesos(regSamples.filter(a => a.especie === 'venda' && !ehSintetica(a)))
      .map(a => ({ valor_m2: a.valor_m2, data_ref: a.data_ref, peso: a.peso }));
    const comp = composicaoTemporal(vendaSamplesReais, amostras_ano, Date.now(), bandaCentral);

    // REFERÊNCIA PONDERADA (pedido do dono): quando a LOCALIDADE tem poucas amostras, em vez do
    // corte duro por nível, pondera por PROXIMIDADE + PADRÃO e MISTURA com o ticket médio dos
    // demais por CREDIBILIDADE — referência mais real. Usa o pool da CIDADE inteira (o "local" e os
    // "demais" saem do peso de distância), com as amostras PROJETADAS p/ hoje pela taxa da região
    // (une temporal + espacial). Só com coordenada na consulta; sem ela, segue a composição.
    let ponderacao = null;
    if (lat != null && lng != null) {
      const taxaPond = (comp && comp.taxa_aa != null) ? comp.taxa_aa / 100 : 0;
      const agoraMs = Date.now();
      const projetaHoje = (a) => {
        const m = String(a.data_ref || '').match(/^(\d{4})-(\d{2})/);
        const anos = m ? Math.max(0, Math.min(6, (agoraMs - Date.UTC(+m[1], +m[2] - 1, 15)) / (365 * 24 * 3600 * 1000))) : 0;
        return Number(a.valor_m2) * Math.pow(1 + taxaPond, anos);
      };
      // Coordenada só vale se GEOCODIFICADA (temPosicao): a carimbada no centro da cidade virava "vizinha" de tudo.
      const poolPond = aplicarPesos(regCidade.filter(a => a.especie === 'venda' && !ehSintetica(a) && Number(a.valor_m2) > 0))
        .map(a => ({ valor_m2: projetaHoje(a), lat: temPosicao(a) ? a.lat : null, lng: temPosicao(a) ? a.lng : null, peso: a.peso }));
      ponderacao = referenciaPonderada(poolPond, { lat, lng });
    }

    let regiao = null;
    if (vendaVals.length >= MIN_UNIDADES) {
      // Valor de venda = composição temporal (recente OU projetado p/ hoje); locação segue mediana.
      let vMed = (comp.valor_m2 != null ? comp.valor_m2 : mediana(vendaVals));
      // Adota a referência ponderada+encolhida quando disponível, com GUARDA de sanidade: se
      // divergir demais (>2,2×) da composição, mantém a composição (evita salto por dado espúrio).
      if (ponderacao && ponderacao.valor > 0) {
        const base = comp.valor_m2 || mediana(vendaVals) || ponderacao.valor;
        if (ponderacao.valor <= base * 2.2 && ponderacao.valor >= base / 2.2) vMed = ponderacao.valor;
      }
      // ALUGUEL: mediana MEDIDA quando há amostra com R$/m²; senão a regra de bolso de
      // 0,4%/mês sobre o valor de venda. O fallback existia mas era MUDO — o painel exibia
      // "R$ 28/m²·mês" (= 6.985 × 0,4%) como se fosse mercado observado, quando as 13
      // amostras de locação da região tinham valor_m2 NULL (vieram sem área do anúncio) e
      // foram TODAS descartadas. Em região de padrão alto o 0,4% subestima muito (o aluguel
      // real de Alphaville dá ~0,6%/mês). Agora o número vem rotulado: a tela/PDF mostram
      // "estimado" e o cliente sabe o que está lendo. Achado do dono, 05/08.
      const aluguelMedido = locVals.length ? mediana(locVals) : null;
      // Sem locação medida NO RECORTE, procura MEDIDA mais ampla (escada acima). Se nem lá houver,
      // o campo fica VAZIO — ver `semAluguel` abaixo.
      const amplo = aluguelMedido == null ? await aluguelAmplo() : null;
      const aluguelFinal = ehTerreno ? null : (aluguelMedido != null ? aluguelMedido : (amplo ? amplo.valor : null));
      // Aluguel MENSAL mediano das amostras sem área: é dado REAL (o anúncio traz o valor,
      // só não traz a metragem) e serve de sanidade — melhor mostrar que descartar em silêncio.
      const locMensais = num(regSamples.filter(a => a.especie === 'locacao' && !(Number(a.valor_m2) > 0)).map(a => a.valor_total));
      regiao = {
        fonte: 'mercado',
        venda_m2: vMed,
        aluguel_m2: aluguelFinal,
        aluguel_estimado: false,
        aluguel_estimado_base: null,
        aluguel_indisponivel: aluguelFinal == null,
        aluguel_indisponivel_motivo: aluguelFinal == null ? semAluguelMotivo : null,
        // Medido, mas FORA do recorte da consulta — a tela mostra a procedência em vez de
        // deixar o número mudo (nem "estimado", nem falso "medido aqui").
        aluguel_origem: amplo ? amplo.origem : null,
        aluguel_mensal_mediano: locMensais.length >= 3 ? mediana(locMensais) : null,
        n_locacao_sem_area: locMensais.length,
        n_amostras: vendaVals.length + locVals.length, n_locacao: locVals.length,
        // PISO DE AMOSTRAS NA VENDA (07/08). `venda_m2` saía sem nenhuma exigência de volume:
        // DUAS amostras viravam "o R$/m² da região", com a mesma cara de um número medido sobre
        // dezenas. Gatilho do dono: Índice de TERRENO na Alameda Dourada mostrou quase METADE do
        // que ele sabe ser a média do condomínio. A base eram 2 amostras de "Barueri" genérico
        // (R$ 1.200 e R$ 1.714/m², sem bairro, sem endereço e sem link) — nunca foi uma medição
        // daquele condomínio, mas era apresentada como se fosse.
        // A locação já tinha esse piso (>= 3 acima); a venda não tinha. Agora os dois declaram.
        // Não escondemos o número — dizemos com quantas amostras ele foi feito, para a tela
        // poder marcar "base fraca" em vez de afirmar. Mesma regra do dono para o aluguel:
        // "ou valor medido, ou o selo com a base declarada — nunca um número mudo".
        n_venda: vendaVals.length,
        venda_base_fraca: false,   // o ramo exige MIN_UNIDADES; abaixo disso sobe de nível (else) e declara
        venda_base_motivo: null,
        nivel: nivelGeo,
        nivel_aviso: nivelAviso,
        // 15/11 (arena/medição): o nível 1 junta "≤250 m" com "mesmo bairro", e a coordenada da amostra é a DECLARADA pela
        // pesquisa (carimbo), não geocodificada — "rua/condomínio" prometia uma precisão que o dado não tem.
        nivel_label: nivelGeo === 'rua' ? 'bairro / vizinhança' : nivelGeo === 'grid' ? 'microrregião (~1 km)' : 'cidade (composição de mercado)',
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
        // Transparência da referência ponderada (proximidade+padrão) e do encolhimento ao ticket
        // médio quando a localidade tem poucas amostras — a tela/PDF avisam quando houve mistura.
        ponderacao: ponderacao || null,
      };
    } else {
      // Fallback (região sem amostras de mercado): ponderado com geo → acervo.
      // 15/11 (#484 item 3): também quando a cidade tem MENOS de MIN_UNIDADES unidades de venda — antes 4 bastavam (e
      // 4 locações faziam entrar com 1 venda). Declara a subida em vez de imprimir número de base mínima.
      const motivoSubida = `Na cidade há ${vendaVals.length} unidade(s) de venda independente(s) deste tipo (mínimo ${MIN_UNIDADES})`;
      const pond = await rpc('indice_regiao_ponderado', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo });
      if (pond && (Number(pond.venda_m2) > 0 || Number(pond.locacao_m2) > 0)) {
        // Mesma escada aqui: sem locação no ponderado, tenta os bairros já medidos da cidade
        // antes do 0,4%. (aluguelAmplo repete a chamada do ponderado, que já veio nula.)
        const amploFb = pond.locacao_m2 == null ? await aluguelAmplo() : null;
        const aluFb = ehTerreno ? null : (pond.locacao_m2 != null ? Number(pond.locacao_m2) : (amploFb ? amploFb.valor : null));
        regiao = { fonte: 'mercado', venda_m2: pond.venda_m2,
          aluguel_m2: aluFb,
          aluguel_estimado: false,
          aluguel_estimado_base: null,
          aluguel_indisponivel: aluFb == null,
          aluguel_indisponivel_motivo: aluFb == null ? semAluguelMotivo : null,
          aluguel_origem: amploFb ? amploFb.origem : null,
          n_amostras: (pond.n_venda || 0) + (pond.n_locacao || 0), n_venda: pond.n_venda || 0, n_locacao: pond.n_locacao || 0,
          nivel: Number(pond.nivel) === 1 ? 'rua' : Number(pond.nivel) === 2 ? 'grid' : 'cidade',
          nivel_label: Number(pond.nivel) === 1 ? 'bairro / vizinhança' : Number(pond.nivel) === 2 ? 'bairro e adjacências (~1 km)' : 'cidade',
          // BANDAS de padrão do ponderado (popular/médio/alto) — antes o fallback mostrava só um
          // número; cidades mapeadas pelo botão "Gerar índice" (tabela plural) caíam aqui sem faixa.
          bandas: Number(pond.venda_pop) > 0 ? { popular: pond.venda_pop, medio: pond.venda_med, alto: pond.venda_alto } : null,
          venda_base_fraca: Number(pond.venda_m2) > 0 && (Number(pond.n_venda) || 0) < MIN_UNIDADES,
          venda_base_motivo: Number(pond.venda_m2) > 0 && (Number(pond.n_venda) || 0) < MIN_UNIDADES
            ? `apenas ${Number(pond.n_venda) || 0} amostra(s) de venda — insuficiente para média confiável` : null,
          nivel_aviso: `${motivoSubida} — o valor usa a base ponderada (proximidade e padrão).`,
          bairro_norm: bairroNorm || null };
      } else {
        const acervo = await rpc('indice_bidpro_regiao', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_bairro: bairroNorm, p_lat: null, p_lng: null, p_tipo: tipo });
        if (acervo && (Number(acervo.venda_m2) > 0 || Number(acervo.aluguel_m2) > 0)) regiao = { fonte: 'acervo', ...acervo, nivel_aviso: `${motivoSubida} — o valor usa os indicadores já consolidados da cidade, não as amostras desta consulta.` };
        else {
          // ÚLTIMO nível do cascata (250m → 1km → cidade → ESTADO): referência ampla do estado
          // quando a cidade ainda não tem base própria. Fica EXPLÍCITO que é do estado.
          const est = await rpc('indice_estado_ponderado', { p_uf: uf, p_tipo: tipo });
          if (est && Number(est.venda_m2) > 0) regiao = { fonte: 'estado',
            venda_m2: Number(est.venda_med) > 0 ? est.venda_med : est.venda_m2,
            aluguel_m2: null,
            aluguel_estimado: false,
            aluguel_estimado_base: null,
            aluguel_indisponivel: true,
            aluguel_indisponivel_motivo: semAluguelMotivo,
            n_amostras: est.n_venda || 0, n_venda: est.n_venda || 0, n_locacao: 0, nivel: 'estado', nivel_label: `estado ${uf} (referência ampla)`,
            nivel_aviso: `${motivoSubida} — o valor é a referência do estado ${uf}, não da cidade.`,
            bandas: Number(est.venda_pop) > 0 ? { popular: est.venda_pop, medio: est.venda_med, alto: est.venda_alto } : null,
            bairro_norm: null };
        }
      }
    }
    // REFERÊNCIA EXTERNA SÓ COMO ALARME (15/11, arena #484 item 5). FipeZAP OFICIAL (fipezap_cidade, série publicada pela
    // Fipe — scripts/fipezap-ingerir.mjs) vira termômetro: mostra o número e acusa divergência acima de 35%, sem mexer no
    // valor. NÃO usa o "FipeZAP" que a pesquisa da IA declarava (Salvador a R$ 12.434/m² com 2 valores). É média da
    // CIDADE e de APARTAMENTOS: só compara apartamento, e só ACUSA no nível cidade — no bairro, divergir é esperado e o
    // número aparece como informação. Sem FipeZAP para a cidade, não diz nada (ausência não é "ok").
    if (regiao && Number(regiao.venda_m2) > 0 && tipo === 'apartamento') {
      const fz = await restGet('fipezap_cidade', `cidade_norm=eq.${encodeURIComponent(cidadeNormDb)}&uf=eq.${uf}&venda_m2=gt.0&select=mes,venda_m2,locacao_m2&order=mes.desc&limit=1`)
        .catch((e) => { console.error('[indice-consulta] FipeZAP sem leitura:', e.message); return null; });
      const ref = Array.isArray(fz) && fz[0] ? fz[0] : null;
      if (ref) {
        const refM2 = Number(ref.venda_m2);
        const div = Number(regiao.venda_m2) / refM2 - 1;
        const nivelCidade = !regiao.nivel || regiao.nivel === 'cidade';
        regiao.referencia_externa = {
          fonte: 'FipeZAP (média de apartamentos da cidade)', valor_m2: Math.round(refM2), mes: ref.mes,
          divergencia_pct: Math.round(div * 100), entra_no_calculo: false,
          alarme: nivelCidade && Math.abs(div) > 0.35
            ? `O valor do Índice está ${Math.abs(Math.round(div * 100))}% ${div > 0 ? 'acima' : 'abaixo'} da média FipeZAP de apartamentos da cidade (R$ ${Math.round(refM2).toLocaleString('pt-BR')}/m², ${String(ref.mes).slice(5, 7)}/${String(ref.mes).slice(0, 4)}). As amostras podem estar concentradas em poucas regiões — confira antes de usar.`
            : null,
        };
      }
    }
    const valorizacao = await rpc('indice_valorizacao_anual', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_tipo: tipo, p_bairro_norm: bairroNorm, p_especie: 'venda', p_anos: 6 });

    // LISTA (rastreabilidade) — da MESMA base regSamples (coerente com o valor). O gráfico por
    // ano (amostras_ano) e os períodos de 4 meses (comp.periodos) já foram calculados acima.
    // LISTA DE AMOSTRAS QUE SUSTENTAM O NÚMERO (pedido do dono, 07/08): "sempre deve trazer,
    // tanto no índice quanto no mercadológico, as amostras que tiveram maior peso na precificação
    // e mais próximas do endereço solicitado". Antes isto era `regSamples.slice(0,20)` — a ordem
    // era a da consulta (data desc), não a da RELEVÂNCIA, e a tela sequer renderizava a lista
    // (ela só existia dentro do PDF). Quem via o R$/m² não tinha como saber de onde ele veio.
    //
    // Ordem: proximidade primeiro (mesmo condomínio/endereço > mesma rua/250 m > 1 km > bairro),
    // e dentro do mesmo nível o anúncio mais RECENTE — que é o que mais pesa na precificação,
    // já que a composição temporal projeta pelo mais novo.
    const distDe = (a) => (lat != null && lng != null && temPosicao(a))
      ? 111320 * Math.sqrt(Math.pow(+a.lat - lat, 2) + Math.pow((+a.lng - lng) * Math.cos(lat * Math.PI / 180), 2))
      : null;
    // Peso de proximidade quando NÃO há coordenada (o caso comum: a amostra acabou de nascer e o
    // cron de triangulação ainda não passou). O texto do endereço/condomínio resolve: casar o
    // condomínio pedido é o sinal mais forte que existe, melhor até que 250 m de raio.
    const alvoCond = String(body.condominio || '').trim().toLowerCase();
    const alvoEnd = String(body.endereco || '').trim().toLowerCase().slice(0, 28);
    const rank = (a) => {
      const cond = String(a.condominio || '').trim().toLowerCase();
      const end = String(a.endereco || '').trim().toLowerCase();
      if (alvoCond && cond && (cond.includes(alvoCond) || alvoCond.includes(cond))) return 0; // mesmo condomínio
      if (alvoEnd && end && end.includes(alvoEnd)) return 1;                                   // mesmo endereço
      const d = distDe(a);
      if (d != null && d <= 250) return 2;
      if (d != null && d <= 1000) return 3;
      if (bairroNorm && a.bairro_norm === bairroNorm) return 4;
      return 5;
    };
    const amostras = [...regSamples]
      .map(a => ({ ...a, __rank: rank(a), __dist: distDe(a) }))
      .sort((x, y) => x.__rank - y.__rank
        || (x.__dist ?? 9e9) - (y.__dist ?? 9e9)
        || String(y.data_ref || '').localeCompare(String(x.data_ref || '')))
      .slice(0, 24)
      .map(a => ({
        especie: a.especie, valor_m2: a.valor_m2, valor_total: a.valor_total, area_m2: a.area_m2,
        data_ref: a.data_ref, fonte: a.fonte, bairro_norm: a.bairro_norm,
        endereco: a.endereco || null, condominio: a.condominio || null, url: a.url || null, prova: a.prova || null,
        distancia_m: a.__dist != null ? Math.round(a.__dist) : null,
        proximidade: ['mesmo condomínio', 'mesmo endereço', 'até 250 m', 'até 1 km', 'mesmo bairro', 'região'][a.__rank],
      }));

    const mapeado = !!regiao;
    // aviso de frescor/projeção só quando o VALOR veio da composição temporal (ramo de mercado);
    // no fallback (ponderado/acervo) o número não é projeção, então não confunde o usuário.
    const aviso = (regiao && regiao.periodos) ? avisoFrescor(comp) : null;
    // MAPA DA CIDADE POR REGIÃO: quando é consulta de CIDADE (sem bairro/coordenadas), devolve o
    // R$/m² ponderado de cada BAIRRO já mapeado (>=3 amostras). Bairro fino cai na média (nível 3).
    const cidadeAmpla = !bairroNorm && lat == null && lng == null;
    const regioes = cidadeAmpla
      ? await rpc('indice_bairros_cidade', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_tipo: tipo }).then(r => Array.isArray(r) ? r : []).catch(() => [])
      : [];
    // COMPOSIÇÃO por NÍVEL (localidade ≤250m · bairro · cidade · estado) triada por tipologia e
    // padrão — responde "quantas amostras em cada dimensão" no card do índice.
    const composicao = await rpc('indice_composicao', { p_cidade_norm: cidadeNormDb, p_uf: uf, p_bairro_norm: bairroNorm, p_lat: lat, p_lng: lng, p_tipo: tipo }).catch(() => null);
    // SELO DE PROVA (15/11, arena #484): do que é feito o número — sobre as MESMAS amostras que o calculam (regSamples,
    // já unidades independentes). `copias_fundidas` = anúncios repetidos que deixaram de contar em dobro.
    const prova = { unidades: regSamples.length, conferido: 0, link_proprio: 0, nao_conferivel: 0, listagem: 0, sem_link: 0,
      copias_fundidas: 0, mortos_fora: mortosFora, conferido_em: null };
    for (const a of regSamples) {
      if (prova[a.prova] != null) prova[a.prova]++;
      prova.copias_fundidas += Math.max(0, (Number(a.n_copias) || 1) - 1);
      if (a.prova === 'conferido' && a.prova_em && (!prova.conferido_em || a.prova_em > prova.conferido_em)) prova.conferido_em = a.prova_em;
    }
    return new Response(JSON.stringify({ ok: true, mapeado, regiao, valorizacao: valorizacao || null, amostras: Array.isArray(amostras) ? amostras : [], amostras_ano, periodos: (regiao && regiao.periodos) ? comp.periodos : [], aviso, regioes, composicao, prova }), { status: 200, headers });
  } catch (e) {
    if (e?.leitura) {
      console.error('[indice-consulta] base ilegível:', e.message);
      return new Response(JSON.stringify({ error: 'Não consegui ler a base do Índice agora. Tente de novo em instantes.', detalhe: e.message }), { status: 503, headers });
    }
    return new Response(JSON.stringify({ error: e.message || 'Falha na consulta' }), { status: 500, headers });
  }
}
