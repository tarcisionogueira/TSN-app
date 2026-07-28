// Geração da análise mercadológica + laudo NO SERVIDOR (persistente).
// O cliente dispara e pode FECHAR a aba: a função Vercel continua rodando até o
// fim e grava o resultado em `analises_mercado`. Ao reabrir (qualquer device), o
// app lê o resultado do banco. Espelha os prompts de src/utils/claude.js.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude } from './_uso.js';
import { resumoAprendizadoTexto } from './_arremate-aprendizado.js';
import { ehCidadeTemporada, motivoTemporada } from './_temporada.js';
import { composicaoTemporal, avisoFrescor } from './_indice-composicao.js';
import { geocodificarCascata, rankNivel, coordValida } from './_geo.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const REUSE_DIAS = Number(process.env.ANALISE_REUSE_DIAS || 7); // reaproveita a pesquisa de mercado deste imóvel se feita há < N dias

// Custo REAL (micro-USD) acumulado da geração ATUAL. A função Node da Vercel processa 1
// requisição por instância → é seguro resetar por request. Usado para cobrar CRÉDITO quando
// a cota mensal do plano acaba (débito = custo real × multiplicador, em debitar_credito).
let _custoMicroReq = 0;

const brl = (v) => (v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function upsertAnalise(row) {
  // upsert por (user_id, imovel_id)
  await sb('analises_mercado?on_conflict=user_id,imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify({ ...row, updated_at: new Date().toISOString() }),
  });
}
// LOG DE ATIVIDADE (Cliente 360) — best-effort, nunca bloqueia o relatório. Registra o
// movimento (relatório ok/erro) com o MOTIVO, para diagnóstico (ex.: "sem créditos").
async function logAtividade(userId, evento, detalhe, meta) {
  try {
    if (!userId) return;
    await sb('rpc/registrar_atividade', { method: 'POST', body: JSON.stringify({
      p_user_id: userId, p_evento: evento, p_detalhe: detalhe || null, p_meta: meta || {} }) });
  } catch { /* log é best-effort */ }
}

export function extractText(data) {
  if (!data?.content) return '';
  return data.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
}
// SALVAMENTO de JSON TRUNCADO (causa-raiz do "relatório sem amostras" em cidade grande): quando
// a IA encontra MUITAS amostras, a resposta pode estourar o max_tokens e ser cortada no meio →
// o JSON fica inválido e o parse estrito jogava TUDO fora (0 amostras), mesmo com nivel1/nivel2
// (que vêm PRIMEIRO no schema) já completos. Aqui recuperamos o objeto até o último elemento
// COMPLETO, fechando os colchetes/chaves abertos e descartando só a cauda truncada (a colheita
// ampla, que vem por último). Best-effort: só roda quando o parse normal falha; devolve null se
// não der para salvar. Trata strings/escapes para não fechar dentro de um texto.
function repairTruncatedJSON(text) {
  const start = text.indexOf('{');
  if (start < 0) return null;
  const s = text.slice(start);
  let inStr = false, esc = false, lastComplete = -1;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '}' || ch === ']') lastComplete = i; // fim de uma estrutura completa
  }
  if (lastComplete < 0) return null;
  let cand = s.slice(0, lastComplete + 1).replace(/,\s*$/, '');
  // Recalcula os delimitadores abertos no candidato e fecha na ordem inversa.
  const stack = [];
  let inS = false, es = false;
  for (let i = 0; i < cand.length; i++) {
    const ch = cand[i];
    if (inS) { if (es) es = false; else if (ch === '\\') es = true; else if (ch === '"') inS = false; continue; }
    if (ch === '"') inS = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  while (stack.length) cand += stack.pop();
  try { return JSON.parse(cand); } catch { return null; }
}

export function parseJSON(text) {
  if (!text) return null;
  const clean = text.trim();
  try { return JSON.parse(clean); } catch {}
  const md = clean.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) { try { return JSON.parse(md[1].trim()); } catch {} }
  const obj = clean.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch {} }
  // Resposta truncada (estourou o max_tokens) → recupera o que veio completo (nivel1/nivel2).
  const salvo = repairTruncatedJSON(clean);
  if (salvo) return salvo;
  return null;
}

// O agente que aprende com os relatórios SINALIZA anomalias (o gerador achou algo errado
// nos dados) para a verificação de saúde — sem custo, sem gerar relatório.
async function registrarAnomalia(tipo, fonte, imovelId, campo, detalhe) {
  try {
    await sb('rpc/registrar_anomalia_relatorio', {
      method: 'POST',
      body: JSON.stringify({ p_tipo: tipo, p_fonte: fonte || '', p_imovel_id: String(imovelId || ''), p_campo: campo || '', p_detalhe: detalhe || '' }),
    });
  } catch { /* nunca bloqueia o relatório */ }
}

// APRENDER NA EMISSÃO: ao emitir o relatório, grava uma lição DURÁVEL (corpus + sinais de
// qualidade) em agente_aprendizado — SEM chamada de IA extra (custo zero). Sobrevive à
// exclusão do relatório (tabela separada de analises_*). Guarda só dado POISON-RESISTENTE:
// valores do imóvel (scraper) e da pesquisa (servidor) — nunca derivados de input do
// usuário (ex.: valorMercado depende de areaM2 do cliente), p/ não envenenar o coletivo.
async function aprenderNaEmissao(imovel, mercado, temParecer, avalReal, minReal) {
  try {
    // Usa os valores VALIDADOS do imóvel (avalDb/vminImovel: lidos de imoveis_leilao após
    // garantirValores, já com as travas de sentinela/implausível) quando o chamador os passa.
    // Antes lia só imovel.valor_avaliacao (snake_case), mas a tela /analise envia valorAvaliacao
    // (camelCase) → Number(...) = NaN → avaliacao_ausente:true em TODO relatório (sinal de
    // aprendizado 100% ruído). Fallback aceita as duas grafias se os validados não vierem.
    const aval = Number(avalReal) > 0 ? Number(avalReal)
      : (Number(imovel?.valor_avaliacao) || Number(imovel?.valorAvaliacao) || null);
    const min  = Number(minReal) > 0 ? Number(minReal)
      : (Number(imovel?.valor_minimo) || Number(imovel?.valorMinimo) || null);
    const nAmostras = mercado?.amostras?.length || mercado?.comparaveis?.length || mercado?.anuncios?.length || 0;
    const precoM2 = Number(mercado?.precoMedioM2) || null;
    const corpus = {
      valor_avaliacao: aval, valor_minimo: min,
      desconto_pct: (aval > 0 && min > 0) ? Math.round((1 - min / aval) * 100) : null,
      preco_medio_m2: precoM2,
      aluguel_medio: Number(mercado?.aluguelMedio) || null,
      fipe_zap_m2: Number(mercado?.referenciaFipeZap?.precoMedioM2) || null,
      n_amostras: nAmostras,
      // Particularidade do imóvel (objetivo p/ que serve): revenda/locação/temporada — o agente
      // aprende o perfil de adequação por região/tipo. Derivado de desconto/yield/cidade (poison-resistente).
      intencao: mercado?.classificacaoIntencao
        ? { revenda: !!mercado.classificacaoIntencao.revenda, locacao: !!mercado.classificacaoIntencao.locacao, temporada: !!mercado.classificacaoIntencao.temporada }
        : null,
    };
    const qualidade = {
      avaliacao_ausente: !(aval > 0),
      minimo_ausente: !(min > 0),
      mercado_vazio: !(precoM2 > 0) && nAmostras === 0,
      sem_parecer: !temParecer,
    };
    await sb('agente_aprendizado', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        agente: 'mercadologico', imovel_id: String(imovel?.id || ''),
        cidade: imovel?.cidade || null, uf: imovel?.estado || null,
        tipo: imovel?.tipo || null, modalidade: imovel?.modalidade || null,
        corpus, qualidade,
      }),
    });
  } catch { /* aprendizado é best-effort: nunca bloqueia o relatório */ }
}

// Corpus coletivo (emissões anteriores) da MESMA região/tipo, como referência
// observacional no prompt. Só valores poison-resistentes (pesquisa/scraper). Custo: 1 SELECT.
async function corpusDaRegiao(uf, tipo) {
  try {
    if (!uf || !tipo) return '';
    const rows = await (await sb(`agente_aprendizado?agente=eq.mercadologico&uf=eq.${encodeURIComponent(uf)}&tipo=eq.${encodeURIComponent(tipo)}&select=corpus&order=criado_em.desc&limit=40`)).json();
    if (!Array.isArray(rows)) return '';
    const m2 = rows.map(r => Number(r?.corpus?.preco_medio_m2)).filter(v => v > 0);
    if (m2.length < 3) return '';
    const desc = rows.map(r => Number(r?.corpus?.desconto_pct)).filter(v => v >= 0);
    const med = Math.round(m2.reduce((a, b) => a + b, 0) / m2.length);
    const descMed = desc.length ? Math.round(desc.reduce((a, b) => a + b, 0) / desc.length) : null;
    return `\n\nCORPUS DA REGIÃO (${tipo} em ${uf}, ${m2.length} análises recentes, referência OBSERVACIONAL): preço médio observado ~R$ ${med}/m²${descMed != null ? `, desconto médio ~${descMed}%` : ''}. Use como sanity-check, nunca como verdade absoluta.`;
  } catch { return ''; }
}

// ÍNDICE BIDPRO — base própria de mercado por microrregião (cidade_indicadores). Cada relatório
// SEMEIA (aprende) e LÊ o índice consolidado, sem depender de fonte externa. Best-effort: nunca
// bloqueia o relatório. Recebe cidade_norm JÁ normalizado (coluna gerada) + bairro/lat/lng crus.
// SEGMENTO do Índice (mesma régua do SQL public.indice_segmento): não misturar apto com
// terreno — unidades diferentes de R$/m². apto/casa = m² privativo/construído; terreno = m²
// de terreno; comercial/industrial = régua própria; rural = R$/ha (fora do índice por m²).
function segmentoIndice(tipoRaw) {
  const t = String(tipoRaw || '').toLowerCase();
  if (/terreno|lote|gleba|area|área/.test(t)) return 'terreno';
  if (/rural|fazenda|sitio|sítio|chacara|chácara/.test(t)) return 'rural';
  if (/comerc|loja|galp|barrac|industri|armaz/.test(t)) return 'comercial';
  if (/apart|apto|flat|kitnet|studio|stúdio|cobertura|loft/.test(t)) return 'apartamento';
  if (/casa|sobrado/.test(t)) return 'casa';
  return 'apartamento';
}
async function semearIndiceBidPro(imDb, precoM2, aluguelM2, nAmostras, segmento = 'apartamento') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return;
    const venda = Number(precoM2) > 0 ? Number(precoM2) : null;
    const aluguel = Number(aluguelM2) > 0 ? Number(aluguelM2) : null;
    if (venda == null && aluguel == null) return;
    await sb('rpc/semear_indice_relatorio', {
      method: 'POST',
      body: JSON.stringify({
        p_cidade_norm: imDb.cidade_norm, p_uf: imDb.estado, p_bairro: imDb.bairro || '',
        p_lat: imDb.latitude ?? null, p_lng: imDb.longitude ?? null,
        p_tipo: segmento, p_venda_m2: venda, p_aluguel_m2: aluguel, p_n: Number(nAmostras) || 0,
      }),
    });
  } catch { /* semeadura best-effort */ }
}
// Central ROBUSTO por padrão (mediana + bandas p25/p50/p75) da base própria (indice_amostra
// singular, por-tipo plausível, sem leilão). Evita o número BLENDADO (média sobre padrões
// misturados) que o fallback do relatório usava — mesma correção do card do índice.
async function centralIndiceRegiao(imDb, segmento = 'apartamento') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    const uf = String(imDb.estado).toUpperCase();
    const r = await sb(`indice_amostra?cidade_norm=eq.${encodeURIComponent(imDb.cidade_norm)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(segmento)}&especie=eq.venda&${faixaVendaQ(segmento)}&select=valor_m2,fonte&limit=800`);
    if (!r.ok) return null;
    const j = await r.json().catch(() => []);
    const vals = (Array.isArray(j) ? j : []).filter(a => Number(a.valor_m2) > 0 && !ehFonteLeilao(a.fonte)).map(a => Number(a.valor_m2)).sort((x, y) => x - y);
    if (vals.length < 4) return null;
    const pct = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    return { venda_m2: Math.round(pct(0.50)), bandas: { popular: Math.round(pct(0.25)), medio: Math.round(pct(0.50)), alto: Math.round(pct(0.75)) }, n: vals.length };
  } catch { return null; }
}
async function lerIndiceBidPro(imDb, segmento = 'apartamento') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    let j = null;
    try {
      const r = await sb('rpc/indice_bidpro_regiao', {
        method: 'POST',
        body: JSON.stringify({
          p_cidade_norm: imDb.cidade_norm, p_uf: imDb.estado, p_bairro: imDb.bairro || '',
          p_lat: imDb.latitude ?? null, p_lng: imDb.longitude ?? null, p_tipo: segmento,
        }),
      });
      j = await r.json().catch(() => null);
    } catch { j = null; }
    // PREFERE a MEDIANA aparada por tipo (base própria) — corrige o preço BLENDADO do fallback
    // (Alphaville×popular ~R$6.921 que não servia a ninguém). Mantém aluguel/nível do RPC. Só cai
    // no número blendado quando não há amostra própria suficiente (< 4).
    const central = await centralIndiceRegiao(imDb, segmento);
    if (central) return { venda_m2: central.venda_m2, aluguel_m2: Number(j?.aluguel_m2) || 0, nivel: j?.nivel || 'cidade', bandas: central.bandas };
    if (j && (Number(j.venda_m2) > 0 || Number(j.aluguel_m2) > 0)) return j;
    // ÚLTIMO nível do cascata: ESTADO (referência ampla majorada) quando a cidade não tem base
    // própria — dá um valor de referência em vez de nada (deixa EXPLÍCITO que é do estado).
    try {
      const re = await sb('rpc/indice_estado_ponderado', { method: 'POST', body: JSON.stringify({ p_uf: imDb.estado, p_tipo: segmento }) });
      const e = await re.json().catch(() => null);
      if (e && Number(e.venda_m2) > 0) return {
        venda_m2: Number(e.venda_med) > 0 ? Number(e.venda_med) : Number(e.venda_m2), aluguel_m2: 0, nivel: 'estado',
        bandas: Number(e.venda_pop) > 0 ? { popular: e.venda_pop, medio: e.venda_med, alto: e.venda_alto } : null };
    } catch { /* sem base no estado ainda */ }
    return null;
  } catch { return null; }
}

// Guarda DETERMINÍSTICA anti-leilão: mesmo o prompt mandando descartar leilão, o LLM às
// vezes inclui um comparável de leilão/Caixa (ex.: "LeilaoImovel / CEF", "... / CEF"),
// cujo preço fica 30–60% abaixo e CONTAMINA o índice (derruba o R$/m² da região). Aqui
// barramos pela FONTE antes de gravar — não confia só no prompt.
const FONTE_LEILAO = /leil[ãa]o|arremat|hasta.?p[uú]bl|\bcef\b|caixa\s*econ|aliena[çc]|extrajud|retomad|venda\s*direta|megaleil|zukerman|foreclos/i;
const ehFonteLeilao = (f) => FONTE_LEILAO.test(String(f || ''));

// Faixa PLAUSÍVEL de R$/m² de VENDA por TIPO — espelha public.indice_plausivel. Barra outlier E
// não descarta TERRENO legítimo (R$/m² baixo, ex.: R$150), que o piso plano de 200 rejeitava.
// Usada em TODAS as escritas/leituras do índice no relatório (antes usavam 200–50000 fixo).
const FAIXA_VENDA_TIPO = { apartamento: [800, 60000], casa: [600, 50000], comercial: [400, 80000], terreno: [20, 20000] };
const faixaVenda = (tipo) => FAIXA_VENDA_TIPO[String(tipo || '').toLowerCase()] || [200, 200000];
const vendaPlausivelTipo = (tipo, v) => { const [lo, hi] = faixaVenda(tipo); const n = Number(v); return n >= lo && n <= hi; };
const faixaVendaQ = (tipo) => { const [lo, hi] = faixaVenda(tipo); return `valor_m2=gte.${lo}&valor_m2=lte.${hi}`; };

// Grava as amostras DATADAS deste relatório em indice_amostra (base da valorização por
// ano e da recência real). Só residencial, poison-resistente (dados da pesquisa). O prompt
// já descarta leilão das amostras → arremate NUNCA entra aqui. Dedup pelo índice único.
// Normalização de bairro (igual ao _bairro_norm do banco) e grid ~1km ('lat.dd,lng.dd')
// — para escopar as amostras por LOCALIDADE e permitir o reaproveitamento por bairro/grid.
const _norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// cidade_norm no formato do banco (imoveis_leilao/indice_amostra): minúsculas, sem acento e SEM
// separadores (ex.: "São Bernardo" → "saobernardo"). Difere do _norm, que mantém espaço (usado p/ bairro).
const _cidadeNorm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const geoGridDe = (lat, lng) => (Number.isFinite(Number(lat)) && Number.isFinite(Number(lng))) ? `${Number(lat).toFixed(2)},${Number(lng).toFixed(2)}` : '';

// TRIANGULAÇÃO DO IMÓVEL-ALVO (pedido do dono): quando a coordenada do imóvel é IMPRECISA (nível
// bairro/cidade/nula), o raio de 250m/1km do relatório ancora num centroide errado. Aqui, NO
// MOMENTO do relatório, re-triangulamos pelo ENDEREÇO + CEP (Correios/ViaCEP) + IBGE — a cascata
// GRÁTIS de _geo.js (sem Google) — para obter uma âncora melhor e PERSISTIMOS a coord (conserta o
// índice e os próximos relatórios). Reusa exatamente o motor do geocodificar-imovel. Best-effort,
// time-boxed; nunca bloqueia o relatório. Se já está preciso (rua/endereço), não mexe.
async function ancorarImovel(imovelId, deadline) {
  try {
    const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=id,endereco,bairro,cidade,estado,latitude,longitude,geocod_nivel,cep,condominio:nomecondominio&limit=1`)).json();
    if (!im) return null;
    const nivelAtual = im.geocod_nivel || (im.latitude != null ? 'cidade' : null);
    const atualValida = im.latitude != null && coordValida(Number(im.latitude), Number(im.longitude), im.estado, im.cidade);
    if (atualValida && rankNivel(nivelAtual) >= rankNivel('rua')) return { nivel: nivelAtual, alterado: false }; // já preciso
    const coords = await geocodificarCascata(im, { sleepMs: 0, permitirPago: false, deadline });
    if (coords && coordValida(coords.lat, coords.lng, im.estado, im.cidade) && (!atualValida || rankNivel(coords.nivel) > rankNivel(nivelAtual))) {
      await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ latitude: coords.lat, longitude: coords.lng, geocod_nivel: coords.nivel }) });
      return { nivel: coords.nivel, alterado: true };
    }
    return { nivel: nivelAtual, alterado: false };
  } catch { return null; }
}

async function gravarAmostrasIndice(imDb, mercado, imovelId, segmento = 'apartamento') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return;
    const uf = String(imDb.estado).toUpperCase();
    const bairroNorm = _norm(imDb.bairro);          // bairro do imóvel-alvo (fallback)
    const bDe = (s) => _norm(s?.bairro) || bairroNorm;   // bairro POR AMOSTRA (a IA marca cada uma)
    const geoGrid = geoGridDe(imDb.latitude, imDb.longitude);
    // Coordenada do imóvel-alvo → guardada em cada amostra p/ o recorte por RAIO (~250m) no Índice.
    const latA = Number.isFinite(Number(imDb.latitude)) ? Number(imDb.latitude) : null;
    const lngA = Number.isFinite(Number(imDb.longitude)) ? Number(imDb.longitude) : null;
    const nowMes = new Date().toISOString().slice(0, 7);
    const dref = (d) => (/^\d{4}-\d{2}$/.test(String(d || '')) ? `${d}-01` : `${nowMes}-01`);
    const vendas = [...(mercado.nivel1?.vendas || []), ...(mercado.nivel2?.vendas || [])];
    const locs   = [...(mercado.nivel1?.locacoes || []), ...(mercado.nivel2?.locacoes || [])];
    const rows = [];
    for (const s of vendas) {
      const m2 = Number(s?.valorM2);
      if (!vendaPlausivelTipo(segmento, m2) || ehFonteLeilao(s?.fonte)) continue; // faixa por tipo (terreno não é cortado)
      rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: bDe(s), geo_grid: geoGrid, lat: latA, lng: lngA, tipo: segmento,
        especie: 'venda', valor_m2: Math.round(m2), valor_total: Number(s?.valor) || null, area_m2: Number(s?.m2) || null,
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), origem: 'relatorio', imovel_id: String(imovelId || '') });
    }
    for (const s of locs) {
      const mensal = Number(s?.valorMensal); const area = Number(s?.m2);
      if (!(mensal > 0) || ehFonteLeilao(s?.fonte)) continue;
      const vm2 = area > 0 ? Math.round((mensal / area) * 100) / 100 : null;
      rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: bDe(s), geo_grid: geoGrid, lat: latA, lng: lngA, tipo: segmento,
        especie: 'locacao', valor_m2: (vm2 && vm2 >= 1 && vm2 <= 1000) ? vm2 : null, valor_total: mensal, area_m2: area || null,
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), origem: 'relatorio', imovel_id: String(imovelId || '') });
    }
    // COLHEITA AMPLA — MESMO TIPO em OUTROS bairros (pedido do dono: "extrair o máximo mesmo fora
    // da localidade e marcar pelo bairro para ir compondo cidade/estado"). Vai à base com o bairro
    // de CADA amostra, nível CIDADE (sem grid/coord do alvo — são de outros bairros); geocodifica
    // depois pelo bairro (cron gratuito). NUNCA entra no valor do imóvel-alvo, só no Índice.
    for (const s of (mercado.outrosBairros || [])) {
      const m2 = Number(s?.valorM2); const b = _norm(s?.bairro);
      if (!b || !vendaPlausivelTipo(segmento, m2) || ehFonteLeilao(s?.fonte)) continue;
      rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: b, geo_grid: '', lat: null, lng: null, tipo: segmento,
        especie: 'venda', valor_m2: Math.round(m2), valor_total: Number(s?.valor) || null, area_m2: Number(s?.m2) || null,
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), origem: 'relatorio_regiao', imovel_id: String(imovelId || '') });
    }
    if (!rows.length) return;
    await sb('indice_amostra', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(rows) });
  } catch { /* aprendizado é best-effort: nunca bloqueia o relatório */ }
}

// COLHEITA DE OUTRAS TIPOLOGIAS (aproveitamento da MESMA busca — pedido do dono): a IA lista em
// mercado.outrasTipologias os comparáveis de VENDA que JÁ VIU de outros segmentos (apto/casa/
// terreno/comercial) na mesma cidade, SEM buscas dedicadas. Semeamos o Índice desses segmentos
// no nível CIDADE (bairro/grid VAZIOS de propósito: o quarteirão do imóvel-alvo NÃO vale para
// uma casa do outro lado da cidade), sem leilão, com teto por segmento. Uma busca paga passa a
// semear vários segmentos. NUNCA entra no valor do relatório atual (só na base do Índice).
const OUTRAS_SEGS = ['apartamento', 'casa', 'terreno', 'comercial'];
const TETO_OUTRA_SEG = 15;
async function gravarOutrasTipologias(imDb, outras, imovelId, segAlvo = '') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado || !outras || typeof outras !== 'object') return 0;
    const uf = String(imDb.estado).toUpperCase();
    const nowMes = new Date().toISOString().slice(0, 7);
    const dref = (d) => (/^\d{4}-\d{2}$/.test(String(d || '')) ? `${d}-01` : `${nowMes}-01`);
    const rows = [];
    for (const seg of OUTRAS_SEGS) {
      if (seg === segAlvo) continue; // o tipo-alvo já foi gravado por gravarAmostrasIndice (com geo)
      const lista = Array.isArray(outras[seg]) ? outras[seg].slice(0, TETO_OUTRA_SEG) : [];
      for (const s of lista) {
        const m2 = Number(s?.valorM2);
        if (!vendaPlausivelTipo(seg, m2) || ehFonteLeilao(s?.fonte)) continue; // só venda de mercado, faixa por tipo
        rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: '', geo_grid: '', tipo: seg,
          especie: 'venda', valor_m2: Math.round(m2), valor_total: Number(s?.valor) || null, area_m2: Number(s?.m2) || null,
          data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), origem: 'relatorio_regiao', imovel_id: String(imovelId || '') });
      }
    }
    if (!rows.length) return 0;
    await sb('indice_amostra', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(rows) });
    console.log('[outras-tipologias]', JSON.stringify({ imovel: String(imovelId), n: rows.length, cidade: imDb.cidade_norm }));
    return rows.length;
  } catch { return 0; }
}

// REAPROVEITAMENTO POR REGIÃO (cache do mercadológico). Quando a microrregião já tem uma
// amostra DENSA e RECENTE de VENDA na base própria (indice_amostra, capturada por relatórios
// anteriores, SEM leilão), reaproveitamos esses comparáveis REAIS em vez de refazer a pesquisa
// web cara toda vez. Escopo do MAIS FINO ao mais amplo: bairro_norm → grid (~1 km) → cidade —
// para no 1º nível com densidade suficiente. Devolve só HIT com >= MIN amostras e recência
// <= DIAS. Não substitui a IA: injeta os comparáveis no prompt como ÂNCORA e permite reduzir a
// busca web (5 → 2 usos), deixando a IA só complementar lacunas (padrão, anúncio ativo).
// Thresholds e liga/desliga por env (MERCADO_CACHE / MERCADO_CACHE_MIN / MERCADO_CACHE_DIAS).
async function amostrasRegiaoCache(imDb, segmento = 'apartamento') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    const MIN = Math.max(4, Number(process.env.MERCADO_CACHE_MIN || 8));   // densidade mínima p/ confiar
    // FRESCOR PELO QUADRIMESTRE DO DADO (data_ref = data do anúncio), não por quando foi capturado
    // (criado_em). Regra do dono: "se o quadrimestre for mais distante da data atual, refaz a busca".
    // 120 dias ~ 1 quadrimestre. Sem ≥MIN amostras DATADAS nesse período → miss → o chamador refaz a
    // pesquisa COMPLETA (atualiza o índice p/ todos); com densidade recente → reusa (não desperdiça).
    const DIAS = Math.max(15, Number(process.env.MERCADO_CACHE_DIAS || 120));
    const uf = String(imDb.estado).toUpperCase();
    const bairroNorm = _norm(imDb.bairro);
    const geoGrid = geoGridDe(imDb.latitude, imDb.longitude);
    const desde = new Date(Date.now() - DIAS * 24 * 3600 * 1000).toISOString().slice(0, 10); // data_ref é DATE
    const baseFiltro = `cidade_norm=eq.${encodeURIComponent(imDb.cidade_norm)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(segmento)}&especie=eq.venda&${faixaVendaQ(segmento)}&data_ref=gte.${desde}`;
    const cols = 'select=valor_m2,valor_total,area_m2,data_ref,fonte,bairro_norm,geo_grid,criado_em&order=criado_em.desc&limit=400';
    const buscar = async (extra) => {
      try {
        const r = await sb(`indice_amostra?${baseFiltro}${extra}&${cols}`);
        if (!r.ok) return [];
        const j = await r.json().catch(() => []);
        return (Array.isArray(j) ? j : []).filter(a => Number(a.valor_m2) > 0 && !ehFonteLeilao(a.fonte));
      } catch { return []; }
    };
    // MAIS FINO → mais amplo; para no 1º nível com densidade suficiente.
    let nivel = '', arr = [];
    if (bairroNorm) { const a = await buscar(`&bairro_norm=eq.${encodeURIComponent(bairroNorm)}`); if (a.length >= MIN) { nivel = 'bairro'; arr = a; } }
    if (!nivel && geoGrid) { const a = await buscar(`&geo_grid=eq.${encodeURIComponent(geoGrid)}`); if (a.length >= MIN) { nivel = 'grid'; arr = a; } }
    if (!nivel) { const a = await buscar(''); if (a.length >= MIN) { nivel = 'cidade'; arr = a; } }
    if (!nivel) return null;
    const m2s = arr.map(a => Number(a.valor_m2)).filter(v => v > 0).sort((a, b) => a - b);
    const mediana = m2s.length ? (m2s.length % 2 ? m2s[(m2s.length - 1) / 2] : Math.round((m2s[m2s.length / 2 - 1] + m2s[m2s.length / 2]) / 2)) : 0;
    // Bloco de TEXTO p/ o prompt: comparáveis reais já capturados na região (âncora).
    const linhas = arr.slice(0, 40).map(a => {
      const ar = Number(a.area_m2) > 0 ? ` · ${Math.round(a.area_m2)} m²` : '';
      const vt = Number(a.valor_total) > 0 ? ` · R$${Math.round(a.valor_total).toLocaleString('pt-BR')}` : '';
      const ft = a.fonte ? ` · ${String(a.fonte).slice(0, 60)}` : '';
      return `- ${Math.round(a.valor_m2).toLocaleString('pt-BR')} R$/m²${ar}${vt}${ft} (ref ${String(a.data_ref || '').slice(0, 7)})`;
    }).join('\n');
    const text = `\n\nBASE PRÓPRIA DA REGIÃO (Índice BidPro — ${arr.length} comparáveis de VENDA do MESMO tipo já capturados no nível ${nivel}, SEM leilão; mediana ${Math.round(mediana).toLocaleString('pt-BR')} R$/m²). Use estes comparáveis REAIS como ÂNCORA principal e complemente com no MÁXIMO 1–2 buscas web só para preencher lacunas (padrão do imóvel, anúncios ativos recentes). NÃO ignore esta base nem invente números fora dela:\n${linhas}`;
    return { hit: true, nivel, n: arr.length, mediana, text };
  } catch { return null; }
}

// Valorização por ano (mediana de R$/m² de VENDA) da microrregião — vai no relatório
// como MAIS UMA referência (curva no tempo), independente do FipeZAP.
async function lerValorizacao(imDb, segmento = 'apartamento') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    const r = await sb('rpc/indice_valorizacao_anual', { method: 'POST', body: JSON.stringify({
      p_cidade_norm: imDb.cidade_norm, p_uf: imDb.estado, p_tipo: segmento, p_especie: 'venda', p_anos: 6 }) });
    if (!r.ok) return null;
    const v = await r.json().catch(() => null);
    return (v && Array.isArray(v.serie) && v.serie.length >= 2) ? v : null;
  } catch { return null; }
}

// COMPOSIÇÃO TEMPORAL da região p/ o mercadológico (mesma matemática do Índice): períodos de
// 4 meses, quantitativo e valor RECENTE quando há amostra nova; senão PROJETA os anúncios
// antigos p/ hoje pela curva da própria região. Base = indice_amostra (venda, sem leilão).
async function lerComposicaoRegiao(imDb, segmento = 'apartamento') {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    const uf = String(imDb.estado).toUpperCase();
    const filtro = `cidade_norm=eq.${encodeURIComponent(imDb.cidade_norm)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(segmento)}&especie=eq.venda&${faixaVendaQ(segmento)}`;
    const r = await sb(`indice_amostra?${filtro}&select=valor_m2,data_ref,fonte&order=data_ref.desc&limit=600`);
    if (!r.ok) return null;
    const j = await r.json().catch(() => []);
    const rows = (Array.isArray(j) ? j : []).filter(a => Number(a.valor_m2) > 0 && !ehFonteLeilao(a.fonte));
    if (rows.length < 4) return null; // sem base suficiente na região
    // Curva por ano (mediana R$/m² de venda) para a taxa de projeção.
    const porAno = {};
    for (const a of rows) { const y = String(a.data_ref || '').slice(0, 4); if (/^\d{4}$/.test(y)) (porAno[y] ||= []).push(Number(a.valor_m2)); }
    const med = (arr) => { const s = arr.slice().sort((x, y) => x - y); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); };
    const amostrasAno = Object.keys(porAno).sort().map(y => ({ ano: Number(y), n: porAno[y].length, m2: med(porAno[y]) })).filter(p => p.n >= 2 && p.m2 > 0);
    // BANDA CENTRAL (p25–p75) — MESMA contramedida do Índice (indice-consulta.js). Sem ela o
    // mercadológico usava a mediana CRUA e a composição por período "virava" com a bimodalidade
    // popular×alto (ex.: Barueri set–dez/2025 = R$3.990). A banda estabiliza a série no tempo.
    const m2Ord = rows.map(a => Number(a.valor_m2)).filter(v => v > 0).sort((x, y) => x - y);
    const pctl = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);
    const bandaCentral = m2Ord.length >= 6 ? { lo: pctl(m2Ord, 0.25), hi: pctl(m2Ord, 0.75) } : null;
    return composicaoTemporal(rows, amostrasAno, Date.now(), bandaCentral);
  } catch { return null; }
}

// CLASSIFICAÇÃO DE INTENÇÃO — o mesmo objetivo dos filtros da busca (revenda/locação/temporada),
// agora DENTRO do relatório: diz para QUÊ o imóvel é bom (um, vários ou os três) e POR QUÊ.
// Alimenta a defesa do parecer e o aprendizado. Critérios ancorados nos dados que já temos.
function classificarIntencao({ baseTipo, desconto, yieldBruto, cidadeNorm }) {
  const residencial = baseTipo === 'residencial';
  const liquido = baseTipo === 'residencial' || baseTipo === 'comercial';
  const cls = { revenda: false, locacao: false, temporada: false, motivos: {} };
  if (liquido && Number(desconto) >= 30) {
    cls.revenda = true;
    cls.motivos.revenda = `Desconto de ${Math.round(desconto)}% frente à avaliação: margem de revenda (flip) saudável e boa liquidez do tipo.`;
  }
  const y = Number(yieldBruto) || 0;
  if (residencial && y >= 6) {
    cls.locacao = true;
    cls.motivos.locacao = `Yield bruto de locação ~${y.toFixed(1)}% a.a.: renda de aluguel atrativa para o perfil de renda.`;
  }
  if (residencial && ehCidadeTemporada(cidadeNorm)) {
    cls.temporada = true;
    cls.motivos.temporada = motivoTemporada(cidadeNorm) || 'Cidade de destino turístico: potencial de aluguel por temporada (curta duração).';
  }
  cls.algum = cls.revenda || cls.locacao || cls.temporada;
  return cls;
}

// Anti-SSRF simples: as URLs vêm do banco (leiloeiro/anexos) — bloqueia destinos internos/
// metadados; libera o resto. Evita que um anexo com host interno vire uma requisição indevida.
function hostExterno(u) {
  try {
    const h = new URL(u).hostname.toLowerCase();
    if (h === 'localhost' || h.endsWith('.internal') || h.endsWith('.local')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return false;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return false;
    if (h === '::1' || h === 'metadata.google.internal') return false;
    return true;
  } catch { return false; }
}
// EDITAL/MATRÍCULA em PDF: extração FOCADA via IA (só avaliação + lance mínimo) — barata e curta,
// disparada apenas quando o valor falta E o documento é PDF (o fetch grátis não dá pra regex).
async function extrairValoresPdf(base64, deadline) {
  const budget = deadline - Date.now();
  if (budget < 12000) return null; // sem tempo suficiente p/ a IA ler o PDF
  const data = await anthropic({
    model: MODEL, max_tokens: 300,
    system: 'Você lê documentos de leilão de imóvel. Responda SOMENTE JSON válido, sem markdown.',
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 }, title: 'documento do lote' },
      { type: 'text', text: 'Extraia do edital/matrícula: {"avaliacao": number, "lanceMinimo": number}. avaliacao = valor de AVALIAÇÃO do imóvel (auto/laudo de avaliação) em reais; lanceMinimo = menor lance admitido (1º leilão/praça) em reais. SÓ números (sem "R$", sem pontos de milhar). Se não constar no documento, use 0. NUNCA invente.' },
    ] }],
  }, false, { retries: 0, timeoutMs: Math.min(30000, budget - 3000), noFallback: true });
  return parseJSON(extractText(data));
}

// Confirmação SOB DEMANDA de VALORES consultando o EDITAL (só quando um relatório é pedido —
// sem varredura em massa). Cobre dois casos:
//  - AVALIAÇÃO ausente (ex.: GrupoLance/LJUD judicial — só vem no edital/laudo, não no card);
//  - LANCE MÍNIMO ausente/sentinela (ex.: o scraper anulou um 999999999 — regra do dono:
//    "se vier valor assim, acessar o edital pra confirmar o valor da venda").
// ASSERTIVIDADE: consulta VÁRIAS fontes (edital, matrícula, anexos, página do lote), não só o
// card — HTML por regex; PDF por IA focada. Fetch DIRETO (grátis); o Bright Data (pago) fica para
// o relatório documental. Corrige no banco (com desconto/score) e o que não confirmar vira anomalia.
async function garantirValores(imovelId, deadline) {
  let im = null;
  try {
    const rows = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=fonte,url_lote,link_edital,link_matricula,anexos,valor_avaliacao,valor_minimo&limit=1`)).json();
    im = Array.isArray(rows) ? rows[0] : null;
  } catch { return; }
  if (!im) return;
  const SENT = new Set([999999999, 99999999, 9999999999, 111111111, 123456789]);
  const limpo = (v) => { const n = Number(v) || 0; return SENT.has(n) ? 0 : n; };
  let aval = limpo(im.valor_avaliacao);
  let vmin = limpo(im.valor_minimo);
  const faltaAval = aval <= 0, faltaMin = vmin <= 0;
  if (!faltaAval && !faltaMin) return; // nada a confirmar
  const jaTem = () => (!faltaAval || aval > 0) && (!faltaMin || vmin > 0);

  // Fontes candidatas, do documento mais provável (edital/matrícula/anexos = onde a avaliação
  // realmente consta) para o menos (página do lote, em geral SPA sem o valor). Dedup + externas.
  const anexosUrls = Array.isArray(im.anexos) ? im.anexos.map(a => a?.url).filter(Boolean) : [];
  const candidatos = [...new Set([im.link_edital, im.link_matricula, ...anexosUrls, im.url_lote])]
    .filter(u => u && /^https?:\/\//.test(u) && hostExterno(u));
  // Prioriza DOCUMENTOS (PDF / endpoint de edital) sobre PÁGINAS de lote: a página costuma ser
  // SPA (Grupo Lance/LJUD) — o valor é renderizado por JS e NÃO está no HTML cru do fetch, além
  // de a leitura por IA do PDF exigir ≥12s de orçamento. Tentar o PDF PRIMEIRO garante que ele
  // pegue o tempo (era o bug: o edital-PDF vinha por último e ficava sem orçamento → avaliação
  // "não informada" mesmo com o edital em mãos, ex.: terreno Grupo Lance de Santana de Parnaíba).
  const ehDoc = (u) => /\.pdf(\?|#|$)|\/edital|documentacao/i.test(u) ? 0 : 1;
  candidatos.sort((a, b) => ehDoc(a) - ehDoc(b));

  let usei = im.url_lote || im.link_edital || '';
  for (const url of candidatos) {
    if (jaTem() || Date.now() > deadline) break;
    usei = url;
    let doc = null;
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(12000) });
      if (!r.ok) continue;
      const ct = r.headers.get('content-type') || '';
      const buf = Buffer.from(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
      if (!buf.length) continue;
      const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
      if (ehPdf) doc = { kind: 'pdf', base64: buf.length <= 6_500_000 ? buf.toString('base64') : null };
      else doc = { kind: 'text', text: buf.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ') };
    } catch { continue; } // fonte inacessível → tenta a próxima
    if (doc.kind === 'text' && doc.text) {
      const txt = doc.text;
      const maior = (re) => { let best = 0; for (const m of txt.matchAll(re)) { const v = parseFloat(m[1].replace(/\./g, '').replace(',', '.')) || 0; if (v > best) best = v; } return best; };
      if (faltaAval && aval <= 0) { const a = maior(/avalia[çc][aã]o[^R]{0,40}R\$\s*([\d.]+,\d{2})/gi); if (a >= 1000) aval = a; }
      if (faltaMin && vmin <= 0) { const mn = maior(/(?:lance\s*m[íi]nimo|valor\s*m[íi]nimo|lance\s*inicial|1[ºoª°]?\s*(?:leil[aã]o|pra[çc]a)|2[ºoª°]?\s*(?:leil[aã]o|pra[çc]a))[^R]{0,40}R\$\s*([\d.]+,\d{2})/gi); if (mn >= 1000) vmin = mn; }
    } else if (doc.kind === 'pdf' && doc.base64 && Date.now() < deadline) {
      try {
        const ext = await extrairValoresPdf(doc.base64, deadline);
        if (faltaAval && aval <= 0 && Number(ext?.avaliacao) >= 1000) aval = Number(ext.avaliacao);
        if (faltaMin && vmin <= 0 && Number(ext?.lanceMinimo) >= 1000) vmin = Number(ext.lanceMinimo);
      } catch { /* IA falhou nesta fonte → tenta a próxima */ }
    }
  }

  // SANIDADE do valor LIDO do edital: uma avaliação muito acima do lance mínimo (desconto
  // implícito > 90%) é quase sempre MIS-READ (a IA/regex pegou um total de vários lotes, outra
  // métrica, ou erro) — não pode virar um "94% de desconto" FALSO no card. Descarta e sinaliza.
  if (faltaAval && aval > 0 && vmin > 0 && aval > vmin * 10) {
    await registrarAnomalia('avaliacao_incoerente', im.fonte, imovelId, 'valor_avaliacao',
      `Avaliação lida R$${Math.round(aval)} vs lance mínimo R$${Math.round(vmin)} (${(aval / vmin).toFixed(1)}x = desconto ~${Math.round((1 - vmin / aval) * 100)}%) — provável leitura errada do edital. Descartada (mantém sem avaliação).`);
    aval = 0;
  }

  const patch = {};
  if (faltaAval && aval > 0) patch.valor_avaliacao = aval;
  if (faltaMin && vmin > 0) patch.valor_minimo = vmin;
  const par = aval > 0 && vmin > 0 && aval >= vmin; // desconto só faz sentido com avaliação >= mínimo
  if (par && (patch.valor_avaliacao != null || patch.valor_minimo != null)) {
    patch.desconto_percentual = Math.round((1 - vmin / aval) * 100);
    patch.viavel = (1 - vmin / aval) >= 0.3;
    patch.score_viabilidade = Math.min(100, Math.round((1 - vmin / aval) * 150));
  }
  if (Object.keys(patch).length) {
    await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch) });
  }
  if (aval <= 0) await registrarAnomalia('avaliacao_ausente', im.fonte, imovelId, 'valor_avaliacao', `Avaliação não confirmada no edital/matrícula/anexos (${usei || 'sem url'}).`);
  if (vmin <= 0) await registrarAnomalia('valor_minimo_ausente', im.fonte, imovelId, 'valor_minimo', `Lance mínimo não confirmado no edital/matrícula/anexos (${usei || 'sem url'}).`);
}
// Pesquisa de mercado recente do MESMO imóvel (de qualquer usuário). Reaproveitada
// para não refazer a busca cara a cada pedido — só a data é renovada. O laudo
// (parecer) continua sendo gerado por pedido, pois depende do lance/cenário de cada um.
async function mercadoRecente(imovelId) {
  const desde = new Date(Date.now() - REUSE_DIAS * 24 * 3600 * 1000).toISOString();
  const r = await sb(`analises_mercado?imovel_id=eq.${encodeURIComponent(imovelId)}&status=eq.concluida&updated_at=gte.${desde}&select=result,updated_at&order=updated_at.desc&limit=1`);
  if (!r.ok) return null;
  const [row] = await r.json().catch(() => []);
  const mkt = row?.result?.mercado;
  // NÃO reaproveita pesquisa VAZIA (sem amostras nem preço): reusar um resultado
  // ruim propagaria o "mercadológico sem amostras". Melhor refazer a busca.
  if (mkt && (((mkt.vendas?.length || 0) + (mkt.locacoes?.length || 0)) > 0 || mkt.precoMedioM2 > 0)) {
    return { mercado: mkt, em: row.updated_at };
  }
  return null;
}

async function anthropic(payload, useSearch, fetchOpts) {
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (useSearch) headers['anthropic-beta'] = 'web-search-2025-03-05';
  const r = await anthropicFetch({ method: 'POST', headers, body: JSON.stringify(payload) }, fetchOpts);
  // FALHA-ALTO: um erro NÃO-retryável do Anthropic (400 modelo/beta inválido, 401 chave, 404,
  // web_search indisponível) NÃO pode virar "mercado vazio" silencioso — o parseJSON do corpo
  // de erro devolvia {} → 0 amostras → relatório inútil "concluído". Loga e PROPAGA a falha
  // para o chamador tratar (re-tentar / cair no Índice BidPro). Era a causa-raiz do relatório vazio.
  if (!r.ok) {
    let corpo = ''; try { corpo = JSON.stringify(await r.clone().json()); } catch { try { corpo = await r.text(); } catch { /* corpo indisponível */ } }
    console.error('[anthropic] HTTP', r.status, String(corpo).slice(0, 600));
    throw new Error(`anthropic_http_${r.status}`);
  }
  const j = await r.json();
  try { _custoMicroReq += custoRespostaClaude(payload?.model, j?.usage); } catch { /* medição nunca quebra a geração */ }
  return j;
}

export function promptMercado({ endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio }) {
  return `Você é um perito avaliador imobiliário. Realize pesquisa de mercado COMPLETA em DOIS NÍVEIS para o imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

REGRA OBRIGATÓRIA — MESMO TIPO: considere SOMENTE imóveis do MESMO TIPO (${tipoImovel}).
Descarte qualquer amostra de tipo diferente. Compare sempre ${tipoImovel} com ${tipoImovel}.

MÉTODO DE AVALIAÇÃO POR TIPO (DIRECIONE a avaliação pelo tipo "${tipoImovel}" — cada tipo tem
uma BASE DE CÁLCULO e itens próprios; usar a régua errada gera valor irreal):
- Apartamento / unidade em CONDOMÍNIO: preço por m² PRIVATIVO de aptos do mesmo condomínio/edifício e região; ajuste por andar, nº de VAGAS, estado, lazer.
- Casa de rua (urbana): preço por m² CONSTRUÍDO da região/padrão (o terreno padrão já está embutido no comparável de casas); ajuste por padrão construtivo, idade e garagem.
- Imóvel com TERRENO EXCEDENTE (edificação em lote MUITO acima do padrão da quadra): avalie a CONSTRUÇÃO por m² construído E SOME, À PARTE, a ÁREA DE TERRENO EXCEDENTE (o que passa do padrão) por R$/m² de TERRENO. NUNCA multiplique o R$/m² de construção pela área total do lote. Considere potencial de desmembramento/incorporação (zoneamento).
- Terreno / lote urbano: preço por m² de TERRENO (nunca de construção); considere ZONEAMENTO/coeficiente de aproveitamento (potencial construtivo), frente, esquina e topografia.
- Áreas / GLEBAS (grande porte): por m² OU por hectare conforme o porte; considere potencial de PARCELAMENTO/loteamento, infraestrutura e restrições ambientais.
- Comercial (sala, loja, conjunto): preço por m² COMERCIAL na mesma vocação/região; considere ponto/fluxo, vaga e potencial de LOCAÇÃO (cap rate comercial).
- Galpão / INDÚSTRIA / logística: preço por m² de área CONSTRUÍDA do galpão (+ terreno quando relevante), considerando PÉ-DIREITO, docas, piso/carga, ZONEAMENTO industrial, acesso rodoviário e energia; comparáveis de galpões, JAMAIS residenciais.
- Rural (FAZENDA, sítio, chácara): avalie por HECTARE (terra nua) + BENFEITORIAS à parte, considerando aptidão do solo (lavoura/pasto), recursos hídricos, CAR/georreferenciamento, culturas e acesso; comparáveis RURAIS (por ha) da região.
- Vaga de garagem / box: por UNIDADE, com comparáveis de vagas/boxes da região.
- Atípico/especial (posto, hotel, imóvel de uso específico, terreno de marinha): mercado RASO. Busque o tipo específico; sem ao menos 3–4 amostras coerentes, diga EXPLICITAMENTE que a estimativa é apenas INDICATIVA, alargue a faixa (precoMinM2/precoMaxM2) e recomende laudo presencial. NUNCA force média residencial num imóvel atípico/rural.
Se o tipo exigir outra unidade que não o m² de construção (rural por hectare, terreno por m² de lote, vaga por unidade), use essa unidade em precoMedioM2, informe em "consolidado.unidadeValor" e explique a conta em "consolidado.baseCalculo".

REGRA OBRIGATÓRIA — NADA DE LEILÃO NA AMOSTRA: descarte QUALQUER anúncio de leilão, praça,
hasta pública, venda direta bancária/Caixa, alienação fiduciária, extrajudicial/judicial ou
imóvel retomado. Esses preços ficam 30–60% abaixo do mercado e CONTAMINAM a média e o mínimo
(R$/m²). Compare só com o MERCADO LIVRE de venda normal. Outlier muito abaixo dos demais, sem
justificativa, também deve ser descartado como provável leilão disfarçado.

REGRA OBRIGATÓRIA — PADRÃO DO IMÓVEL (comparar SEMELHANTE com SEMELHANTE): identifique o
PADRÃO do imóvel avaliado — popular/econômico, médio, médio-alto, alto padrão ou luxo — a
partir do CONDOMÍNIO/empreendimento${nomeCondominio ? ` "${nomeCondominio}"` : ''}, do endereço,
da área e do acabamento típico da região. Use SOMENTE comparáveis do MESMO padrão: um
condomínio FECHADO / de ALTO PADRÃO NÃO se compara a casas populares de rua (e vice-versa) —
mesmo tipo e mesma cidade, o padrão muda o R$/m² em várias vezes. Se um comparável tiver
R$/m² muito distante do padrão do imóvel (ex.: cerca de metade, ou o dobro), é de OUTRO
padrão: DESCARTE. Em empreendimento de alto padrão com poucos anúncios internos, prefira
comparáveis do MESMO padrão na cidade/região a comparáveis apenas PRÓXIMOS porém de padrão
inferior. Informe o padrão em "consolidado.padraoImovel" e explique-o no "comentario".

OBJETIVO: reunir o MÁXIMO de amostras possível do tipo-alvo (${tipoImovel}). Faça várias buscas
em fontes diferentes e TRAGA TODAS as amostras coerentes que encontrar (não corte a lista para
"resumir": quanto mais comparáveis do MESMO tipo/padrão, melhor a média). Só depois filtre padrão/leilão.

═══ NÍVEL 1 — COMPARATIVOS DIRETOS (mesmo condomínio/endereço) ═══
Busque o máximo de anúncios de venda E locação DENTRO do mesmo condomínio/edifício ou
na mesma rua. Se NÃO encontrar ao menos 5 amostras, EXPANDA o raio para ~250m ao redor
do endereço para complementar (mantendo o mesmo tipo de imóvel). Meta: 8+ vendas e 5+ locações.

═══ NÍVEL 2 — VIZINHANÇA (bairro e adjacências, ~1km) ═══
Busque o máximo de anúncios (mesmo tipo) no bairro e adjacências (~1km). Meta: 15+ vendas e 8+ locações.

FONTES (grandes portais): ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Loft, 123i, Chaves na Mão, Net Imóveis. Cruze várias.

FONTES LOCAIS (OBRIGATÓRIO — frequentemente MAIS confiáveis): além dos grandes portais, busque também ANÚNCIOS DE IMOBILIÁRIAS DA PRÓPRIA CIDADE de ${cidade}/${estado}. Pesquise por "imobiliária ${cidade}", "imóveis à venda ${cidade}" (e o bairro, se houver) e abra os sites das imobiliárias locais — os anúncios delas costumam refletir MELHOR o preço praticado na praça e podem ser COMPLEMENTARES ou até DECISIVOS na composição do valor. Inclua essas amostras nos níveis 1/2 com "fonte" = nome da imobiliária local, e dê PESO ao menos igual ao dos grandes portais quando forem recentes e do mesmo tipo/microrregião. Ao final, liste em "fontesLocais" as imobiliárias LOCAIS que você usou/encontrou (nome + url do site) — nós memorizamos e reusamos nas próximas análises desta praça.

DATA DO ANÚNCIO: para CADA amostra, capture a data no campo "data" (formato "AAAA-MM"; senão "recente").
RECÊNCIA (IMPORTANTE): priorize FORTEMENTE anúncios do ANO CORRENTE e dos últimos ~12 meses. EVITE anúncios com mais de ~18 meses, a menos que não haja recentes suficientes — o preço muda rápido. Na média, dê MENOS peso às amostras antigas. Se a maioria das amostras for antiga (ex.: de anos anteriores), diga isso EXPLICITAMENTE no "comentario" e trate a estimativa como menos precisa (alargue precoMinM2/precoMaxM2).

═══ REFERÊNCIA INDEPENDENTE — ÍNDICE FipeZAP ═══
Busque o Índice FipeZAP mais recente para ${cidade}/${estado}: preço médio de VENDA por m²
(residencial), e a VALORIZAÇÃO acumulada em 12 meses da cidade. É uma referência oficial
independente da média de anúncios — serve para VALIDAR se nossa média está coerente. Se não
achar a cidade, use a região metropolitana/capital mais próxima e sinalize em "fonte". Se não
houver dado confiável, marque "encontrado": false (não invente número).

═══ ZONEAMENTO URBANO (uso do solo) ═══
Consulte o ZONEAMENTO OFICIAL do endereço no órgão municipal (Plano Diretor / Lei de Uso e Ocupação do Solo; em capitais use o GIS oficial: GeoSampa/SP, Data.Rio, IPPUC/Curitiba, BHMap/PBH etc.). Informe a ZONA e o que ela permite (residencial/comercial/misto; e gabarito/coeficiente de aproveitamento se constar) SOMENTE se achar em FONTE OFICIAL — e cite a fonte. Se NÃO houver fonte oficial confiável, marque "encontrado": false e diga exatamente ONDE obter (Secretaria de Urbanismo/Planejamento da Prefeitura, pelo endereço ou inscrição imobiliária). NUNCA invente ou especule a zona.

VALOR ESTIMADO DO IMÓVEL (OBRIGATÓRIO — é o número que sustenta o relatório): em
"consolidado.valorEstimadoImovel" calcule o valor de mercado CONSERVADOR do imóvel pelo MÉTODO
DO TIPO acima (não apenas preço/m² × área quando o tipo não for por m² privativo). Preencha também
"unidadeValor", "areaConsiderada" (a medida que multiplicou: m² privativo/construído/terreno OU
hectares OU unidades) e "baseCalculo" (a conta em texto). Para imóvel com TERRENO EXCEDENTE, some
a construção + o terreno excedente e detalhe em "terrenoExcedente". Se a área da métrica não for
confiável (ex.: veio a área TOTAL no lugar da privativa), DIGA no "comentario" e seja conservador.

═══ COLHEITA DE OUTRAS TIPOLOGIAS (aproveitamento — NÃO gaste buscas dedicadas) ═══
Ao pesquisar o tipo-alvo, você INEVITAVELMENTE verá anúncios de OUTRAS tipologias na MESMA
cidade (apartamento, casa, terreno, comercial). NÃO os use no cálculo do imóvel-alvo. Mas, para
não desperdiçar a pesquisa, LISTE em "outrasTipologias" os de VENDA que você JÁ VIU (sem buscas
dedicadas a eles), até ~12 por tipo, com R$/m² e data. Regras: apenas VENDA; NÃO repita o
tipo-alvo (${tipoImovel}); EXCLUA leilão/venda direta; só o que apareceu de fato (não invente).
Isso alimenta o Índice BidPro dos outros segmentos da região — economia da mesma busca.

═══ COLHEITA AMPLA — MESMO TIPO EM TODA A CIDADE (compõe o Índice) ═══
Ao pesquisar (grandes portais E imobiliárias LOCAIS), você verá MUITOS anúncios do MESMO tipo
(${tipoImovel}) em OUTROS bairros da cidade, fora da vizinhança do imóvel-alvo. NÃO os use no
valor do imóvel-alvo, MAS liste em "outrosBairros" ATÉ 25 (sem buscas dedicadas; NÃO passe de 25
para a resposta não estourar o limite e ser cortada), CADA UM com o seu "bairro" — isso alimenta o
Índice da cidade/estado (composição por bairro). PRIORIDADE ABSOLUTA: preencha nivel1/nivel2 por
completo ANTES de "outrosBairros"; se faltar espaço, corte "outrosBairros", nunca os níveis 1/2.
Apenas VENDA, mesmo tipo (${tipoImovel}), SEM leilão; o "bairro" de cada amostra é OBRIGATÓRIO.

═══ PERFIL DA REGIÃO (atratividade e valorização — explica o R$/m² da microrregião) ═══
Com base na sua pesquisa, classifique a REGIÃO (bairro/microrregião) do imóvel dentro de ${cidade}/${estado}:
- "tier": se está entre as MAIS valorizadas, INTERMEDIÁRIAS ou MENOS valorizadas da cidade (valorizado_alto|intermediario|valorizado_baixo);
- "atratividades": fatores POSITIVOS reais que puxam o valor (infraestrutura, comércio, transporte/mobilidade, escolas/saúde, áreas verdes/orla, novos empreendimentos, baixa vacância);
- "fragilidades": fatores que PESAM (risco de enchente, ruído, proximidade de indústria/insalubre, difícil acesso, saturação);
- "motivos": 1–2 frases explicando POR QUE a região é mais/menos valorizada (sustenta o ajuste vs. a mediana da cidade — casa com o padrão do imóvel).
Use o que aparecer na pesquisa (portais, imobiliárias locais, notícias). NÃO invente: sem base, deixe "tier":"" e explique a limitação em "motivos".

═══ SEGURANÇA PÚBLICA DA REGIÃO (dados OFICIAIS — factual, NUNCA rótulo subjetivo) ═══
Traga um perfil de segurança pública da região SOMENTE de FONTES OFICIAIS (Secretaria de Segurança
Pública do estado/SSP, ISP-RJ, Atlas da Violência/IPEA, dados municipais) — citando a FONTE e o PERÍODO.
Reporte indicadores FACTUAIS (ex.: faixa/tendência de índices de criminalidade da região ou município),
JAMAIS um juízo do tipo "bairro perigoso". Se NÃO houver dado oficial confiável para a região, marque
"encontrado": false e recomende diligência local (visita ao local, consulta de ocorrências) — não invente
nem estime. É diligência de investidor sobre a REGIÃO, não juízo de valor sobre quem mora nela.

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": { "descricao": "", "vendas": [{"bairro":"","descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"bairro":"","descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0, "disponiveis": true },
  "nivel2": { "descricao": "", "vendas": [{"bairro":"","descricao":"","valor":0,"m2":0,"valorM2":0,"fonte":"","data":"AAAA-MM"}], "locacoes": [{"bairro":"","descricao":"","valorMensal":0,"fonte":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0 },
  "consolidado": { "precoMedioM2": 0, "aluguelMedio": 0, "yieldBruto": 0, "yieldLiquido": 0, "valorEstimadoImovel": 0, "unidadeValor": "m2_privativo|m2_construido|m2_terreno|hectare|unidade", "areaConsiderada": 0, "baseCalculo": "(explique a conta: ex.: 'R$ 10.980/m² privativo × 30 m²' ou 'R$ 45.000/ha × 120 ha terra nua + R$ 200k benfeitorias' ou 'construção 90 m² × R$ 4.000 + terreno excedente 300 m² × R$ 800')", "padraoImovel": "popular|medio|medio_alto|alto|luxo", "terrenoExcedente": { "haExcedente": false, "areaExcedenteM2": 0, "valorTerrenoExcedente": 0 }, "descontoArremate": null },
  "referenciaFipeZap": { "encontrado": true, "precoMedioM2": 0, "valorizacao12m": 0, "mesReferencia": "AAAA-MM", "localidade": "", "fonte": "" },
  "outrasTipologias": { "apartamento": [{"valorM2":0,"valor":0,"m2":0,"fonte":"","data":"AAAA-MM"}], "casa": [], "terreno": [], "comercial": [] },
  "outrosBairros": [{"bairro":"","valorM2":0,"valor":0,"m2":0,"fonte":"","data":"AAAA-MM"}],
  "fontesLocais": [{"nome":"","url":""}],
  "zoneamento": { "encontrado": false, "zona": "", "resumoUso": "", "fonte": "", "ondeObter": "" },
  "perfilRegiao": { "tier": "valorizado_alto|intermediario|valorizado_baixo|", "atratividades": [""], "fragilidades": [""], "motivos": "" },
  "segurancaPublica": { "encontrado": false, "nivel": "", "indicadores": "", "tendencia": "", "fonte": "", "periodo": "", "recomendacao": "" },
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis, a tendência e a ADERÊNCIA da média dos anúncios ao FipeZAP (se divergirem >15%, explique por quê)."
}`;
}

// BASE DE CÁLCULO por tipo de imóvel (direciona a avaliação — ver docs/AVALIACAO_POR_TIPO.md).
// Só as bases por m² PRIVATIVO ('residencial'/'comercial') sofrem a guarda de coerência
// área-total×privativa; terreno/rural/indústria/unidade têm métrica própria (m² de terreno,
// hectare, unidade) e usam o valorEstimadoImovel type-correct da IA.
function baseAvaliacaoPorTipo(tipo) {
  const t = String(tipo || '').toLowerCase();
  if (/vaga|garagem|\bbox\b/.test(t)) return 'unidade';
  if (/fazenda|s[íi]tio|ch[aá]cara|rural|agro|gleba/.test(t)) return 'rural';        // R$/hectare
  if (/terreno|lote|\b[aá]rea\b/.test(t)) return 'terreno';                          // R$/m² de terreno
  if (/gal[pn]|ind[uú]stri|log[íi]stic|barrac[aã]o|armaz[eé]m/.test(t)) return 'industrial'; // m² construído galpão
  if (/sala|loja|comercial|conjunto|escrit[óo]rio|laje/.test(t)) return 'comercial'; // m² privativo comercial
  return 'residencial'; // apto/casa: m² privativo/construído
}

// Bloco de débitos/encargos JÁ INFORMADOS que serão assumidos (entram como CUSTO
// na viabilidade). Se constam na documentação do lote → o parecer cita; se não
// constam → cita mesmo assim e aponta ONDE buscar/confirmar (referências).
function blocoDebitos(inp, docs, brlFn) {
  const itens = [];
  if (Number(inp.debitosAssumidos) > 0) itens.push(`Débitos assumidos (gerais): R$ ${brlFn(inp.debitosAssumidos)}`);
  if (Number(inp.iptuMensal) > 0) itens.push(`IPTU: R$ ${brlFn(inp.iptuMensal)}/mês`);
  if (Number(inp.condominioMensal) > 0) itens.push(`Condomínio: R$ ${brlFn(inp.condominioMensal)}/mês`);
  if (Number(inp.laudemio) > 0) itens.push(`Laudêmio: R$ ${brlFn(inp.laudemio)}`);
  if (Number(inp.foreiro) > 0) itens.push(`Foreiro/foro: R$ ${brlFn(inp.foreiro)}`);
  if (!itens.length) return '';
  const temDocs = !!(docs && (docs.edital || docs.matricula || (Array.isArray(docs.anexos) && docs.anexos.length)));
  return `
DÉBITOS/ENCARGOS A ASSUMIR (informados — JÁ ENTRAM como custo na viabilidade acima):
${itens.map(i => '- ' + i).join('\n')}
${temDocs
  ? 'A documentação do lote está disponível (edital/matrícula/anexos). Na seção de débitos, CONFIRME se cada débito acima consta na documentação; para os que constarem, cite a fonte; para os que NÃO estiverem discriminados, sinalize e indique onde obter (referências abaixo).'
  : 'A documentação detalhada do lote NÃO foi anexada. Na seção de débitos, liste-os e — como não há documento discriminando-os — oriente claramente ONDE buscar/confirmar cada um (referências abaixo).'}
REFERÊNCIAS para confirmar/obter os valores quando não constarem na documentação:
- IPTU e taxas municipais: certidão de débitos imobiliários na Prefeitura (Secretaria da Fazenda), pelo número de inscrição/IPTU.
- Condomínio: declaração de débitos condominiais com a administradora ou o síndico.
- Ônus, hipotecas e débitos propter rem: matrícula atualizada no Cartório de Registro de Imóveis competente.
- Responsabilidade por débitos após a arrematação (quem paga o quê): cláusulas do EDITAL do leilão.
- Laudêmio/foro (terreno de marinha): SPU — Secretaria de Patrimônio da União, ou o ente foreiro.`;
}

// Foco do parecer por PERFIL-BASE do investidor (triagem no cadastro). Direciona o
// que o agente prioriza — o mesmo imóvel se defende diferente para cada perfil.
const PERFIL_FOCO = {
  revenda: 'PERFIL DO COMPRADOR: REVENDA (flip). Priorize margem, velocidade de saída e liquidez de revenda; enfatize o teto de lance que preserva o lucro na revenda.',
  locacao: 'PERFIL DO COMPRADOR: LOCAÇÃO (renda). Priorize o yield (aluguel/preço), a renda mensal líquida e o payback pela locação; o cenário de revenda é secundário.',
  uso_proprio: 'PERFIL DO COMPRADOR: USO PRÓPRIO. Priorize a economia frente ao mercado e a adequação ao uso; o piso de 30% de lucro não se aplica.',
  incorporacao: 'PERFIL DO COMPRADOR: INCORPORAÇÃO. Priorize o POTENCIAL CONSTRUTIVO (terreno, aproveitamento e zoneamento) e a viabilidade de incorporar; avalie o valor pelo potencial, não só pelo imóvel atual.',
};

function promptParecer(inp, m, mercado, docs) {
  const usoProprio = inp.objetivoCompra === 'uso_proprio';
  const debitos = blocoDebitos(inp, docs, brl);
  const focoPerfil = PERFIL_FOCO[inp._perfil] || '';
  return `
Redija um PARECER EXECUTIVO MERCADOLÓGICO E DE VIABILIDADE FINANCEIRA como Gestor Sênior da BidPro Brasil.
${focoPerfil ? `\n${focoPerfil}\n` : ''}

ESCOPO ESTRITO: foque EXCLUSIVAMENTE em mercado × valor de aquisição e viabilidade
financeira. NÃO faça análise JURÍDICA (consulta de processo/CNJ, validade de penhora,
gravames, riscos de nulidade, diligências) — isso é dos relatórios DOCUMENTAL e
JURÍDICO. EXCEÇÃO: os DÉBITOS/ENCARGOS A ASSUMIR informados abaixo DEVEM constar,
pois são CUSTO da operação e impactam a viabilidade — apenas no aspecto financeiro
(valor e onde confirmar), sem entrar no mérito jurídico.

IMÓVEL: ${inp.tipo || inp.tipoImovel} — ${inp.endereco}, ${inp.cidade || ''}/${inp.estado || ''}
OBJETIVO: ${usoProprio ? 'USO PRÓPRIO' : 'INVESTIMENTO'}
${inp.nomeCondominio ? `CONDOMÍNIO: ${inp.nomeCondominio}` : ''}

MERCADO:${mercado?.fonteEstimativa === 'indice_bidpro' ? '\n- ATENÇÃO: não há anúncios comparáveis ativos na região agora; a estimativa de mercado abaixo vem do ÍNDICE BIDPRO (base própria). O parecer DEVE informar isso ao cliente com transparência (referência de mercado por falta de comparativos ativos na localidade), SEM inventar comparáveis nem citar anúncios específicos.' : ''}
- Preço médio/m² (${mercado?.fonteEstimativa === 'indice_bidpro' ? 'Índice BidPro, base própria' : 'média dos anúncios'}): R$ ${brl(mercado?.precoMedioM2)}
- Aluguel médio: R$ ${brl(mercado?.aluguelMedio)} · Yield: ${(mercado?.yieldBruto || 0).toFixed(2)}% bruto / ${(mercado?.yieldLiquido || 0).toFixed(2)}% líquido
${mercado?.referenciaFipeZap?.encontrado ? `- Referência FipeZAP (${mercado.referenciaFipeZap.localidade || inp.cidade || ''}, ${mercado.referenciaFipeZap.mesReferencia || 'recente'}): R$ ${brl(mercado.referenciaFipeZap.precoMedioM2)}/m² · valorização 12m: ${(Number(mercado.referenciaFipeZap.valorizacao12m) || 0).toFixed(1)}%. Compare com a média dos anúncios acima: se divergirem muito, comente e use a mais conservadora na defesa.` : ''}
${mercado?.indiceBidPro && (Number(mercado.indiceBidPro.venda_m2) > 0 || Number(mercado.indiceBidPro.aluguel_m2) > 0) ? `- Índice BidPro (nossa base própria por microrregião, nível ${mercado.indiceBidPro.nivel})${Number(mercado.indiceBidPro.venda_m2) > 0 ? `: venda R$ ${brl(mercado.indiceBidPro.venda_m2)}/m²` : ''}${Number(mercado.indiceBidPro.aluguel_m2) > 0 ? ` · locação R$ ${brl(mercado.indiceBidPro.aluguel_m2)}/m²/mês` : ''}. Referência interna independente (venda e locação), consolidada das análises da plataforma — use como sanity-check adicional junto ao FipeZAP.` : ''}
${mercado?.valorizacao?.serie?.length >= 2 ? `- Valorização BidPro (${inp.cidade || ''}, venda R$/m² por ano, base própria): ${mercado.valorizacao.serie.map(p => `${p.ano}: R$ ${brl(p.m2)}`).join(' · ')}. Variação no período: ${Number(mercado.valorizacao.valorizacao_periodo_pct).toFixed(1)}% (${Number(mercado.valorizacao.valorizacao_aa_pct).toFixed(1)}% a.a.). Use como leitura de TENDÊNCIA da microrregião (amostras podem ser poucas nos anos iniciais).` : ''}
${(() => {
  const c = mercado?.classificacaoIntencao;
  if (!c || !c.algum) return '';
  const bons = [];
  if (c.revenda) bons.push(`REVENDA — ${c.motivos.revenda}`);
  if (c.locacao) bons.push(`LOCAÇÃO — ${c.motivos.locacao}`);
  if (c.temporada) bons.push(`TEMPORADA — ${c.motivos.temporada}`);
  return `ADEQUAÇÃO POR OBJETIVO (CLASSIFIQUE e DEFENDA no parecer para quais objetivos este imóvel é bom — pode ser um, dois ou os três): ${bons.join(' | ')}. Na seção de posicionamento/defesa, diga EXPLICITAMENTE se o imóvel é bom para REVENDA, LOCAÇÃO e/ou TEMPORADA, usando esses argumentos.${c.temporada ? ' Para TEMPORADA, sustente a ATRATIVIDADE TURÍSTICA da cidade (demanda de alta temporada, ocupação, perfil do público) como diferencial de renda frente à locação tradicional.' : ''}`;
})()}
${mercado?.comentario ? `- Leitura de mercado: ${mercado.comentario}` : ''}

AQUISIÇÃO E RETORNO:
- Lance SEM disputa (lance base): R$ ${brl(inp.valorArrematacao)}
- Lance MÁXIMO COM disputa (preserva o piso de lucro): R$ ${brl(inp._teto)}
- Capital total aportado: R$ ${brl(m.capitalMobilizado)}
- Lucro/Economia estimada: R$ ${brl(m.lucro)}
- Retorno (ROI/ROE): ${(m.roi || 0).toFixed(2)}%
OBSERVAÇÕES: ${inp.observacoes || 'Sem observações adicionais'}
${debitos}

REGRA DE VIABILIDADE:
${usoProprio
  ? '- Como é USO PRÓPRIO, o piso de 30% de lucro NÃO se aplica. O foco é a ECONOMIA frente ao valor de mercado (quanto o comprador economiza ao adquirir no leilão em vez de no mercado). Defenda a aquisição pela economia e adequação ao uso.'
  : '- A operação só é VIÁVEL com no mínimo 30% de lucro líquido. Avalie SEM DISPUTA (lance base) e COM DISPUTA (até o lance máximo que ainda preserva 30%).'}

Escreva em português formal, texto simples (sem markdown/asteriscos e SEM travessão "—"; use vírgula, ponto ou dois-pontos, pois o travessão dá cara de texto gerado por IA e reduz a confiança do cliente). Estruture com "§ SEÇÃO:":
§ SEÇÃO: POSICIONAMENTO ESTRATÉGICO (mercado × valor de aquisição; desconto real frente ao mercado)
${mercado?.classificacaoIntencao?.algum ? '§ SEÇÃO: ADEQUAÇÃO POR OBJETIVO (diga para QUAIS objetivos o imóvel é bom, entre Revenda, Locação e Temporada, podendo ser mais de um, com o porquê de cada; sendo cidade turística, DEFENDA a temporada como diferencial de renda)' : ''}
§ SEÇÃO: CENÁRIOS DE LANCE (sem disputa e com disputa; até onde dá para subir o lance mantendo ${usoProprio ? 'a economia' : 'o piso de 30%'})
§ SEÇÃO: PROJEÇÃO DE RENTABILIDADE (projeção de 12 MESES considerando o pagamento em parcelas até a revenda; deixe claro que VENDER ANTES dos 12 meses AUMENTA o lucro; cite ROI/ROE, yield de locação como alternativa e payback)${debitos ? '\n§ SEÇÃO: DÉBITOS E ENCARGOS ASSUMIDOS (liste os débitos informados que entram como custo; diga se constam na documentação do lote; para os que não constarem, aponte as referências de onde obter/confirmar)' : ''}
§ SEÇÃO: DEFESA DA OPERAÇÃO (argumentos objetivos de por que ${usoProprio ? 'a compra para uso compensa' : 'o investimento compensa'})
§ SEÇÃO: CONCLUSÃO E RECOMENDAÇÃO

IMPORTANTE — SE NÃO HOUVER VIABILIDADE${usoProprio ? ' (economia irrelevante frente ao mercado)' : ' (lucro abaixo de 30%)'}:
seja DIRETO e CURTO. Explique objetivamente O PORQUÊ (ex.: preço de aquisição próximo do
mercado, custos elevados, margem insuficiente) e recomende NÃO avançar. Não alongue o relatório.`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return; }
  // REGERAÇÃO AUTOMÁTICA (regenerar-relatorios-cron): reprocessa relatório com vício,
  // com orçamento fresco. Autentica pelo CRON_SECRET (não passa por getUser nem cota).
  const isCron = !!process.env.CRON_SECRET && req.headers['x-cron-secret'] === process.env.CRON_SECRET;
  let user;
  if (isCron) {
    if (!req.body?.paraUserId) { res.status(400).json({ error: 'paraUserId obrigatório no cron' }); return; }
    user = { id: String(req.body.paraUserId) };
  } else {
    user = await getUser(req);
    if (!user) { res.status(401).json({ error: 'Não autenticado' }); return; }
  }
  if (!CLAUDE_KEY) { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const body = req.body || {};
  const { imovelId, titulo, cidade, estado, imovel, mercadoInputs, parecerInputs } = body;
  if (!imovelId || !mercadoInputs) { res.status(400).json({ error: 'imovelId e mercadoInputs obrigatórios' }); return; }

  // Geração EM NOME DE (admin/analista ao atribuir um arremate manual): grava sob o
  // CLIENTE (para o relatório pertencer a ele) e não cobra cota — atribuição
  // administrativa gratuita. Só admin/analista pode; senão ignora e usa o próprio.
  let ownerId = user.id, onBehalf = false;
  if (body.paraUserId && body.paraUserId !== user.id) {
    try {
      const [p] = await (await sb(`perfis?id=eq.${user.id}&select=role&limit=1`)).json();
      if (p && (p.role === 'admin' || p.role === 'analista')) { ownerId = String(body.paraUserId); onBehalf = true; }
    } catch { /* mantém o próprio */ }
  }

  // Data do leilão (para a regra de limpeza: 15 dias após o leilão sem arrematar).
  const rawData = imovel?.dataLeilao || parecerInputs?.d?.dataLeilao || null;
  const dataLeilao = rawData && !isNaN(Date.parse(rawData)) ? new Date(rawData).toISOString() : null;
  const base = { user_id: ownerId, imovel_id: String(imovelId), titulo: titulo || null, cidade: cidade || null, estado: estado || null, imovel: imovel || null, inputs: { mercadoInputs, parecerInputs }, data_leilao: dataLeilao };

  // ── Cota NO SERVIDOR (anti-abuso do custo de IA) ────────────────────────────
  // A cota é consumida aqui (onde o custo ocorre), não mais só no cliente — que
  // podia ser burlado chamando esta API direto. Cobra apenas em análise NOVA
  // deste imóvel para este usuário; re-gerar/atualizar o mesmo imóvel não recobra
  // (espelha o "isNovo" do cliente). Falha na checagem não trava quem tem direito.
  let cota = null;
  let cobrarCredito = false; // cota mensal esgotada → esta geração será cobrada do crédito
  try {
    const jaConcluida = await (await sb(`analises_mercado?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=imovel_id&limit=1`)).json();
    const isNovo = !(Array.isArray(jaConcluida) && jaConcluida.length);
    if (isNovo && !onBehalf && !isCron) {
      const rc = await sb('rpc/consumir_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id }) });
      cota = await rc.json().catch(() => null);
      if (cota && cota.ok === false) {
        // Cota mensal do plano acabou → tenta CRÉDITO. Pré-autoriza com uma estimativa
        // conservadora do mercadológico (debitar_credito nunca deixa o saldo negativo).
        const EST_MERCADO_MICRO = 1200000; // ~US$1,20 (busca web + tokens)
        const pode = await sb('rpc/pode_debitar', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_custo_micro_estimado: EST_MERCADO_MICRO }) });
        const podeCredito = await pode.json().catch(() => false);
        if (podeCredito === true) {
          cobrarCredito = true;
        } else {
          res.status(402).json({ error: 'Sua cota mensal de relatórios mercadológicos acabou. Recarregue créditos para gerar relatórios adicionais.', motivo: 'sem_credito', cota });
          return;
        }
      }
    }
  } catch { /* checagem de cota nunca bloqueia quem tem direito */ }
  _custoMicroReq = 0; // zera o acumulador de custo desta geração (cobrança por crédito)

  // ORÇAMENTO DE TEMPO GLOBAL (< maxDuration 300s). Toda etapa cara (edital, busca de mercado,
  // parecer) é limitada ao tempo RESTANTE — nunca inicia uma chamada que não caberia antes do
  // corte da Vercel. Foi o que resolveu o timeout: antes, o anthropicFetch com retries:1 podia
  // rodar 2×200s por chamada (+ um retry por "sem amostras") e estourar o deadline de 270s;
  // agora cada busca é 1 tentativa (retries:0) com timeout = tempo restante e o retry só ocorre
  // se couber. O deadline vira BACKSTOP (não mais a 1ª linha de defesa).
  const T0 = Date.now();
  const HARD_MS = 285000; // < maxDuration 300s, deixa ~15s p/ gravar 'erro'/'concluida' e responder
  const restante = () => HARD_MS - (Date.now() - T0);

  // Confirmação sob demanda dos VALORES (avaliação + lance mínimo) consultando EDITAL/MATRÍCULA/
  // ANEXOS (não só a página do lote) — corrige avaliação zerada e valor sentinela; o que não
  // confirmar vira anomalia. Limitada a uma fração do orçamento p/ não roubar tempo do mercado.
  try { await garantirValores(String(imovelId), Date.now() + Math.min(30000, Math.max(0, restante() - 235000))); } catch { /* nunca bloqueia o relatório */ }

  // Triangula o imóvel-alvo (endereço+CEP+IBGE, grátis) se a coord for imprecisa — âncora do raio
  // de 250m/1km. Grava a coord melhor (durável). Time-boxed; roda ANTES da busca para o recorte por
  // raio já usar a âncora certa. Só re-geocodifica os ~27% imprecisos (os precisos passam direto).
  try {
    const anc = await ancorarImovel(String(imovelId), Date.now() + Math.min(12000, Math.max(0, restante() - 225000)));
    if (anc?.alterado) console.log('[ancora]', JSON.stringify({ imovel: String(imovelId), nivel: anc.nivel }));
  } catch { /* nunca bloqueia o relatório */ }

  await upsertAnalise({ ...base, status: 'gerando', erro: null, result: null });

  const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo_limite')), Math.max(20000, restante())));

  try {
    const { result, valorMercado, avalDb, vminImovel } = await Promise.race([prazo, (async () => {
    // 1) Mercado — reaproveita pesquisa recente do mesmo imóvel (se houver), senão busca.
    // INVALIDAÇÃO type-aware: uma pesquisa antiga (anterior à avaliação por tipo) NÃO traz
    // consolidado.valorEstimadoImovel/baseCalculo. Para bases por m² construído/privativo
    // (residencial/comercial/industrial) isso é ok — o cálculo cai no precoM2×área. Mas para
    // TERRENO/RURAL/UNIDADE não há esse fallback (a régua é m² de terreno/hectare/unidade),
    // então reaproveitar o cache antigo deixaria o valor VAZIO. Nesses tipos, se o cache não
    // for type-aware, IGNORAMOS e refazemos a busca (recalcula com o método do tipo).
    let mercado, reaproveitado = false;
    const recente = await mercadoRecente(String(imovelId));
    const baseReuso = baseAvaliacaoPorTipo(mercadoInputs.tipoImovel || imovel?.tipo);
    const cacheTypeAware = (c) => !!(c?.consolidado?.baseCalculo) || Number(c?.consolidado?.valorEstimadoImovel) > 0;
    const reusoValido = recente && (cacheTypeAware(recente.mercado) || ['residencial', 'comercial', 'industrial'].includes(baseReuso));
    if (reusoValido) {
      mercado = { ...recente.mercado, reaproveitado: true, pesquisaEm: recente.em };
      reaproveitado = true;
    } else {
      // REAPROVEITAMENTO POR REGIÃO — LIGADO POR PADRÃO (regra do dono: "todo dado deve ser
      // aproveitado, evita desperdício"; desliga só com MERCADO_CACHE=0). Se a microrregião já tem
      // amostra densa e do QUADRIMESTRE ATUAL de VENDA na base própria (indice_amostra, sem leilão),
      // injetamos esses comparáveis REAIS no prompt e reduzimos a busca web de 5 → 2 usos — a IA
      // ancora na base e só complementa lacunas (padrão/anúncio ativo). Se o dado mais recente for de
      // quadrimestre distante, amostrasRegiaoCache devolve miss → busca COMPLETA (5) = refaz/atualiza.
      // Vale igual para dono e cliente (mesmo código). Rural fica fora (régua de ha).
      const segCache = segmentoIndice(mercadoInputs.tipoImovel || imovel?.tipo);
      let cacheReg = null;
      const cacheLigado = process.env.MERCADO_CACHE !== '0';
      if (cacheLigado && segCache !== 'rural') {
        try {
          const [imReg] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=cidade_norm,estado,bairro,latitude,longitude&limit=1`)).json();
          cacheReg = await amostrasRegiaoCache(imReg, segCache);
        } catch { cacheReg = null; }
      }
      // QUALIDADE em 1º lugar (decisão do dono: "a busca deve ser apurada; pode demorar mais, mas
      // tem que entregar com qualidade"). 7 buscas cobrem grandes portais + imobiliárias LOCAIS +
      // colheita ampla. O que causava o "sem amostras" NÃO era o número de buscas e sim a resposta
      // ser cortada/pausada — resolvido no pause_turn + max_tokens 32k + salvamento de JSON. Com
      // cache denso da praça, 2 bastam (barato e igualmente apurado, pois ancora na base própria).
      const maxWeb = cacheReg?.hit ? 2 : 7;
      const cacheTxt = cacheReg?.hit ? cacheReg.text : '';
      // FONTES LOCAIS já conhecidas da praça (revalidação ORGÂNICA): injeta as imobiliárias locais
      // vistas recentemente para a IA ir direto COLHER (economiza a busca de descoberta). Best-effort.
      let fontesTxt = '';
      try {
        const fl = await (await sb('rpc/fontes_locais_frescas', { method: 'POST', body: JSON.stringify({ p_cidade_norm: _norm(cidade), p_uf: String(estado || '').toUpperCase() }) })).json();
        if (Array.isArray(fl) && fl.length) fontesTxt = `\n\nIMOBILIÁRIAS LOCAIS JÁ CONHECIDAS de ${cidade}/${estado} (comece por elas: abra os sites e colha anúncios do tipo-alvo; ADICIONE as novas que encontrar em "fontesLocais"):\n` + fl.map(f => `- ${f.nome || f.url} (${f.url})`).join('\n');
      } catch { /* best-effort */ }
      console.log('[mercado-cache]', JSON.stringify({ on: cacheLigado, hit: !!cacheReg?.hit, nivel: cacheReg?.nivel || null, n: cacheReg?.n || 0, maxWeb, imovel: String(imovelId) }));
      // A busca de mercado (web search, até 5 buscas) é a etapa lenta. UMA tentativa por
      // chamada (retries:0) com timeout = tempo RESTANTE reservando o parecer — assim duas
      // buscas NUNCA somam mais que o orçamento. Se a chamada abortar/falhar, devolve
      // { __falhou:true } (o chamador decide re-tentar ou marcar transitório p/ self-heal).
      const RESERVA_PARECER = 55000; // guarda p/ o parecer + a escrita final
      const buscarMercado = async (msBudget, webUses = maxWeb) => {
        try {
          // CAUSA-RAIZ do "sem amostras" em cidade grande (BH 28/07): com web_search, os BLOCOS de
          // RESULTADO da busca contam no output e, em cidade grande, consumiam o max_tokens ANTES de
          // o modelo escrever o JSON → resposta SEM bloco de texto → parse vazio. Dois consertos:
          //  (1) max_tokens 16000→32000 (folga p/ os resultados da busca + o JSON final);
          //  (2) tratar stop_reason='pause_turn' (a busca server-side PAUSA em pesquisas longas e
          //      espera o turno ser devolvido p/ CONTINUAR — sem isso o modelo nunca emite o JSON).
          const messages = [{ role: 'user', content: promptMercado(mercadoInputs) + cacheTxt + fontesTxt }];
          let mData, stop, cont = 0;
          do {
            mData = await anthropic({
              model: MODEL, max_tokens: 32000,
              tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: webUses }],
              system: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${mercadoInputs.tipoImovel}). Retorne apenas JSON válido.`,
              messages,
            }, true, { retries: 0, timeoutMs: Math.max(45000, msBudget), noFallback: true });
            stop = mData?.stop_reason;
            if (stop === 'pause_turn' && Array.isArray(mData.content)) {
              messages.push({ role: 'assistant', content: mData.content }); // devolve o turno pausado p/ continuar
              cont++;
            }
          } while (stop === 'pause_turn' && cont < 8 && restante() > RESERVA_PARECER + 12000);
          const txt = extractText(mData);
          const m = parseJSON(txt) || {};
          m.precoMedioM2 = m.consolidado?.precoMedioM2 || m.nivel2?.precoMedioM2 || 0;
          m.aluguelMedio = m.consolidado?.aluguelMedio || 0;
          m.yieldBruto = m.consolidado?.yieldBruto || 0;
          m.yieldLiquido = m.consolidado?.yieldLiquido || 0;
          m.vendas = m.nivel2?.vendas || [];
          m.locacoes = m.nivel2?.locacoes || [];
          m.pesquisaEm = new Date().toISOString();
          // Diagnóstico PERSISTIDO (fica no result mesmo quando vazio) p/ validar o fluxo pelo banco.
          m.__diag = { stop: stop || null, blocos: Array.isArray(mData?.content) ? mData.content.length : 0, textoLen: txt.length, out_tokens: mData?.usage?.output_tokens || 0, buscas: webUses, continuou: cont };
          return m;
        } catch (e) { return { __falhou: true, __erroApi: String(e?.message || e || '').slice(0, 120) }; } // abort/timeout/erro → o chamador trata
      };
      const semAmostras = (m) => ((m.vendas?.length || 0) + (m.locacoes?.length || 0)) === 0 && !(m.precoMedioM2 > 0);
      // 1ª busca: guarda a reserva do parecer E ~80s p/ uma 2ª tentativa (uma busca que TRAVA
      // aborta antes e a re-tentativa costuma concluir — 2 ataques mais curtos > 1 longo).
      mercado = await buscarMercado(Math.min(135000, restante() - RESERVA_PARECER - 80000));
      // Re-tenta se (vazio OU falhou) E ainda há orçamento. A 2ª tentativa é ESTREITA (menos
      // buscas web = mais rápida). Regra por CAUSA (incidente BH/RJ 28/07 — cidade grande SEM base
      // própria: a busca ampla travava, a 2ª de 3 buscas TAMBÉM travava → tela de erro):
      //  • 1ª TRAVOU (__falhou) → 2ª vai RÁPIDA (1 busca web). Uma única busca quase sempre CONCLUI
      //    e devolve um R$/m² de referência: entrega uma estimativa APURADA preliminar (e SEMEIA o
      //    Índice p/ as próximas) em vez de "tente novamente". A busca AMPLA já foi a 1ª tentativa.
      //  • 1ª veio VAZIA mas concluiu (praça fina) → 2ª média (≤3 buscas) tenta achar amostra.
      if ((semAmostras(mercado) || mercado.__falhou) && restante() > RESERVA_PARECER + 40000) {
        const usos = mercado.__falhou ? 1 : Math.min(maxWeb, 3);
        mercado = await buscarMercado(Math.min(110000, restante() - RESERVA_PARECER), usos);
      }
      // A busca FALHOU (abort/timeout/erro), não é "mercado vazio de verdade": trata como
      // TRANSITÓRIO → grava 'erro' com tempo_limite e o self-heal (cron) re-tenta com orçamento
      // fresco. Um mercado genuinamente vazio (JSON válido sem amostras) SEGUE e vira relatório.
      // NÃO derruba aqui: mesmo instável (__falhou) OU vazia, ainda podemos entregar o relatório
      // pelo ÍNDICE BIDPRO (base própria) mais abaixo. A decisão de transitório só vem se o
      // Índice NÃO cobrir (aí o self-heal re-tenta comparáveis reais).
      if (mercado.__falhou) mercado = { vendas: [], locacoes: [], precoMedioM2: 0, pesquisaEm: new Date().toISOString(), __instavel: true, __erroApi: mercado.__erroApi || '' };
    }
    const buscaInstavel = !!mercado.__instavel;
    const erroApiBusca = mercado.__erroApi || '';

    const precoM2 = Number(mercado.precoMedioM2) || 0;
    // A base do valor de mercado é a ÁREA PRIVATIVA (útil). Fonte de verdade da metragem é a
    // MATRÍCULA/EDITAL: quando o documental já leu e extraiu a privativa (ficha_juridica.
    // areaPrivativaM2), ela PREVALECE sobre a área do site (que às vezes é a total/terreno) e
    // sobre a área do cliente. Sem documental ainda, usa a área informada e a coerência abaixo
    // protege o número. Também lemos avaliação/fonte para a checagem de coerência.
    let areaM2 = Number(mercadoInputs.areaM2) || 0;
    let avalDb = 0, fonteDb = '', areaFonte = 'informada';
    let imDb = null; // reusado depois para semear/ler o Índice BidPro da microrregião
    try {
      [imDb] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=fonte,valor_avaliacao,valor_minimo,area_m2,ficha_juridica,cidade_norm,estado,bairro,latitude,longitude&limit=1`)).json();
      const n = Number(imDb?.valor_avaliacao) || 0;
      const vminDb = Number(imDb?.valor_minimo) || 0;
      const sentinela = [999999999, 99999999, 9999999999, 111111111, 123456789].includes(n);
      // TRAVA DE CREDIBILIDADE: avaliação que implica desconto >= 88% (aval > 8,3x o mínimo) é
      // quase sempre mis-read do edital ou valor "grudado" de outro lote pelo scraper. NÃO pode
      // virar um "95% OFF" falso no relatório do cliente → trata como ausente (mostra "a
      // confirmar" em vez de mentir). O card/busca é protegido pela limpeza de dados + monitor.
      const implausivel = n > 0 && vminDb > 0 && (1 - vminDb / n) >= 0.88;
      avalDb = (sentinela || implausivel) ? 0 : n;
      if (implausivel) { try { await registrarAnomalia('avaliacao_implausivel', imDb?.fonte || '', imovelId, 'valor_avaliacao',
        `Avaliação R$${Math.round(n)} vs mínimo R$${Math.round(vminDb)} = desconto ~${Math.round((1 - vminDb / n) * 100)}% — implausível/grudada; ignorada no relatório.`); } catch { /* log best-effort */ } }
      fonteDb = imDb?.fonte || '';
      const aDoc = Number(imDb?.ficha_juridica?.areaPrivativaM2) || 0;
      if (aDoc >= 5 && aDoc <= 100000) { areaM2 = aDoc; areaFonte = 'matricula'; } // autoritativa
    } catch { /* segue com a área informada */ }
    // VALOR type-correct: o avaliador (IA) calcula valorEstimadoImovel pelo MÉTODO DO TIPO
    // (m² privativo/construído, m² de terreno, hectare, terreno excedente à parte) — preferimos
    // esse número. Só caímos no m²×área quando a IA não o forneceu E a base é por m² construído/
    // privativo (residencial/comercial/industrial); terreno/rural sem estimativa ficam sem valor
    // (o front pede o dado) em vez de multiplicar a régua errada.
    const baseTipo = baseAvaliacaoPorTipo(mercadoInputs.tipoImovel || imovel?.tipo);
    const vEstIA = Number(mercado?.consolidado?.valorEstimadoImovel) || 0;
    let valorMercado = null;
    if (vEstIA > 0) valorMercado = Math.round(vEstIA);
    else if (precoM2 && areaM2 && ['residencial', 'comercial', 'industrial'].includes(baseTipo)) valorMercado = Math.round(precoM2 * areaM2 * 0.9);
    // COERÊNCIA (só bases por m² privativo/construído) — se o R$/m² dos comparáveis divergir
    // MUITO do R$/m² implícito na AVALIAÇÃO (área provável TOTAL/terreno, não privativa: 121 m²
    // × R$10.980 = R$1,3M vs avaliação R$329k gerava desconto/ROI irreais), ancoramos o mercado
    // na AVALIAÇÃO (conservador), sinalizamos o alerta p/ o front pedir a privativa e registramos
    // anomalia. Não se aplica quando a área veio da matrícula nem a terreno/rural/unidade.
    let areaAlerta = null;
    try {
      if (valorMercado && avalDb > 0 && areaM2 > 0 && precoM2 > 0 && areaFonte !== 'matricula' && (baseTipo === 'residencial' || baseTipo === 'comercial')) {
        const avalM2 = avalDb / areaM2;
        if (precoM2 > 3 * avalM2) {
          const areaPriv = Math.round(avalDb / precoM2);
          areaAlerta = { areaUsada: areaM2, compM2: Math.round(precoM2), avalM2: Math.round(avalM2), areaPrivativaImplicita: areaPriv, motivo: 'area_provavel_total_nao_privativa' };
          valorMercado = Math.round(avalDb); // âncora conservadora (avaliação), não o comps×área inflado
          await registrarAnomalia('mercado_area_incoerente', fonteDb, imovelId, 'area_m2',
            `Comparáveis R$${Math.round(precoM2)}/m² vs avaliação R$${Math.round(avalM2)}/m² (${(precoM2 / avalM2).toFixed(1)}x) — área ${areaM2} m² provável TOTAL, não privativa (~${areaPriv} m²). Mercado ancorado na avaliação.`);
        }
      }
    } catch { /* coerência é best-effort: nunca bloqueia o relatório */ }
    mercado.areaAlerta = areaAlerta; // null quando coerente (limpa alerta antigo em reaproveitamento)
    let valorLocacao = mercado.aluguelMedio ? Math.round(mercado.aluguelMedio) : null;

    // ÍNDICE BIDPRO (loop com os relatórios — fecha o ciclo de cidade_indicadores):
    // (1) SEMEIA a microrregião com venda R$/m² e aluguel R$/m² REAIS deste relatório;
    // (2) LÊ o índice consolidado (bairro > grid > cidade) para CONSTAR no relatório
    //     (venda e locação). Só residencial: o índice é por m² privativo — terreno/rural
    //     têm régua própria (m² de terreno/hectare) e contaminariam a base residencial.
    // ÍNDICE POR SEGMENTO: apto/casa (m² privativo), terreno (m² de terreno), comercial (régua
    // própria). Cada segmento tem sua base — NÃO se misturam. Rural é R$/ha (fora do índice/m²).
    // O terreno usa a ÁREA DE TERRENO (não a construída) para o R$/m².
    // FALLBACK DE REGIÃO (não desperdiçar a busca): se o lote não está mais no imoveis_leilao
    // (removido pela limpeza) OU veio de atribuição manual, imDb fica sem cidade_norm e a colheita
    // no índice seria PULADA — a pesquisa cara viraria lixo. Reconstrói a região (nível cidade) a
    // partir do que o próprio relatório carrega (cidade/estado do corpo, bairro/coords do snapshot).
    if (!imDb?.cidade_norm && (cidade || imovel?.cidade)) {
      imDb = { ...(imDb || {}), cidade_norm: _cidadeNorm(cidade || imovel?.cidade),
        estado: estado || imovel?.estado || imDb?.estado || '',
        bairro: imDb?.bairro || imovel?.bairro || null,
        latitude: imDb?.latitude ?? imovel?.lat ?? null, longitude: imDb?.longitude ?? imovel?.lng ?? null };
    }
    mercado.indiceBidPro = null;
    const segIdx = segmentoIndice(mercadoInputs.tipoImovel || imovel?.tipo);
    const areaTerreno = Number(mercadoInputs.areaTerrenoM2) || 0;
    const areaSeg = segIdx === 'terreno' ? (areaTerreno || areaM2) : areaM2;
    if (segIdx !== 'rural') {
      const nAmostras = (Number(mercado.nivel1?.totalAmostras) || 0) + (Number(mercado.nivel2?.totalAmostras) || 0)
        || ((mercado.vendas?.length || 0) + (mercado.locacoes?.length || 0));
      const aluguelM2 = (Number(mercado.aluguelMedio) > 0 && areaSeg > 0) ? Number(mercado.aluguelMedio) / areaSeg : null;
      await semearIndiceBidPro(imDb, precoM2, aluguelM2, nAmostras, segIdx);
      mercado.indiceBidPro = await lerIndiceBidPro(imDb, segIdx);
      // Amostras datadas (valorização/recência) + curva de valorização por ano no relatório.
      await gravarAmostrasIndice(imDb, mercado, imovelId, segIdx);
      // FONTES LOCAIS vistas neste relatório → registro da praça (revalidação orgânica: ult_visto=now,
      // vezes+1). Empresas que somem param de aparecer e envelhecem sozinhas; novas entram aqui.
      try { if (Array.isArray(mercado.fontesLocais) && mercado.fontesLocais.length) await sb('rpc/registrar_fontes_locais', { method: 'POST', body: JSON.stringify({ p_cidade_norm: _norm(cidade), p_uf: String(estado || '').toUpperCase(), p_fontes: mercado.fontesLocais }) }); } catch { /* best-effort */ }
      mercado.valorizacao = await lerValorizacao(imDb, segIdx);
      // COMPOSIÇÃO TEMPORAL da base própria (pedido do dono): períodos de 4 meses, quantitativo
      // e valor recente/projetado a hoje. Lê DEPOIS de gravar as amostras deste relatório (entram
      // na composição). Serve p/ confrontar a avaliação com o valor de mercado por período e p/
      // avisar quem gerou o relatório quando não há anúncio recente na região.
      mercado.indiceComposicao = await lerComposicaoRegiao(imDb, segIdx);
      mercado.avisoFrescor = avisoFrescor(mercado.indiceComposicao);
    }

    // COLHEITA de outras tipologias (aproveitamento da busca): semeia o Índice dos OUTROS
    // segmentos da região com o que a IA já viu (nível cidade, sem leilão). Só em busca FRESCA
    // (o reaproveitado não traz esse bloco). Independe do segmento-alvo (mesmo p/ alvo rural,
    // semeia apto/casa/terreno/comercial da cidade). Best-effort, nunca bloqueia o relatório.
    if (!reaproveitado && mercado.outrasTipologias) {
      try { await gravarOutrasTipologias(imDb, mercado.outrasTipologias, imovelId, segmentoIndice(mercadoInputs.tipoImovel || imovel?.tipo)); } catch { /* best-effort */ }
      try { delete mercado.outrasTipologias; } catch { /* mantém enxuto o result persistido */ }
    }

    // FALLBACK ÍNDICE BIDPRO (regra do dono): sem comparativos ATIVOS de mercado na região agora
    // (busca vazia OU fonte instável), mas COM base própria do MESMO segmento → a estimativa usa o
    // Índice como referência, DEIXANDO EXPLÍCITO no relatório ("por falta de comparativo ativo,
    // usamos o Índice"). Terreno usa m² de terreno; rural fica fora (régua de hectare no relatório).
    const indiceVenda = Number(mercado.indiceBidPro?.venda_m2) || 0;
    if (!(valorMercado > 0) && !(precoM2 > 0) && indiceVenda > 0 && areaSeg > 0 && segIdx !== 'rural') {
      valorMercado = Math.round(indiceVenda * areaSeg * 0.9); // haircut conservador (asking → fechamento)
      mercado.precoMedioM2 = indiceVenda;
      const aluIdx = Number(mercado.indiceBidPro?.aluguel_m2) || 0;
      if (aluIdx > 0) { mercado.aluguelMedio = Math.round(aluIdx * areaSeg); valorLocacao = mercado.aluguelMedio; }
      mercado.fonteEstimativa = 'indice_bidpro';
      const rotSeg = { apartamento: 'apartamento', casa: 'casa', terreno: 'terreno', comercial: 'imóvel comercial' }[segIdx] || segIdx;
      mercado.comentario = `Não encontramos anúncios comparáveis ATIVOS de ${rotSeg} para ${mercadoInputs.cidade || 'esta localidade'} no momento; a estimativa usa o Índice BidPro (base própria por microrregião e segmento, R$ ${Math.round(indiceVenda).toLocaleString('pt-BR')}/m²${mercado.indiceBidPro?.nivel ? `, nível ${mercado.indiceBidPro.nivel}` : ''}) como referência. É uma referência interna consolidada das análises da plataforma, não um comparativo de anúncio ao vivo.`;
    }

    // "NÃO SE REPITA" (incidente BH 28/07): busca web INSTÁVEL (timeout/abort) E o Índice NÃO
    // cobriu (sem valor) NÃO pode virar um relatório em BRANCO salvo como 'concluida' — o cliente
    // via um relatório vazio e o self-heal de TIMEOUT nem pegava (status errado). Aqui usamos o
    // buscaInstavel (antes era variável MORTA): tratamos como falha TRANSITÓRIA → lança
    // tempo_limite → o catch salva 'erro', devolve 504 "tente novamente", estorna a cota, e o
    // self-heal re-tenta com orçamento fresco. Cliente 360 passa a registrar ERRO (não sucesso
    // vazio). Mercado GENUINAMENTE vazio (busca OK, 0 anúncios reais) NÃO cai aqui: buscaInstavel
    // é false → segue como 'concluida'/não estimado, como antes.
    if (buscaInstavel && !(Number(valorMercado) > 0) && !(Number(precoM2) > 0)) {
      const e = new Error('tempo_limite'); e.detalhe = erroApiBusca || 'busca instável'; throw e;
    }

    // CLASSIFICAÇÃO DE INTENÇÃO (revenda/locação/temporada) — consta no relatório e vira defesa no
    // parecer. Desconto pela avaliação confirmada (avalDb) × lance mínimo; yield do mercado ou índice.
    const vminImovel = Number(imDb?.valor_minimo) || 0;
    const descontoImovel = (avalDb > 0 && vminImovel > 0 && avalDb >= vminImovel) ? (1 - vminImovel / avalDb) * 100 : 0;
    const yieldParaCls = Number(mercado.yieldBruto) > 0 ? Number(mercado.yieldBruto)
      : (Number(mercado.indiceBidPro?.aluguel_m2) > 0 && Number(mercado.indiceBidPro?.venda_m2) > 0
        ? Number(mercado.indiceBidPro.aluguel_m2) * 12 / Number(mercado.indiceBidPro.venda_m2) * 100 : 0);
    mercado.classificacaoIntencao = classificarIntencao({ baseTipo, desconto: descontoImovel, yieldBruto: yieldParaCls, cidadeNorm: imDb?.cidade_norm });

    // 2) Laudo (parecer). Carrega os docs do lote para o parecer poder dizer se os
    // débitos informados já constam na documentação (ou apontar onde buscar).
    let parecer = '';
    // Só gera o parecer se ainda houver orçamento (a pesquisa de mercado é a etapa cara e já
    // rodou). Sem tempo, ENTREGA o relatório de mercado SEM o parecer — melhor que estourar o
    // deadline e perder TUDO. O parecer curto (regen) pode vir depois.
    if (parecerInputs?.d && restante() > 25000) {
      try {
        let docs = null;
        try {
          const [dRow] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=link_edital,link_matricula,link_regras_venda,anexos&limit=1`)).json();
          if (dRow) docs = { edital: dRow.link_edital, matricula: dRow.link_matricula, regras: dRow.link_regras_venda, anexos: dRow.anexos };
        } catch { /* sem docs → o parecer orienta onde buscar */ }
        // Perfil-base do investidor (triagem) — direciona o foco do parecer.
        let perfilInvestidor = null;
        try {
          const [p] = await (await sb(`perfis?id=eq.${ownerId}&select=perfil_investidor&limit=1`)).json();
          perfilInvestidor = p?.perfil_investidor || null;
        } catch { /* sem perfil → parecer padrão pelo objetivoCompra */ }
        const pInp = { ...parecerInputs.d, valorMercado: valorMercado || parecerInputs.d.valorMercado, _cenario: parecerInputs.cenario, _teto: parecerInputs.teto, _perfil: perfilInvestidor };
        // APRENDIZADO: correções que analistas fizeram em avaliações anteriores
        // (via transcrição de reunião → mercado_aprendizado) voltam ao prompt. No-op
        // enquanto não houver lições; fica mais assertivo com o uso.
        let aprendizadoMercado = '';
        try {
          const licoes = await (await sb('mercado_aprendizado?select=campo,valor_ia,valor_real,observacao&order=criado_em.desc&limit=30')).json();
          if (Array.isArray(licoes)) {
            const linhas = licoes
              .filter(l => l && (l.valor_real || l.observacao))
              .map(l => `- ${l.campo ? l.campo + ': ' : ''}o sistema estimou "${String(l.valor_ia || '—').slice(0, 100)}", o analista corrigiu para "${String(l.valor_real || '—').slice(0, 100)}"${l.observacao ? ` — ${String(l.observacao).slice(0, 160)}` : ''}`);
            if (linhas.length) aprendizadoMercado = `\n\nAPRENDIZADOS COM ANALISTAS (correções reais de avaliações anteriores — aplique estas lições e evite repetir os mesmos erros):\n${linhas.join('\n')}`;
          }
        } catch { /* aprendizado é best-effort */ }
        // Calibração por ARREMATES REAIS (previsto×realizado, por modalidade).
        try { aprendizadoMercado += await resumoAprendizadoTexto(imovel?.modalidade || null); } catch { /* best-effort */ }
        // Corpus coletivo da MESMA região/tipo (aprendizado das emissões anteriores).
        try { aprendizadoMercado += await corpusDaRegiao(imovel?.estado || null, imovel?.tipo || null); } catch { /* best-effort */ }
        const pData = await anthropic({
          model: MODEL, max_tokens: 8000,
          system: 'Você é gestor sênior da BidPro Brasil. Redija um parecer MERCADOLÓGICO e de VIABILIDADE FINANCEIRA. Não faça análise jurídica (CNJ, gravames, diligências) — isso é de outros relatórios. EXCEÇÃO: os débitos/encargos informados que serão assumidos DEVEM constar (são custo da operação), com a indicação de onde confirmá-los. Preciso e persuasivo. Nunca use markdown nem asteriscos. Nunca use travessão (o caractere "—"); escreva com vírgula, ponto ou dois-pontos. Apenas texto simples.' + aprendizadoMercado,
          messages: [{ role: 'user', content: promptParecer(pInp, parecerInputs.metricas || {}, mercado, docs) }],
        }, false, { retries: 0, timeoutMs: Math.min(55000, restante() - 12000), noFallback: true });
        parecer = extractText(pData);
      } catch { /* laudo é complementar */ }
    }

    // Lembrete fixo (não-IA): a análise é apoio e não substitui a verificação
    // presencial. Recomenda visitar o imóvel ou ver um similar com corretor.
    const AVISO_MERCADO = '§ SEÇÃO: LEMBRETE E PRÓXIMO PASSO\nEsta análise mercadológica é gerada com apoio de inteligência artificial e tem caráter informativo — pode conter imprecisões e não substitui a verificação presencial. Antes de decidir, recomendamos VISITAR o imóvel pessoalmente ou AGENDAR com um corretor de confiança para conhecer um imóvel similar na região, confirmando estado de conservação, localização e o valor praticado no mercado.';
    if (parecer) parecer += `\n\n${AVISO_MERCADO}`;

      // MERCADO VAZIO (fonte instável no momento → 0 amostras / sem valor): marca no result.
      // Serve para (a) o front mostrar "não estimado" e o servidor NÃO cobrar cota, e (b) o
      // self-heal (regenerar-relatorios-cron) re-tentar com orçamento fresco por até 48h. Uma
      // pesquisa que se PREENCHE numa próxima tentativa limpa o flag e para de ser re-tentada.
      const mercadoVazio = !reaproveitado
        && !(Number(valorMercado) > 0)
        && !(Number(mercado?.precoMedioM2) > 0)
        && (((mercado?.nivel1?.vendas?.length || 0) + (mercado?.nivel2?.vendas?.length || 0)) === 0);
      const result = { mercado, parecer, valorMercado, valorLocacao, reaproveitado, pesquisaEm: mercado.pesquisaEm, mercadoVazio };
      return { result, valorMercado, avalDb, vminImovel };
    })()]);

    await upsertAnalise({ ...base, status: 'concluida', erro: null, result });
    // Aprende NA EMISSÃO (durável, sem IA): corpus + qualidade → agente_aprendizado.
    // mercado/parecer vivem DENTRO do Promise.race acima; aqui usamos o result (que os
    // carrega) para não referenciar variável fora de escopo (bug "mercado is not defined").
    await aprenderNaEmissao(imovel, result.mercado, !!result.parecer, avalDb, vminImovel);

    // MERCADO VAZIO (fonte instável no momento → 0 amostras / sem valor): o relatório é
    // salvo e mostrado como "não estimado", mas NÃO cobramos a cota — o cliente gera de novo
    // sem custo. Antes, um relatório "concluído mas vazio" consumia o crédito injustamente.
    // O flag foi calculado junto do result (acima) e será re-tentado pelo self-heal por 48h.
    const mercadoVazio = !!result.mercadoVazio;
    if (mercadoVazio && cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); cota.estornada = true; } catch { /* estorno best-effort */ }
    }
    // Cobra o CRÉDITO quando esta geração usou crédito (cota mensal esgotada) e o relatório
    // NÃO saiu vazio. Débito = custo real medido × multiplicador; debitar_credito nunca deixa
    // negativo (já pré-autorizamos). Best-effort: não trava a entrega do relatório já pronto.
    if (cobrarCredito && !mercadoVazio) {
      try {
        const dc = await sb('rpc/debitar_credito', { method: 'POST', body: JSON.stringify({
          p_user_id: user.id, p_func: 'mercadologico', p_custo_micro: Math.round(_custoMicroReq),
          p_justificativa: `Relatório mercadológico — ${cidade || ''}/${estado || ''}`, p_referencia: String(imovelId),
        }) });
        cota = { ...(cota || {}), credito: await dc.json().catch(() => null) };
      } catch { /* débito best-effort */ }
    }

    // LOG DE ATIVIDADE (Cliente 360): registra o resultado do relatório com o MOTIVO. Quando
    // vazio, guarda o erro da API (ex.: "sem créditos") — é o que teria mostrado a causa na hora.
    try {
      const m = result.mercado || {};
      const fonte = m.fonteEstimativa === 'indice_bidpro' ? 'índice' : 'mercado ao vivo';
      const nComp = (m.nivel1?.vendas?.length || 0) + (m.nivel2?.vendas?.length || 0);
      await logAtividade(ownerId, mercadoVazio ? 'relatorio_mercado_vazio' : 'relatorio_mercado_ok',
        mercadoVazio ? `Sem estimativa de mercado${m.__erroApi ? ` (API: ${m.__erroApi})` : ' (sem comparáveis ativos)'}` : `Mercado estimado por ${fonte}${valorMercado ? ` — R$ ${Math.round(valorMercado).toLocaleString('pt-BR')}` : ''}`,
        { imovelId: String(imovelId), cidade: cidade || null, fonte, comparaveis: nComp, valorMercado: valorMercado || null, erroApi: m.__erroApi || null, reaproveitado: !!result.reaproveitado, ator: user.id });
    } catch { /* log best-effort */ }

    // SEGURANÇA: NÃO realimentar o score do CARD do catálogo com valores desta análise.
    // roi (parecerInputs.metricas) e areaM2 (mercadoInputs) vêm do CLIENTE e são
    // por-cenário — assim um usuário conseguia ENVENENAR score_financeiro/analise_viavel/
    // valor_mercado que TODOS veem naquele imóvel. O score do catálogo é calculado pelo
    // processo confiável (api/calcular-score.js) a partir dos dados do PRÓPRIO imóvel,
    // nunca por input de usuário. A análise individual continua salva acima (upsertAnalise)
    // e visível só para quem a gerou.
    res.status(200).json({ ok: true, result, cota, mercadoVazio });
  } catch (e) {
    const timeout = String(e?.message) === 'tempo_limite';
    const msg = timeout
      ? 'A pesquisa de mercado demorou mais que o tempo limite do servidor. Costuma ser temporário: tente gerar novamente.'
      : String(e?.message || e);
    await upsertAnalise({ ...base, status: 'erro', erro: msg });
    try { await logAtividade(ownerId, 'relatorio_mercado_erro', String(msg).slice(0, 200), { imovelId: String(imovelId), cidade: cidade || null, timeout, erroApi: e?.detalhe || null, ator: user.id }); } catch { /* log best-effort */ }
    // Estorna a cota consumida (não cobra por análise que falhou; evita cobrança
    // dupla na re-tentativa, já que 'erro' não conta como concluída em isNovo).
    if (cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
    }
    res.status(timeout ? 504 : 500).json({ error: timeout ? 'Tempo limite ao gerar a análise' : 'Falha ao gerar a análise', detalhe: msg });
  }
}
