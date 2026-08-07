// Geração da análise mercadológica + laudo NO SERVIDOR (persistente).
// O cliente dispara e pode FECHAR a aba: a função Vercel continua rodando até o
// fim e grava o resultado em `analises_mercado`. Ao reabrir (qualquer device), o
// app lê o resultado do banco. Espelha os prompts de src/utils/claude.js.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { getUser } from './_auth.js';
import { fetchExternoSeguro } from './_allowed-hosts.js';
import { anthropicFetch } from './_claude.js';
import { custoRespostaClaude, registrarCustoGeracao } from './_uso.js';
import { groundingGemini } from './_grounding.js';
import { resumoAprendizadoTexto } from './_arremate-aprendizado.js';
import { ehCidadeTemporada, motivoTemporada } from './_temporada.js';
import { composicaoTemporal, avisoFrescor } from './_indice-composicao.js';
import { referenciaPonderada } from './_indice-ponderacao.js';
import { geocodificarCascata, rankNivel, coordValida } from './_geo.js';
import { extratoEdital, extratoMatricula } from './_edital-extrato.js';
import { pagamentoPrior, pagamentoAprender } from './_doc-extracao.js';
// MESMA função pura que a tela usa para ROI/ROE/capital/teto. Importada aqui para o
// servidor RECALCULAR a viabilidade depois de descobrir o valor de mercado (ver o bloco
// "MÉTRICAS RECALCULADAS NO SERVIDOR" no parecer) — parecer e tela param de divergir.
import { calcularMetricasCenario, calcularTetoLance } from '../src/utils/calculos.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const MODEL = 'claude-sonnet-4-6';
const REUSE_DIAS = Number(process.env.ANALISE_REUSE_DIAS || 7); // reaproveita a pesquisa de mercado deste imóvel se feita há < N dias

// MERCADOLÓGICO no GEMINI (Google Search grounding) — ~10x mais barato que o Claude web_search.
// Motor trocável por env (MERCADO_MOTOR=gemini|claude, padrão gemini). O DOCUMENTAL segue no
// Claude (outro arquivo). Se o Gemini falhar/vier vazio, a buscarEtapa CAI para o Claude
// automaticamente — custo baixo sem perder uptime/qualidade.
const MERCADO_MOTOR = (process.env.MERCADO_MOTOR || 'gemini').trim().toLowerCase();
const GEMINI_KEY = (process.env.GEMINI_API_KEY || '').trim();

// Pesquisa mercadológica no Gemini com grounding. MESMO prompt/sistema do Claude. O motor
// saiu daqui para `_grounding.js` em 06/08 e passou a ser compartilhado com o ÍNDICE, que
// continuava no Claude web_search e abortava por timeout (200s) em endereço comum. Aqui fica
// só o que é do relatório: o parse (com recuperação de JSON truncado) e o __diag.
async function buscarGeminiGrounding({ prompt, sistema, timeoutMs }) {
  const g = await groundingGemini({ prompt, sistema, timeoutMs });
  if (g.__falhou) return g;
  const parsed = parseJSON(g.texto) || {};
  parsed.__diag = g.diag;
  return parsed;
}

// ENDEREÇO COMPLETO A PARTIR DO DOCUMENTO (pedido do dono: "não puxar o endereço estando no
// edital/matrícula não pode se repetir"). Lê a matrícula/edital (PDF via Claude — leitura de doc
// é do Claude; HTML por regex) e devolve {texto, bairro, cep} do imóvel do leilão, ou null.
async function extrairEnderecoPdf(base64, deadline) {
  const budget = deadline - Date.now();
  if (budget < 12000) return null;
  const data = await anthropic({
    model: MODEL, max_tokens: 300,
    system: 'Você lê documentos de leilão de imóvel. Responda SOMENTE JSON válido, sem markdown.',
    messages: [{ role: 'user', content: [
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 }, title: 'documento do lote' },
      { type: 'text', text: 'Extraia o ENDEREÇO do imóvel objeto do leilão: {"logradouro": string, "numero": string, "bairro": string, "cidade": string, "uf": string, "cep": string}. Copie da DESCRIÇÃO do imóvel no edital/matrícula. Use "" quando não constar. NUNCA invente.' },
    ] }],
  }, false, { retries: 0, timeoutMs: Math.min(30000, budget - 3000), noFallback: true });
  const j = parseJSON(extractText(data)) || {};
  const partes = [[j.logradouro, j.numero].filter(Boolean).join(', '), j.bairro, j.cidade].map((s) => String(s || '').trim()).filter(Boolean);
  if (!partes.length) return null;
  const uf = String(j.uf || '').trim();
  return { texto: partes.join(', ') + (uf ? `/${uf}` : ''), bairro: String(j.bairro || '').trim(), cep: String(j.cep || '').trim() };
}
async function garantirEnderecoDoc(imovelId, deadline) {
  try {
    const rows = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(imovelId)}&select=url_lote,link_edital,link_matricula,anexos&limit=1`)).json();
    const im = Array.isArray(rows) ? rows[0] : null;
    if (!im) return null;
    let anexosUrls = [];
    try { anexosUrls = Array.isArray(im.anexos) ? im.anexos.map((a) => (typeof a === 'string' ? a : a?.url)).filter(Boolean) : []; } catch { /* ignore */ }
    // Matrícula/edital primeiro (é onde vem a descrição/endereço do imóvel); PDFs antes de páginas.
    const candidatos = [...new Set([im.link_matricula, im.link_edital, ...anexosUrls, im.url_lote])].filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u));
    const ehDoc = (u) => (/\.pdf(\?|#|$)|\/edital|matricula|documentacao/i.test(u) ? 0 : 1);
    candidatos.sort((a, b) => ehDoc(a) - ehDoc(b));
    for (const url of candidatos) {
      if (Date.now() > deadline) break;
      let buf = null, ct = '';
      try {
        // URL vem do banco (anexo/edital do leiloeiro) — fetchExternoSeguro barra rede interna
        // e revalida cada redirect, igual aos demais leitores de documento (gerar-documental,
        // enriquecer-lote). Antes era fetch cru: só filtrava por ^https?://.
        const r = await fetchExternoSeguro(url, { headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(12000) });
        if (!r.ok) continue;
        ct = r.headers.get('content-type') || '';
        buf = Buffer.from(await r.arrayBuffer().catch(() => new ArrayBuffer(0)));
      } catch { continue; }
      if (!buf?.length) continue;
      const ehPdf = /pdf/i.test(ct) || buf.slice(0, 5).toString('latin1') === '%PDF-';
      if (ehPdf && buf.length <= 6_500_000 && Date.now() < deadline) {
        try { const e = await extrairEnderecoPdf(buf.toString('base64'), deadline); if (e?.texto) return e; } catch { /* próxima fonte */ }
      } else if (!ehPdf) {
        const txt = buf.toString('utf8').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');
        const m = txt.match(/endere[çc]o[:\s]+([^.;|]{10,120})/i) || txt.match(/((?:rua|avenida|av\.|travessa|alameda|rodovia|estrada|pra[çc]a)\s+[^.;|,]{4,80}[^.;|]{0,60})/i);
        if (m && m[1]) return { texto: m[1].trim(), bairro: '', cep: '' };
      }
    }
  } catch { /* best-effort — nunca bloqueia o relatório */ }
  return null;
}

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
// BARRA DE EVOLUÇÃO (pedido do dono: "coloque uma barra de evolução que a cada resposta vai
// preenchendo ou sinalizando que foi concluída"). Grava o progresso das ETAPAS da geração na
// coluna `progresso` da linha 'gerando' (chave user_id+imovel_id) — com CONTAGEM ISOLADA por
// etapa. O front lê enquanto faz o polling e preenche a barra a cada etapa concluída. É
// best-effort: nunca bloqueia nem atrasa a geração (um PATCH curto entre as chamadas caras).
const PROG_LABELS = {
  comparaveis: 'Comparáveis de mercado (venda e locação)',
  contexto: 'Contexto da região (FipeZAP, zoneamento, perfil, segurança)',
  parecer: 'Parecer de viabilidade',
};
async function marcarProgresso(imovelId, ownerId, etapas) {
  try {
    if (!ownerId || !imovelId) return;
    const norm = (etapas || []).map(e => ({ key: e.key, label: PROG_LABELS[e.key] || e.key, status: e.status || 'pendente', n: (e.n ?? null) }));
    await sb(`analises_mercado?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ progresso: { etapas: norm, atualizadoEm: new Date().toISOString() } }),
    });
  } catch { /* progresso é best-effort */ }
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
    const r = await sb(`indice_amostra?cidade_norm=eq.${encodeURIComponent(imDb.cidade_norm)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(segmento)}&especie=eq.venda&${faixaVendaQ(segmento)}&select=valor_m2,fonte,lat,lng&limit=800`);
    if (!r.ok) return null;
    const j = await r.json().catch(() => []);
    const limpas = (Array.isArray(j) ? j : []).filter(a => Number(a.valor_m2) > 0 && !ehFonteLeilao(a.fonte));
    const vals = limpas.map(a => Number(a.valor_m2)).sort((x, y) => x - y);
    if (vals.length < 4) return null;
    const pct = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
    // Headline por PROXIMIDADE + PADRÃO ao imóvel-alvo, misturado ao ticket médio quando há poucas
    // amostras perto (pedido do dono). Só quando o alvo tem coordenada; senão mediana da cidade.
    // As BANDAS (popular/médio/alto) seguem os percentis da CIDADE — descrevem o espectro de padrão.
    const pond = referenciaPonderada(limpas.map(a => ({ valor_m2: Number(a.valor_m2), lat: a.lat, lng: a.lng })),
      { lat: imDb.latitude, lng: imDb.longitude });
    const venda_m2 = (pond && pond.valor > 0) ? pond.valor : Math.round(pct(0.50));
    return { venda_m2, bandas: { popular: Math.round(pct(0.25)), medio: Math.round(pct(0.50)), alto: Math.round(pct(0.75)) }, n: vals.length, ponderacao: pond || null };
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
    // Campos COMPLETOS e HONESTOS (auditoria 01/08 — o card mostrava "bairro · 0 amostras"
    // com dado da cidade): n_amostras/fonte sempre presentes, e o NÍVEL declara o escopo
    // REAL do número — o caminho central usa amostras da CIDADE (ponderadas por proximidade),
    // então nunca herda o rótulo 'bairro'/'grid' do RPC (prometia granularidade que não tem).
    if (central) return { venda_m2: central.venda_m2, aluguel_m2: Number(j?.aluguel_m2) || 0, nivel: 'cidade', bandas: central.bandas, n_amostras: central.n, fonte: 'relatorio' };
    if (j && (Number(j.venda_m2) > 0 || Number(j.aluguel_m2) > 0)) return j;
    // ÚLTIMO nível do cascata: ESTADO (referência ampla majorada) quando a cidade não tem base
    // própria — dá um valor de referência em vez de nada (deixa EXPLÍCITO que é do estado).
    try {
      const re = await sb('rpc/indice_estado_ponderado', { method: 'POST', body: JSON.stringify({ p_uf: imDb.estado, p_tipo: segmento }) });
      const e = await re.json().catch(() => null);
      if (e && Number(e.venda_m2) > 0) return {
        venda_m2: Number(e.venda_med) > 0 ? Number(e.venda_med) : Number(e.venda_m2), aluguel_m2: 0, nivel: 'estado',
        bandas: Number(e.venda_pop) > 0 ? { popular: e.venda_pop, medio: e.venda_med, alto: e.venda_alto } : null,
        n_amostras: Number(e.n_venda) || 0, fonte: 'acervo' };
    } catch { /* sem base no estado ainda */ }
    return null;
  } catch { return null; }
}

// DEMOGRAFIA E PRESSÃO HABITACIONAL da cidade (base própria `cidade_socio`, alimentada pelo
// cron mensal /api/socio-ingestao-cron a partir do IBGE).
//
// POR QUE ISTO É UMA LEITURA E NÃO UMA BUSCA: a regra que o dono cravou nesta entrega foi
// "atenção com a separação das etapas para não sobrecarregar o tempo de coleta do relatório".
// Se este dado entrasse na ETAPA B (busca web), somaria segundos e outro ponto de falha a cada
// relatório. Aqui é UMA linha por índice — milissegundos — e a coleta pesada já aconteceu no
// cron mensal. Falhou? Devolve null e o parecer segue sem o bloco. Nunca bloqueia.
async function lerSocioRegiao(imDb) {
  try {
    if (!imDb?.cidade_norm || !imDb?.estado) return null;
    const r = await sb('rpc/socio_regiao', {
      method: 'POST',
      body: JSON.stringify({ p_cidade_norm: imDb.cidade_norm, p_uf: String(imDb.estado).toUpperCase(), p_bairro: imDb.bairro || '' }),
    });
    if (!r.ok) return null;
    const j = await r.json().catch(() => null);
    return (j && typeof j === 'object' && (j.populacao || j.pop_estim || j.domicilios)) ? j : null;
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

// ── SANIDADE DA LOCAÇÃO (achado do dono em 03/08) ────────────────────────────────────────
// A VENDA sempre teve faixa por tipo; a LOCAÇÃO entrava com uma única condição: `mensal > 0`.
// Resultado no relatório de um TERRENO de 486 m² em Santana de Parnaíba: "aluguel médio
// R$ 63.409/mês" e "yield 79,53% a.a.". Na base havia aluguéis de R$ 363.000, R$ 150.000 e
// R$ 135.900/mês para terreno — quase certamente PREÇO DE VENDA que o anúncio classificou como
// locação. Três outliers puxaram a média e o número saiu no relatório do cliente como se fosse
// pesquisa de mercado. Precisão aqui não é detalhe: é o produto.
//
// Teto por tipo, em R$/mês, generoso o bastante para não cortar imóvel de luxo (uma casa de
// alto padrão em Alphaville aluga por R$ 30–40 mil) e apertado o bastante para barrar preço de
// venda disfarçado. Piso de R$ 200 corta lixo e valor em centavos.
const FAIXA_LOCACAO_TIPO = {
  terreno:    [200, 60000],   // terreno raramente passa disso; acima é venda ou área industrial
  apartamento:[200, 80000],
  casa:       [200, 120000],
  comercial:  [200, 300000],  // galpão/laje corporativa legitimamente chega a valores altos
  rural:      [200, 200000],
};
const faixaLocacao = (tipo) => FAIXA_LOCACAO_TIPO[String(tipo || '').toLowerCase()] || [200, 150000];
const locacaoPlausivel = (tipo, mensal) => { const [lo, hi] = faixaLocacao(tipo); const n = Number(mensal); return n >= lo && n <= hi; };
// Aluguel/m²/mês fora de [0,50 … 500] não existe no Brasil: abaixo disso é erro de área,
// acima é preço de venda dividido por área. Serve de 2ª malha quando a área é conhecida.
const locacaoM2Plausivel = (v) => { const n = Number(v); return n >= 0.5 && n <= 500; };

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
    const [im] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=id,titulo,endereco,bairro,cidade,estado,latitude,longitude,geocod_nivel,cep,condominio:nomecondominio&limit=1`)).json();
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
    // TETO DE DISTÂNCIA NA BASE (achado do dono em 03/08): o relatório de um lote em Santana
    // de Parnaíba puxou comparáveis de Alphaville — mesma cidade, mas a >5km e de outro padrão
    // de praça, enquanto havia lotes em Aldeia da Serra a 1–3km. Amostra longe não é só ruim
    // para AQUELE relatório: ela entra no Índice com o bairro/grid do ALVO e envenena todos os
    // relatórios seguintes da microrregião. O prompt agora exige `distanciaKm`; aqui é a trava
    // final — acima de 2km não entra na base, mesmo que a IA insista.
    const LONGE_KM = 2;
    const perto = (s) => { const d = Number(s?.distanciaKm); return !Number.isFinite(d) || d <= LONGE_KM; };
    // A COORDENADA DO ALVO SÓ VALE PARA QUEM ESTÁ MESMO NO RAIO (achado 06/08). Toda amostra
    // herdava lat/lng do imóvel-alvo — inclusive a que a própria IA disse estar a 1,8 km. Como o
    // recorte "nível 1" é ≤250 m, a amostra distante entrava como se fosse da mesma rua. Só
    // carimba a coordenada quando o anúncio declara estar dentro do raio; fora dele a amostra
    // vale pelo BAIRRO (casamento por texto), que é o que ela de fato é.
    const NO_RAIO_KM = 0.25;
    const noRaio = (s) => { const d = Number(s?.distanciaKm); return Number.isFinite(d) && d <= NO_RAIO_KM; };
    const coordDe = (s) => (noRaio(s) ? { geo_grid: geoGrid, lat: latA, lng: lngA } : { geo_grid: '', lat: null, lng: null });
    // REFERÊNCIA CITÁVEL da amostra (link/endereço/condomínio). Sem ela, um comparável guardado
    // na base não é auditável pelo cliente — e é a base que sustenta o relatório em MODO BASE.
    const refDe = (s) => ({
      url: (typeof s?.url === 'string' && /^https?:\/\//i.test(s.url)) ? s.url.slice(0, 500) : null,
      endereco: s?.endereco ? String(s.endereco).slice(0, 200) : null,
      condominio: s?.condominio ? String(s.condominio).slice(0, 160) : null,
    });
    for (const s of vendas) {
      const m2 = Number(s?.valorM2);
      if (!perto(s)) continue;
      if (!vendaPlausivelTipo(segmento, m2) || ehFonteLeilao(s?.fonte)) continue; // faixa por tipo (terreno não é cortado)
      rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: bDe(s), ...coordDe(s), tipo: segmento,
        especie: 'venda', valor_m2: Math.round(m2), valor_total: Number(s?.valor) || null, area_m2: Number(s?.m2) || null,
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), ...refDe(s), origem: 'relatorio', imovel_id: String(imovelId || '') });
    }
    for (const s of locs) {
      const mensal = Number(s?.valorMensal); const area = Number(s?.m2);
      // Faixa por TIPO (antes bastava ser > 0 — foi por aqui que entrou "aluguel de terreno
      // de R$ 363.000/mês", que era preço de venda). E, quando a área é conhecida, 2ª malha
      // pelo R$/m²: barra o caso em que o valor é plausível mas a área denuncia a troca.
      // TERRENO NÃO TEM MERCADO DE LOCAÇÃO (achado do dono em 03/08). Lote residencial —
      // sobretudo em condomínio — não se aluga: não há anúncio, não há praça, não há yield.
      // O que os portais devolvem como "terreno para alugar" é OUTRO produto: chácara de
      // evento, pátio, área comercial. Guardar isso como comparável de lote contamina o
      // Índice do tipo e produz "aluguel médio" e "rentabilidade" para algo que não se aluga.
      // Melhor não ter o número do que ter o número errado.
      if (segmento === 'terreno') continue;
      if (!perto(s)) continue;
      if (!locacaoPlausivel(segmento, mensal) || ehFonteLeilao(s?.fonte)) continue;
      const vm2 = area > 0 ? Math.round((mensal / area) * 100) / 100 : null;
      if (vm2 !== null && !locacaoM2Plausivel(vm2)) continue;
      rows.push({ cidade_norm: imDb.cidade_norm, uf, bairro_norm: bDe(s), ...coordDe(s), tipo: segmento,
        especie: 'locacao', valor_m2: vm2, valor_total: mensal, area_m2: area || null,
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), ...refDe(s), origem: 'relatorio', imovel_id: String(imovelId || '') });
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
        data_ref: dref(s?.data), fonte: (s?.fonte ? String(s.fonte).slice(0, 200) : null), ...refDe(s), origem: 'relatorio_regiao', imovel_id: String(imovelId || '') });
    }
    const comAnc = rows.filter(r => String(r.bairro_norm || '').trim() || r.endereco || r.condominio);
    if (comAnc.length !== rows.length) console.log('[indice-ancora] descartadas', rows.length - comAnc.length, 'de', rows.length);
    if (!comAnc.length) return;
    await sb('indice_amostra', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(comAnc) });
  } catch { /* aprendizado é best-effort: nunca bloqueia o relatório */ }
}

// ÂNCORA DE LOCALIZAÇÃO (regra do dono, 07/08): amostra sem NENHUMA referência de lugar —
// bairro, endereço ou condomínio — não entra no corpus. Sem isso ela afirma só "nesta cidade" e
// mesmo assim pesa como se fosse da região consultada; pode ser outro lugar, com o portal apenas
// querendo vender. Medido em 07/08: 1.216 das 2.490 linhas do corpus de consulta estavam assim,
// todas vindas DESTE caminho (origem 'relatorio'/'relatorio_regiao').
// O filtro aqui é o par do CHECK que existe na tabela: sem ele o banco rejeitaria o INSERT
// INTEIRO por causa de uma linha ruim, e o lote bom se perderia junto (o insert é best-effort e
// a falha seria silenciosa).
const comAncora = (rs) => rs.filter(r => String(r.bairro_norm || '').trim() || r.endereco || r.condominio);

// COLHEITA DE OUTRAS TIPOLOGIAS (aproveitamento da MESMA busca — pedido do dono): a IA lista em
// LEGADO (06/08): o prompt NÃO pede mais outras tipologias — pedir 4 segmentos na mesma busca
// diluía a atenção e a assertividade do tipo-alvo, que é o que o cliente contratou. A função
// fica só para o caso de um `mercado` em cache antigo ainda trazer o campo; nada novo o produz.
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
    const comAnc2 = comAncora(rows);
    if (!comAnc2.length) return 0;
    await sb('indice_amostra', { method: 'POST', headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' }, body: JSON.stringify(comAnc2) });
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
    const cols = 'select=valor_m2,valor_total,area_m2,data_ref,fonte,url,endereco,condominio,bairro_norm,geo_grid,criado_em&order=criado_em.desc&limit=400';
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
    return { hit: true, nivel, n: arr.length, mediana, text, arr };
  } catch { return null; }
}

/**
 * MODO BASE — o relatório mercadológico SEM busca na web (pedido do dono, 06/08).
 *
 * "A parte mercadológica conseguiremos ter economia bastando pegar apenas os valores e
 *  referências para apresentar no relatório, e fazer o cálculo para a unidade de acordo com
 *  a forma de pagamento, mostrando a viabilidade."
 *
 * Quando a base própria já cobre a praça com DENSIDADE e em nível FINO, os comparáveis saem
 * dela — anúncios REAIS já capturados, com fonte, data e link — e a Etapa A (a busca cara)
 * não roda. O que decide o relatório continua determinístico: R$/m² da base × área da
 * MATRÍCULA, e a viabilidade pela forma de pagamento lida no edital.
 *
 * Guardas, porque o barato não pode custar a credibilidade:
 *  • nível FINO (bairro/grid). Base de CIDADE é grossa demais para avaliar um imóvel
 *    específico — nesses casos a busca continua valendo.
 *  • densidade maior que a exigida para só ENCURTAR a busca (12 contra 8): substituir a
 *    pesquisa pede mais evidência do que complementá-la.
 *  • frescor de 120 dias já garantido por `amostrasRegiaoCache`. Como o modo base não gera
 *    amostra nova, a praça envelhece e sai do modo sozinha — aí um relatório pesquisa e
 *    reabastece. É um ciclo, não um caminho sem volta.
 *  • o relatório DIZ que os comparáveis vêm da base própria, com a data de cada um. Amostra
 *    real de 2 meses atrás é honesta; apresentá-la como anúncio ativo de hoje não seria.
 */
const MODO_BASE_MIN = Math.max(8, Number(process.env.MERCADO_BASE_MIN || 12));
// LOCAÇÕES da mesma praça, da base própria. Sem elas o relatório em modo base sairia sem
// aluguel e sem yield — e yield é metade da decisão de quem compra para renda. O recorte
// acompanha o da venda (mesmo nível, mesma janela de 120 dias).
async function locacoesDaBase(imDb, segmento, nivel) {
  try {
    if (segmento === 'terreno') return [];              // lote não se aluga (regra de 03/08)
    if (!imDb?.cidade_norm || !imDb?.estado) return [];
    const DIAS = Math.max(15, Number(process.env.MERCADO_CACHE_DIAS || 120));
    const desde = new Date(Date.now() - DIAS * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const uf = String(imDb.estado).toUpperCase();
    const bairroNorm = _norm(imDb.bairro);
    const geoGrid = geoGridDe(imDb.latitude, imDb.longitude);
    const recorte = nivel === 'bairro' && bairroNorm ? `&bairro_norm=eq.${encodeURIComponent(bairroNorm)}`
      : nivel === 'grid' && geoGrid ? `&geo_grid=eq.${encodeURIComponent(geoGrid)}` : '';
    const r = await sb(`indice_amostra?cidade_norm=eq.${encodeURIComponent(imDb.cidade_norm)}&uf=eq.${uf}&tipo=eq.${encodeURIComponent(segmento)}&especie=eq.locacao&data_ref=gte.${desde}${recorte}&select=valor_m2,valor_total,area_m2,data_ref,fonte,url,endereco,condominio,bairro_norm&order=data_ref.desc&limit=60`);
    if (!r.ok) return [];
    const j = await r.json().catch(() => []);
    return (Array.isArray(j) ? j : []).filter(a => Number(a.valor_total) > 0 && Number(a.area_m2) > 0 && !ehFonteLeilao(a.fonte));
  } catch { return []; }
}
async function mercadoDaBase(cacheReg, segmento, imDb) {
  const arr = Array.isArray(cacheReg?.arr) ? cacheReg.arr : [];
  if (!cacheReg?.hit || arr.length < MODO_BASE_MIN) return null;
  if (!['bairro', 'grid'].includes(cacheReg.nivel)) return null;
  const mesRef = (a) => String(a.data_ref || '').slice(0, 7);
  const item = (a) => ({
    bairro: a.bairro_norm || '', descricao: [a.condominio, a.endereco].filter(Boolean).join(' — ').slice(0, 160) || 'comparável da base BidPro',
    valor: Number(a.valor_total) || 0, m2: Number(a.area_m2) || 0, valorM2: Math.round(Number(a.valor_m2) || 0),
    distanciaKm: 0, fonte: a.fonte || 'base BidPro', url: a.url || '', data: mesRef(a), daBase: true,
  });
  // Nível 1 = mesmo bairro/grid do alvo (é o recorte que o cache já aplicou); os demais no 2.
  const ord = arr.slice().sort((a, b) => String(b.data_ref || '').localeCompare(String(a.data_ref || '')));
  const vendas = ord.map(item);
  const m2s = vendas.map(v => v.valorM2).filter(v => v > 0).sort((a, b) => a - b);
  if (m2s.length < MODO_BASE_MIN) return null;
  const med = m2s.length % 2 ? m2s[(m2s.length - 1) / 2] : Math.round((m2s[m2s.length / 2 - 1] + m2s[m2s.length / 2]) / 2);
  const nv1 = vendas.slice(0, 12);
  const nv2 = vendas.slice(12, 40);
  const locs = (await locacoesDaBase(imDb, segmento, cacheReg.nivel)).map(a => ({
    bairro: a.bairro_norm || '', descricao: [a.condominio, a.endereco].filter(Boolean).join(' — ').slice(0, 160) || 'locação da base BidPro',
    valorMensal: Math.round(Number(a.valor_total)), m2: Math.round(Number(a.area_m2)), distanciaKm: 0,
    fonte: a.fonte || 'base BidPro', url: a.url || '', data: mesRef(a), daBase: true,
  }));
  // MEDIANA (não média) do aluguel, mesma régua da busca; com menos de 3, fica sem número —
  // "não localizamos" é melhor que um aluguel sustentado por uma amostra só (regra do dono).
  const alugs = locs.map(l => l.valorMensal).filter(v => v > 0).sort((a, b) => a - b);
  const aluguelMedio = alugs.length >= 3 ? (alugs.length % 2 ? alugs[(alugs.length - 1) / 2] : Math.round((alugs[alugs.length / 2 - 1] + alugs[alugs.length / 2]) / 2)) : 0;
  const agreg = (vs) => {
    const xs = vs.map(v => v.valorM2).filter(v => v > 0).sort((a, b) => a - b);
    if (!xs.length) return { precoMedioM2: 0, precoMinM2: 0, precoMaxM2: 0 };
    const m = xs.length % 2 ? xs[(xs.length - 1) / 2] : Math.round((xs[xs.length / 2 - 1] + xs[xs.length / 2]) / 2);
    return { precoMedioM2: m, precoMinM2: xs[0], precoMaxM2: xs[xs.length - 1] };
  };
  return {
    nivel1: { descricao: `Base própria BidPro — ${nv1.length} comparáveis reais já capturados no nível ${cacheReg.nivel}`, vendas: nv1, locacoes: locs.slice(0, 12), ...agreg(nv1), aluguelMedio, totalAmostras: nv1.length + Math.min(locs.length, 12), disponiveis: true },
    nivel2: { descricao: `Base própria BidPro — demais comparáveis da praça`, vendas: nv2, locacoes: locs.slice(12), ...agreg(nv2), aluguelMedio: 0, totalAmostras: nv2.length + Math.max(0, locs.length - 12) },
    consolidado: { precoMedioM2: med, aluguelMedio, yieldBruto: 0, yieldLiquido: 0, valorEstimadoImovel: 0, unidadeValor: segmento === 'terreno' ? 'm2_terreno' : 'm2_privativo', areaConsiderada: 0, baseCalculo: '', padraoImovel: '' },
    precoMedioM2: med,
    fonteEstimativa: 'base_propria',
    __modoBase: { nivel: cacheReg.nivel, n: arr.length, mediana: med },
    comentario: `Os comparáveis deste relatório vêm da BASE PRÓPRIA BidPro: ${arr.length} anúncios reais do mesmo tipo já capturados nesta praça (nível ${cacheReg.nivel}), todos com fonte e data. Não houve nova pesquisa na web porque a base já cobre a região com densidade e no período recente. A mediana de ${Math.round(med).toLocaleString('pt-BR')} R$/m² é o que sustenta o valor estimado.`,
  };
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
function classificarIntencao({ baseTipo, desconto, yieldBruto, cidadeNorm, turismoSazonal }) {
  const residencial = baseTipo === 'residencial';
  const liquido = baseTipo === 'residencial' || baseTipo === 'comercial';
  const cls = { revenda: false, locacao: false, temporada: false, motivos: {} };
  if (liquido && Number(desconto) >= 30) {
    cls.revenda = true;
    cls.motivos.revenda = `Desconto de ${Math.round(desconto)}% frente à avaliação: margem de revenda (flip) saudável e boa liquidez do tipo.`;
  }
  // LOCAÇÃO: piso de yield elevado para 1% AO MÊS (= 12% a.a. bruto) — decisão do dono.
  // yieldBruto aqui é ANUAL (aluguel×12/valor×100); 12% a.a. ≈ 1% do valor por mês.
  const y = Number(yieldBruto) || 0;
  if (residencial && y >= 12) {
    cls.locacao = true;
    cls.motivos.locacao = `Yield bruto de locação ~${y.toFixed(1)}% a.a. (~${(y / 12).toFixed(2)}% ao mês): renda de aluguel atrativa (piso de 1% ao mês).`;
  }
  // TEMPORADA: destino turístico/SAZONAL — não só litoral. Duas fontes (decisão do dono
  // "veja nas classificações das buscas mercadológicas"): (1) lista curada `_temporada.js`
  // (praia, termas, serra/inverno, histórica, parques); (2) o sinal turístico que a IA leu da
  // região na busca (perfilRegiao.turismoSazonal) — pega destinos fora da lista, com o TIPO.
  const ts = turismoSazonal && (turismoSazonal.e === true || turismoSazonal.e === 'sim') ? turismoSazonal : null;
  if (residencial && (ehCidadeTemporada(cidadeNorm) || ts)) {
    cls.temporada = true;
    const TIPO_LABEL = { praia: 'litoral/praia', historica: 'cidade histórica', serra_inverno: 'serra / inverno', termas_aguas: 'termas / águas', parques_natureza: 'parques / natureza', campo_verao: 'campo / veraneio', religioso: 'turismo religioso' };
    cls.motivos.temporada = motivoTemporada(cidadeNorm)
      || (ts ? `Destino turístico e sazonal${ts.tipo ? ` (${TIPO_LABEL[ts.tipo] || ts.tipo})` : ''}: ${ts.motivo || 'potencial de aluguel por temporada (curta duração)'}.`
            : 'Cidade de destino turístico: potencial de aluguel por temporada (curta duração).');
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
  // web_search_20260209 (filtragem dinâmica) não pede header beta — o antigo
  // 'web-search-2025-03-05' era do tipo _20250305 e virou ruído aqui.
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

═══ NÍVEL 2 — VIZINHANÇA (250m a ~1km) ═══
Busque o máximo de anúncios (mesmo tipo) no bairro e adjacências, até ~1km. Meta: 15+ vendas e 8+ locações.

═══ TETO DE DISTÂNCIA (REGRA DURA — não negocie) ═══
O raio EXISTE para não comparar o imóvel com outra praça. Bairro nobre a 5km tem preço de outro
mercado; usá-lo como comparável INFLA a estimativa e o cliente decide errado.
• NUNCA use amostra a mais de 1km nos níveis 1 e 2.
• Só se, somados os níveis 1 e 2, houver MENOS de 5 vendas, você pode expandir até 2km — e então,
  OBRIGATORIAMENTE: (a) marque cada amostra assim obtida com "distanciaKm" (ex.: 1.8); (b) dê a ela
  PESO MENOR na média; (c) escreva no "comentario", com todas as letras, que faltaram comparáveis
  próximos e o raio foi ampliado para 2km.
• Mais de 2km: NÃO USE, em nenhuma hipótese. Prefira devolver poucas amostras a devolver amostras
  de outra praça. Se nem a 2km houver 5 vendas, diga isso no "comentario" e alargue
  precoMinM2/precoMaxM2 para refletir a incerteza.
• Preencha "distanciaKm" em TODA amostra sempre que conseguir estimar a distância até o alvo.
• MESMO PRODUTO: lote em condomínio compara com lote em condomínio; não com lote de rua aberta,
  chácara ou área comercial, ainda que a distância seja parecida.

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

═══ COLHEITA AMPLA — MESMO TIPO EM TODA A CIDADE (compõe o Índice) ═══
Ao pesquisar (grandes portais E imobiliárias LOCAIS), você verá MUITOS anúncios do MESMO tipo
(${tipoImovel}) em OUTROS bairros da cidade, fora da vizinhança do imóvel-alvo. NÃO os use no
valor do imóvel-alvo, MAS liste em "outrosBairros" ATÉ 25 (sem buscas dedicadas; NÃO passe de 25
para a resposta não estourar o limite e ser cortada), CADA UM com o seu "bairro" — isso alimenta o
Índice da cidade/estado (composição por bairro). PRIORIDADE ABSOLUTA: preencha nivel1/nivel2 por
completo ANTES de "outrosBairros"; se faltar espaço, corte "outrosBairros", nunca os níveis 1/2.
Apenas VENDA, mesmo tipo (${tipoImovel}), SEM leilão; o "bairro" de cada amostra é OBRIGATÓRIO.

LOCAÇÃO EM TERRENO — NÃO SE APLICA: se o imóvel-alvo for TERRENO ou LOTE (inclusive em condomínio),
devolva "locacoes": [], "aluguelMedio": 0, "yieldBruto": 0 e "yieldLiquido": 0, e diga na descrição
que lote não possui mercado de locação. O que os portais listam como "terreno para alugar" é OUTRO
produto — chácara de eventos, pátio de estacionamento, área comercial —, não comparável a um lote
residencial. Rentabilidade de aluguel para lote é informação FALSA, não informação faltante.

LOCAÇÃO — REGRA DE SANIDADE (o relatório de um TERRENO já saiu com "aluguel médio R$ 63.409/mês"
porque três anúncios de VENDA foram lidos como aluguel): em "locacoes", só inclua anúncios de
ALUGUEL RESIDENCIAL/COMERCIAL MENSAL do mesmo tipo. Antes de incluir, faça a checagem: um aluguel
mensal quase nunca passa de 1% do valor de VENDA do mesmo imóvel. Se o "aluguel" for da ordem de
grandeza de um preço de venda (dezenas ou centenas de milhares de reais para um imóvel comum),
DESCARTE — é anúncio de venda mal classificado. Informe "m2" (área do imóvel anunciado) sempre que
o anúncio trouxer, para permitir o cálculo de R$/m². E em "aluguelMedio" use a MEDIANA das
locações, não a média: a mediana não é derrubada por um outlier. Se sobrarem menos de 3 locações
plausíveis, devolva "aluguelMedio": 0 e yield 0 — vazio é honesto, número inventado não é.

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

REGRA DAS LOCAÇÕES (obrigatória): em cada item de "locacoes", o campo "m2" é OBRIGATÓRIO e deve trazer a
ÁREA do imóvel anunciado (privativa/útil, em m²). Sem a área, o aluguel não vira R$/m² e a amostra é
DESCARTADA — anúncio de locação sem metragem não deve ser incluído. Prefira menos locações COM área a
muitas sem área.

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": { "descricao": "", "vendas": [{"bairro":"","descricao":"","valor":0,"m2":0,"valorM2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","condominio":"","data":"AAAA-MM"}], "locacoes": [{"bairro":"","descricao":"","valorMensal":0,"m2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0, "disponiveis": true },
  "nivel2": { "descricao": "", "vendas": [{"bairro":"","descricao":"","valor":0,"m2":0,"valorM2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","condominio":"","data":"AAAA-MM"}], "locacoes": [{"bairro":"","descricao":"","valorMensal":0,"m2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0 },
  "consolidado": { "precoMedioM2": 0, "aluguelMedio": 0, "yieldBruto": 0, "yieldLiquido": 0, "valorEstimadoImovel": 0, "unidadeValor": "m2_privativo|m2_construido|m2_terreno|hectare|unidade", "areaConsiderada": 0, "baseCalculo": "(explique a conta: ex.: 'R$ 10.980/m² privativo × 30 m²' ou 'R$ 45.000/ha × 120 ha terra nua + R$ 200k benfeitorias' ou 'construção 90 m² × R$ 4.000 + terreno excedente 300 m² × R$ 800')", "padraoImovel": "popular|medio|medio_alto|alto|luxo", "terrenoExcedente": { "haExcedente": false, "areaExcedenteM2": 0, "valorTerrenoExcedente": 0 }, "descontoArremate": null },
  "referenciaFipeZap": { "encontrado": true, "precoMedioM2": 0, "valorizacao12m": 0, "mesReferencia": "AAAA-MM", "localidade": "", "fonte": "" },
  "outrosBairros": [{"bairro":"","valorM2":0,"valor":0,"m2":0,"fonte":"","url":"","data":"AAAA-MM"}],
  "fontesLocais": [{"nome":"","url":""}],
  "zoneamento": { "encontrado": false, "zona": "", "resumoUso": "", "fonte": "", "ondeObter": "" },
  "perfilRegiao": { "tier": "valorizado_alto|intermediario|valorizado_baixo|", "atratividades": [""], "fragilidades": [""], "motivos": "" },
  "segurancaPublica": { "encontrado": false, "nivel": "", "indicadores": "", "tendencia": "", "fonte": "", "periodo": "", "recomendacao": "" },
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis, a tendência e a ADERÊNCIA da média dos anúncios ao FipeZAP (se divergirem >15%, explique por quê)."
}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUSCA EM ETAPAS (pedido do dono: separar as chamadas da IA em blocos com CONTAGENS e TEMPOS
// INDEPENDENTES — "várias coisas ao mesmo tempo sobrecarregam e estouram o tempo, o relatório
// vem incompleto e com amostras inconsistentes"). O promptMercado (mega-prompt único) segue
// exportado para o A/B (ab-mercadologica.js), mas a GERAÇÃO REAL agora usa DUAS chamadas:
//   • ETAPA A — promptComparaveis (ESSENCIAL): tudo que sustenta o VALOR — níveis 1/2 de venda e
//     locação, consolidado (valorEstimadoImovel), fontes locais. Recebe o maior orçamento de
//     tempo e de buscas web; é a etapa que NÃO pode falhar.
//   • ETAPA B — promptContexto (BEST-EFFORT): FipeZAP, zoneamento, perfil da região, segurança
//     pública, outras tipologias e outros bairros (semeiam o Índice). Roda com tempo/ buscas
//     PRÓPRIOS e curtos; se falhar/estourar, o relatório entrega assim mesmo com a Etapa A.
// Assim um contexto lento nunca mais derruba (ou esvazia) o relatório inteiro.
// ─────────────────────────────────────────────────────────────────────────────
export function promptComparaveis({ endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio }) {
  return `Você é um perito avaliador imobiliário. Realize a PESQUISA DE COMPARÁVEIS em DOIS NÍVEIS para o imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

FOCO DESTA ETAPA: SÓ comparáveis de venda e locação + o valor consolidado. NÃO gaste buscas com
FipeZAP, zoneamento, segurança ou perfil da região (isso é pedido numa etapa separada).

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

═══ NÍVEL 2 — VIZINHANÇA (250m a ~1km) ═══
Busque o máximo de anúncios (mesmo tipo) no bairro e adjacências, até ~1km. Meta: 15+ vendas e 8+ locações.

═══ TETO DE DISTÂNCIA (REGRA DURA — não negocie) ═══
O raio EXISTE para não comparar o imóvel com outra praça. Bairro nobre a 5km tem preço de outro
mercado; usá-lo como comparável INFLA a estimativa e o cliente decide errado.
• NUNCA use amostra a mais de 1km nos níveis 1 e 2.
• Só se, somados os níveis 1 e 2, houver MENOS de 5 vendas, você pode expandir até 2km — e então,
  OBRIGATORIAMENTE: (a) marque cada amostra assim obtida com "distanciaKm" (ex.: 1.8); (b) dê a ela
  PESO MENOR na média; (c) escreva no "comentario", com todas as letras, que faltaram comparáveis
  próximos e o raio foi ampliado para 2km.
• Mais de 2km: NÃO USE, em nenhuma hipótese. Prefira devolver poucas amostras a devolver amostras
  de outra praça. Se nem a 2km houver 5 vendas, diga isso no "comentario" e alargue
  precoMinM2/precoMaxM2 para refletir a incerteza.
• Preencha "distanciaKm" em TODA amostra sempre que conseguir estimar a distância até o alvo.
• MESMO PRODUTO: lote em condomínio compara com lote em condomínio; não com lote de rua aberta,
  chácara ou área comercial, ainda que a distância seja parecida.

FONTES (grandes portais): ZAP, VivaReal, OLX, Quinto Andar, Imovelweb, Loft, 123i, Chaves na Mão, Net Imóveis. Cruze várias.

FONTES LOCAIS (OBRIGATÓRIO — frequentemente MAIS confiáveis): além dos grandes portais, busque também ANÚNCIOS DE IMOBILIÁRIAS DA PRÓPRIA CIDADE de ${cidade}/${estado}. Pesquise por "imobiliária ${cidade}", "imóveis à venda ${cidade}" (e o bairro, se houver) e abra os sites das imobiliárias locais — os anúncios delas costumam refletir MELHOR o preço praticado na praça e podem ser COMPLEMENTARES ou até DECISIVOS na composição do valor. Inclua essas amostras nos níveis 1/2 com "fonte" = nome da imobiliária local, e dê PESO ao menos igual ao dos grandes portais quando forem recentes e do mesmo tipo/microrregião. Ao final, liste em "fontesLocais" as imobiliárias LOCAIS que você usou/encontrou (nome + url do site) — nós memorizamos e reusamos nas próximas análises desta praça.

DATA DO ANÚNCIO: para CADA amostra, capture a data no campo "data" (formato "AAAA-MM"; senão "recente").
RECÊNCIA (IMPORTANTE): priorize FORTEMENTE anúncios do ANO CORRENTE e dos últimos ~12 meses. EVITE anúncios com mais de ~18 meses, a menos que não haja recentes suficientes — o preço muda rápido. Na média, dê MENOS peso às amostras antigas. Se a maioria das amostras for antiga (ex.: de anos anteriores), diga isso EXPLICITAMENTE no "comentario" e trate a estimativa como menos precisa (alargue precoMinM2/precoMaxM2).

VALOR ESTIMADO DO IMÓVEL (OBRIGATÓRIO — é o número que sustenta o relatório): em
"consolidado.valorEstimadoImovel" calcule o valor de mercado CONSERVADOR do imóvel pelo MÉTODO
DO TIPO acima (não apenas preço/m² × área quando o tipo não for por m² privativo). Preencha também
"unidadeValor", "areaConsiderada" (a medida que multiplicou: m² privativo/construído/terreno OU
hectares OU unidades) e "baseCalculo" (a conta em texto). Para imóvel com TERRENO EXCEDENTE, some
a construção + o terreno excedente e detalhe em "terrenoExcedente". Se a área da métrica não for
confiável (ex.: veio a área TOTAL no lugar da privativa), DIGA no "comentario" e seja conservador.

REGRA DAS LOCAÇÕES (obrigatória): em cada item de "locacoes", o campo "m2" é OBRIGATÓRIO e deve trazer a
ÁREA do imóvel anunciado (privativa/útil, em m²). Sem a área, o aluguel não vira R$/m² e a amostra é
DESCARTADA — anúncio de locação sem metragem não deve ser incluído. Prefira menos locações COM área a
muitas sem área.

Retorne APENAS este JSON (sem markdown):
{
  "nivel1": { "descricao": "", "vendas": [{"bairro":"","descricao":"","valor":0,"m2":0,"valorM2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","condominio":"","data":"AAAA-MM"}], "locacoes": [{"bairro":"","descricao":"","valorMensal":0,"m2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0, "disponiveis": true },
  "nivel2": { "descricao": "", "vendas": [{"bairro":"","descricao":"","valor":0,"m2":0,"valorM2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","condominio":"","data":"AAAA-MM"}], "locacoes": [{"bairro":"","descricao":"","valorMensal":0,"m2":0,"distanciaKm":0,"fonte":"","url":"","endereco":"","data":"AAAA-MM"}], "precoMedioM2": 0, "precoMinM2": 0, "precoMaxM2": 0, "aluguelMedio": 0, "totalAmostras": 0 },
  "consolidado": { "precoMedioM2": 0, "aluguelMedio": 0, "yieldBruto": 0, "yieldLiquido": 0, "valorEstimadoImovel": 0, "unidadeValor": "m2_privativo|m2_construido|m2_terreno|hectare|unidade", "areaConsiderada": 0, "baseCalculo": "(explique a conta: ex.: 'R$ 10.980/m² privativo × 30 m²' ou 'R$ 45.000/ha × 120 ha terra nua + R$ 200k benfeitorias' ou 'construção 90 m² × R$ 4.000 + terreno excedente 300 m² × R$ 800')", "padraoImovel": "popular|medio|medio_alto|alto|luxo", "terrenoExcedente": { "haExcedente": false, "areaExcedenteM2": 0, "valorTerrenoExcedente": 0 }, "descontoArremate": null },
  "fontesLocais": [{"nome":"","url":""}],
  "comentario": "Análise qualitativa de 3-4 frases comparando os dois níveis, a tendência e a coerência da média (se as amostras forem antigas/poucas, DIGA e alargue a faixa)."
}`;
}

export function promptContexto({ endereco, tipoImovel, areaM2, cidade, estado, nomeCondominio }) {
  return `Você é um perito avaliador imobiliário. Traga o CONTEXTO e as REFERÊNCIAS da região do imóvel:
- Tipo: ${tipoImovel}, ${areaM2 ? areaM2 + 'm²' : 'área não informada'}
- Endereço: ${endereco}, ${cidade}/${estado}
${nomeCondominio ? `- Condomínio: ${nomeCondominio}` : ''}

Esta etapa é COMPLEMENTAR (os comparáveis de valor já foram coletados à parte). NUNCA invente:
sem fonte confiável, marque "encontrado": false. Seja RÁPIDO e objetivo.

═══ REFERÊNCIA INDEPENDENTE — ÍNDICE FipeZAP ═══
Busque o Índice FipeZAP mais recente para ${cidade}/${estado}: preço médio de VENDA por m²
(residencial), e a VALORIZAÇÃO acumulada em 12 meses da cidade. É uma referência oficial
independente da média de anúncios. Se não achar a cidade, use a região metropolitana/capital
mais próxima e sinalize em "fonte". Se não houver dado confiável, marque "encontrado": false.

═══ ZONEAMENTO URBANO (uso do solo) ═══
Consulte o ZONEAMENTO OFICIAL do endereço no órgão municipal (Plano Diretor / Lei de Uso e Ocupação do Solo; em capitais use o GIS oficial: GeoSampa/SP, Data.Rio, IPPUC/Curitiba, BHMap/PBH etc.). Informe a ZONA e o que ela permite (residencial/comercial/misto; e gabarito/coeficiente de aproveitamento se constar) SOMENTE se achar em FONTE OFICIAL — e cite a fonte. Se NÃO houver fonte oficial confiável, marque "encontrado": false e diga exatamente ONDE obter. NUNCA invente ou especule a zona.

═══ PERFIL DA REGIÃO (atratividade e valorização) ═══
Classifique a REGIÃO (bairro/microrregião) do imóvel dentro de ${cidade}/${estado}:
- "tier": se está entre as MAIS valorizadas, INTERMEDIÁRIAS ou MENOS valorizadas da cidade (valorizado_alto|intermediario|valorizado_baixo);
- "atratividades": fatores POSITIVOS reais que puxam o valor (infraestrutura, comércio, transporte, escolas/saúde, áreas verdes/orla, novos empreendimentos);
- "fragilidades": fatores que PESAM (risco de enchente, ruído, proximidade de indústria, difícil acesso, saturação);
- "motivos": 1–2 frases explicando POR QUE a região é mais/menos valorizada.
- "turismoSazonal": a cidade ${cidade}/${estado} é um DESTINO TURÍSTICO e SAZONAL com demanda real de aluguel por TEMPORADA/curta duração (Airbnb)? Considere TODOS os tipos: litoral/praia, cidade HISTÓRICA (patrimônio), SERRA/INVERNO, TERMAS/águas, PARQUES/natureza/aventura, campo/veraneio, turismo religioso. Preencha { "e": true|false, "tipo": "praia|historica|serra_inverno|termas_aguas|parques_natureza|campo_verao|religioso", "motivo": "1 frase objetiva" }. Só marque "e": true se a cidade tiver vocação turística REAL e sazonalidade (não uma cidade comum). Sem certeza, "e": false.
Sem base, deixe "tier":"" e explique a limitação em "motivos".

═══ SEGURANÇA PÚBLICA DA REGIÃO (dados OFICIAIS — factual, NUNCA rótulo subjetivo) ═══
Traga um perfil de segurança pública da região SOMENTE de FONTES OFICIAIS (SSP do estado, ISP-RJ,
Atlas da Violência/IPEA, dados municipais) — citando a FONTE e o PERÍODO. Reporte indicadores
FACTUAIS, JAMAIS um juízo do tipo "bairro perigoso". Sem dado oficial confiável, marque
"encontrado": false e recomende diligência local. Não invente nem estime.

═══ COLHEITA AMPLA — MESMO TIPO EM OUTROS BAIRROS (compõe o Índice) ═══
Liste em "outrosBairros" ATÉ 25 anúncios do MESMO tipo (${tipoImovel}) em OUTROS bairros da cidade
(sem buscas dedicadas; não passe de 25), CADA UM com o seu "bairro" — alimenta o Índice da
cidade/estado. Apenas VENDA, mesmo tipo, SEM leilão; o "bairro" de cada amostra é OBRIGATÓRIO.

LOCAÇÃO EM TERRENO — NÃO SE APLICA: imóvel-alvo TERRENO/LOTE → "locacoes": [], "aluguelMedio": 0 e
yields 0. Lote não tem mercado de locação; "terreno para alugar" nos portais é chácara de evento,
pátio ou área comercial — outro produto. Rentabilidade de aluguel para lote é informação FALSA.

LOCAÇÃO — REGRA DE SANIDADE: em "locacoes", só anúncios de ALUGUEL MENSAL do mesmo tipo. Um aluguel
mensal quase nunca passa de 1% do valor de VENDA do mesmo imóvel — se o valor tiver ordem de
grandeza de preço de venda, DESCARTE (é anúncio de venda mal classificado). Informe "m2" quando o
anúncio trouxer. Em "aluguelMedio" use a MEDIANA, não a média. Menos de 3 locações plausíveis →
"aluguelMedio": 0 e yield 0.

REGRA DAS LOCAÇÕES (obrigatória): em cada item de "locacoes", o campo "m2" é OBRIGATÓRIO e deve trazer a
ÁREA do imóvel anunciado (privativa/útil, em m²). Sem a área, o aluguel não vira R$/m² e a amostra é
DESCARTADA — anúncio de locação sem metragem não deve ser incluído. Prefira menos locações COM área a
muitas sem área.

Retorne APENAS este JSON (sem markdown):
{
  "referenciaFipeZap": { "encontrado": true, "precoMedioM2": 0, "valorizacao12m": 0, "mesReferencia": "AAAA-MM", "localidade": "", "fonte": "" },
  "outrosBairros": [{"bairro":"","valorM2":0,"valor":0,"m2":0,"fonte":"","url":"","data":"AAAA-MM"}],
  "zoneamento": { "encontrado": false, "zona": "", "resumoUso": "", "fonte": "", "ondeObter": "" },
  "perfilRegiao": { "tier": "valorizado_alto|intermediario|valorizado_baixo|", "atratividades": [""], "fragilidades": [""], "motivos": "", "turismoSazonal": { "e": false, "tipo": "praia|historica|serra_inverno|termas_aguas|parques_natureza|campo_verao|religioso", "motivo": "" } },
  "segurancaPublica": { "encontrado": false, "nivel": "", "indicadores": "", "tendencia": "", "fonte": "", "periodo": "", "recomendacao": "" }
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

// Bloco DEMOGRÁFICO do parecer. Todo número sai com FONTE e ANO — dado velho apresentado como
// atual é pior do que dado nenhum. Duas coisas nunca se misturam aqui:
//   • FATOS do IBGE (população, domicílios, vagos, nascimentos);
//   • a LEITURA derivada da BidPro (pressão habitacional), que é claramente rotulada como nossa
//     e comparada aos tercis do país. O déficit habitacional OFICIAL é da FJP e só aparece se o
//     número oficial estiver carregado — jamais estimado e chamado de FJP.
function blocoSocio(s, cidade) {
  if (!s) return '';
  const int = (v) => (Number(v) > 0 ? Math.round(Number(v)).toLocaleString('pt-BR') : null);
  const pct = (v, d = 1) => (Number.isFinite(Number(v)) ? `${Number(v).toFixed(d).replace('.', ',')}%` : null);
  const L = [];
  const pop = int(s.pop_estim) || int(s.populacao);
  const popAno = s.pop_estim > 0 ? s.pop_estim_ano : s.populacao_ano;
  if (pop) L.push(`- População: ${pop} habitantes (IBGE, ${popAno || 'ano não informado'})`);
  if (Number.isFinite(Number(s.crescimento_recente_aa_pct)))
    L.push(`- Ritmo de crescimento populacional: ${pct(s.crescimento_recente_aa_pct, 2)} ao ano`);
  if (int(s.domicilios)) L.push(`- Domicílios: ${int(s.domicilios)} (Censo IBGE ${s.domicilios_ano || ''})${int(s.domicilios_vagos) ? ` · vagos: ${int(s.domicilios_vagos)} (${pct(s.domicilios_vagos_pct)})` : ''}`);
  if (Number(s.moradores_por_domicilio) > 0) L.push(`- Média de moradores por domicílio: ${Number(s.moradores_por_domicilio).toFixed(2).replace('.', ',')}`);
  if (Number(s.densidade_hab_km2) > 0) L.push(`- Densidade: ${int(s.densidade_hab_km2)} hab/km²`);
  if (int(s.nascimentos)) L.push(`- Nascimentos: ${int(s.nascimentos)} (Registro Civil/IBGE, ${s.nascimentos_ano || ''})`);
  if (int(s.empregos_saldo)) L.push(`- Saldo de emprego formal: ${int(s.empregos_saldo)} (${s.empregos_ref || ''})`);
  if (int(s.deficit_fjp)) L.push(`- Déficit habitacional OFICIAL (Fundação João Pinheiro, ${s.deficit_fjp_ano || ''}): ${int(s.deficit_fjp)} domicílios${pct(s.deficit_fjp_pct) ? ` (${pct(s.deficit_fjp_pct)} dos domicílios)` : ''}`);
  if (s.pressao_classe) {
    const rot = { demanda_reprimida: 'DEMANDA REPRIMIDA', equilibrio: 'EQUILÍBRIO', estoque_ocioso: 'ESTOQUE OCIOSO' }[s.pressao_classe] || s.pressao_classe;
    L.push(`- Leitura BidPro de pressão habitacional: ${rot}${s.pressao_nota ? ` — ${s.pressao_nota}` : ''}`);
  }
  if (!L.length) return '';
  return `
DEMOGRAFIA E PRESSÃO HABITACIONAL DE ${String(cidade || '').toUpperCase() || 'DA CIDADE'} (base própria BidPro, alimentada do IBGE — NÃO pesquise nada disso, use exatamente estes números):
${L.join('\n')}
COMO USAR ESTE BLOCO (obrigatório): dedique um parágrafo curto ao FUNDAMENTO DE DEMANDA da praça,
ligando estes números à decisão — cidade que cresce com poucos domicílios vagos sustenta preço,
dá liquidez de revenda e reduz vacância no aluguel; cidade estagnada com muito imóvel vago pede
desconto maior no lance, prazo de saída mais longo e cautela com projeção de valorização. CITE a
fonte e o ANO de cada número que usar. A "Leitura BidPro de pressão habitacional" é uma leitura
NOSSA derivada do Censo — apresente-a como tal e NUNCA a chame de déficit habitacional da FJP${int(s.deficit_fjp) ? '' : ' (o número oficial da FJP não está disponível para esta cidade)'}.
NÃO invente indicador que não esteja acima; se algo faltar, simplesmente não comente.`;
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
${mercado?.fonteEstimativa === 'base_propria' ? '\n- ORIGEM DOS COMPARÁVEIS: base própria BidPro. São anúncios REAIS do mesmo tipo já capturados nesta praça, cada um com fonte e mês de referência, e não uma pesquisa feita agora. Diga isso ao cliente com naturalidade e transparência (a base é recente e do mesmo recorte), e trate as datas dos comparáveis como o que são: o retrato do período, não do minuto.' : ''}
- Preço médio/m² (${mercado?.fonteEstimativa === 'indice_bidpro' ? 'Índice BidPro, base própria' : mercado?.fonteEstimativa === 'base_propria' ? 'mediana dos comparáveis da base própria' : 'média dos anúncios'}): R$ ${brl(mercado?.precoMedioM2)}
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
${blocoSocio(mercado?.socio, inp.cidade)}

AQUISIÇÃO E RETORNO:
- Lance SEM disputa (lance base): R$ ${brl(inp.valorArrematacao)}
${Number(inp.valorMercado) > 0
  // SEM valor de mercado NÃO existe retorno: lucro e ROI sairiam de uma venda por zero
  // (o "prejuízo integral" que reprovava imóveis bons). Nesse caso o parecer diz que a
  // referência não foi estimada, em vez de imprimir um número que não significa nada.
  ? `- Lance MÁXIMO COM disputa (preserva o piso de lucro): R$ ${brl(inp._teto)}
- Capital total aportado: R$ ${brl(m.capitalMobilizado)}
- Lucro/Economia estimada: R$ ${brl(m.lucro)}
- Retorno (ROI/ROE): ${(m.roi || 0).toFixed(2)}%`
  : `- Capital total aportado: R$ ${brl(m.capitalMobilizado)}
- ATENÇÃO: a pesquisa NÃO conseguiu estimar o valor de mercado desta unidade. NÃO calcule
  nem cite lucro, ROI, ROE ou teto de lance neste parecer, e NÃO trate a ausência de
  referência como prejuízo. Informe com transparência que a referência de mercado não foi
  estimada nesta rodada, apresente apenas os CUSTOS da operação e oriente o cliente a
  confirmar o valor de mercado antes de definir o lance.`}
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

  // EXTRATO DO EDITAL (determinístico, SEM await): praças com valores/datas, forma de
  // pagamento e avaliação lidas do DOCUMENTO do lote (pdf-parse + regex, sem IA). Roda
  // EM PARALELO com a busca de mercado (60-190s de espera de rede) e é colhido com race
  // curto antes das projeções — o mercadológico passa a usar o edital como fonte de
  // verdade da MELHOR PRAÇA e das condições de pagamento, sem alongar a geração.
  const extratoEditalP = extratoEdital(String(imovelId), { deadline: Date.now() + Math.min(60000, Math.max(15000, restante() - 90000)) }).catch(() => null);

  // METRAGEM DA MATRÍCULA (determinístico + cache, SEM IA — pedido do dono 05/08: casos
  // documentados de divergência anúncio×matrícula): roda em paralelo como o extrato do
  // edital e é colhida no bloco de área. Sem depender do laudo documental ter rodado.
  const extratoMatriculaP = extratoMatricula(String(imovelId), { deadline: Date.now() + Math.min(45000, Math.max(12000, restante() - 100000)) }).catch(() => null);

  // Triangula o imóvel-alvo (endereço+CEP+IBGE, grátis) se a coord for imprecisa — âncora do raio
  // de 250m/1km. Grava a coord melhor (durável). Time-boxed; roda ANTES da busca para o recorte por
  // raio já usar a âncora certa. Só re-geocodifica os ~27% imprecisos (os precisos passam direto).
  try {
    const anc = await ancorarImovel(String(imovelId), Date.now() + Math.min(12000, Math.max(0, restante() - 225000)));
    if (anc?.alterado) console.log('[ancora]', JSON.stringify({ imovel: String(imovelId), nivel: anc.nivel }));
  } catch { /* nunca bloqueia o relatório */ }

  // ENDEREÇO RICO PARA A BUSCA (pedido do dono: "o endereço não foi consultado na documentação/
  // descrição — impacta a precisão"). O scraper às vezes deixa `endereco` com LIXO ("praça Valor
  // inicial R$…") e o BAIRRO real fica só no TÍTULO/descrição (ex.: MEGA: "Apartamento 59 m² -
  // Vila Nossa Senhora de Fátima - Guarulhos - SP"). Aqui, no SERVIDOR, montamos o melhor endereço
  // (rua válida + bairro do título + cidade/UF) + nome do condomínio, para o Nível 1/2 da busca não
  // ficar genérico ("cidade"). Best-effort; nunca bloqueia.
  let enderecoGenerico = false; // sem rua E sem bairro conhecidos → o edital pode completar
  try {
    const [imA] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=endereco,bairro,cidade,estado,titulo,descricao,nomecondominio&limit=1`)).json();
    if (imA && mercadoInputs) {
      const lixo = /valor\s*inicial|lance\s*m[íi]nimo|avalia[çc]|r\$|^\s*\d+\s*$/i;
      const ruaOk = (e) => { const s = String(e || '').trim(); return s.length >= 6 && /[a-zà-ú]{3}/i.test(s) && !lixo.test(s); };
      const cid = imA.cidade || cidade || '';
      const est = imA.estado || estado || '';
      let bairro = String(imA.bairro || '').trim();
      if (!bairro && imA.titulo) { // extrai o bairro do título: "Tipo 00 m² - BAIRRO - Cidade - UF"
        const segs = String(imA.titulo).split(/\s+[-–—]\s+/).map(s => s.trim()).filter(Boolean);
        const ehTipoArea = (s) => /m²|m2|apartamento|casa|terreno|\blote\b|sala|loja|gal[pnã]|comercial|ch[aá]cara|s[íi]tio|fazenda|vaga|garagem|im[óo]vel|\d/i.test(s);
        const cand = segs.find(s => s && !ehTipoArea(s) && _norm(s) !== _norm(cid) && !/^[a-z]{2}$/i.test(s));
        if (cand) bairro = cand;
      }
      const rua = ruaOk(imA.endereco) ? String(imA.endereco).trim() : '';
      const partes = [rua, bairro, cid].filter(Boolean);
      if (rua || bairro) mercadoInputs.endereco = partes.join(', ') + (est ? `/${est}` : '');
      if (!mercadoInputs.nomeCondominio && imA.nomecondominio) mercadoInputs.nomeCondominio = imA.nomecondominio;
      // Ainda genérico (sem rua E sem bairro no card/título)? LÊ o edital/matrícula para achar o
      // endereço completo — o erro de não puxar o endereço estando no documento não pode repetir.
      if (!rua && !bairro) {
        enderecoGenerico = true;
        try {
          const alvo = await garantirEnderecoDoc(String(imovelId), Date.now() + Math.min(28000, Math.max(0, restante() - 210000)));
          if (alvo?.texto) {
            mercadoInputs.endereco = alvo.texto;
            if (alvo.bairro) bairro = alvo.bairro;
            enderecoGenerico = false;
            console.log('[endereco-doc]', JSON.stringify({ imovel: String(imovelId), usado: alvo.texto }));
          }
        } catch { /* leitura de documento é best-effort */ }
      }
      console.log('[endereco-busca]', JSON.stringify({ imovel: String(imovelId), rua: !!rua, bairro: bairro || null, usado: mercadoInputs.endereco }));
    }
  } catch { /* enriquecimento é best-effort */ }

  // ── LER O DOCUMENTO ANTES DE PESQUISAR (pedido do dono, 06/08) ──────────────────────────────
  // A ORDEM importa e estava invertida: a matrícula era colhida DEPOIS da busca e só corrigia o
  // R$/m² no fim — mas a pesquisa já tinha ido atrás de comparáveis do tamanho ERRADO, o do
  // anúncio. Confirmar a metragem ANTES faz a busca procurar imóveis do tamanho REAL, que é o
  // que decide a assertividade dos comparáveis. Determinístico e cache-first (regex sobre o PDF,
  // sem IA, custo zero); se o documento não abrir a tempo, segue com a área do anúncio e o bloco
  // de correção lá embaixo continua valendo como rede de segurança.
  // As DUAS leituras (matrícula e edital) já rodam em paralelo desde o início; aqui só as
  // colhemos dentro de UM limite comum — esperar as duas em sequência dobraria a espera.
  let matriculaPre = null, editalPre = null;
  const areaAnunciada = Number(mercadoInputs?.areaM2) || 0;
  const limitePre = Date.now() + Math.min(16000, Math.max(0, restante() - 210000));
  const colher = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), Math.max(0, limitePre - Date.now())))]).catch(() => null);
  try { matriculaPre = await colher(extratoMatriculaP); } catch { matriculaPre = null; }
  try { editalPre = await colher(extratoEditalP); } catch { editalPre = null; }
  if (mercadoInputs && matriculaPre) {
    const aMat = Number(matriculaPre.areaPrivativaM2) || 0;
    const aTer = Number(matriculaPre.areaTerrenoM2) || 0;
    if (aMat >= 5 && aMat <= 100000) mercadoInputs.areaM2 = aMat;
    if (aTer >= 5 && aTer <= 10000000 && !(Number(mercadoInputs.areaTerrenoM2) > 0)) mercadoInputs.areaTerrenoM2 = aTer;
    if (aMat > 0 || aTer > 0) {
      console.log('[metragem-doc]', JSON.stringify({ imovel: String(imovelId), anuncio: areaAnunciada || null, matricula: aMat || null, terreno: aTer || null, usadaNaBusca: mercadoInputs.areaM2 || null }));
    }
  }
  // IDENTIDADE lida no edital (06/08): o NOME DO CONDOMÍNIO é a âncora Nível 1 da busca
  // — comparável do MESMO empreendimento vale mais que qualquer média de bairro — e é o
  // que permite classificar tipo e PADRÃO pelo que o mercado pede naquele prédio. Quando
  // o acervo não traz o nome (a maioria dos leiloeiros não publica), o documento traz.
  // O logradouro/bairro só entram se o endereço ainda estiver genérico: a página do
  // leiloeiro continua sendo a fonte de verdade quando ela diz alguma coisa.
  if (mercadoInputs && editalPre?.identidade && editalPre.pertenceAoLote !== false) {
    const idt = editalPre.identidade;
    const usados = {};
    if (!mercadoInputs.nomeCondominio && idt.nomeCondominio) { mercadoInputs.nomeCondominio = idt.nomeCondominio; usados.condominio = idt.nomeCondominio; }
    if (enderecoGenerico && (idt.logradouro || idt.bairro)) {
      const cid = mercadoInputs.cidade || cidade || '';
      const est = mercadoInputs.estado || estado || '';
      const partes = [idt.logradouro, idt.bairro, cid].filter(Boolean);
      if (partes.length) {
        mercadoInputs.endereco = partes.join(', ') + (est ? `/${est}` : '');
        enderecoGenerico = false;
        usados.endereco = mercadoInputs.endereco;
      }
    }
    if (Object.keys(usados).length) console.log('[identidade-doc]', JSON.stringify({ imovel: String(imovelId), ...usados }));
  }

  // REGERAÇÃO NÃO PODE DESTRUIR O RELATÓRIO QUE JÁ ESTAVA PRONTO (07/08 — achado da varredura
  // de 05/08). O reset abaixo grava `result: null` no INÍCIO de toda geração. Se a regeração
  // falhar por um motivo diferente de timeout (429, 5xx, rede), o catch grava status 'erro' sem
  // restaurar nada — e o cliente que clicou "Regerar" num relatório PRONTO ficava sem nenhum
  // dos dois. Guardamos o result anterior aqui e o catch o devolve.
  let resultAnterior = null;
  try {
    const [prev] = await (await sb(`analises_mercado?user_id=eq.${ownerId}&imovel_id=eq.${encodeURIComponent(String(imovelId))}&status=eq.concluida&select=result&limit=1`)).json();
    if (prev?.result) resultAnterior = prev.result;
  } catch { /* sem anterior → nada a preservar */ }

  // Reseta a barra de evolução ao começar (não herda o progresso de uma geração anterior):
  // Etapa A (comparáveis) já entra como 'gerando'; B (contexto) e o parecer ficam 'pendente'.
  await upsertAnalise({ ...base, status: 'gerando', erro: null, result: null, progresso: {
    etapas: [
      { key: 'comparaveis', label: PROG_LABELS.comparaveis, status: 'gerando', n: null },
      { key: 'contexto', label: PROG_LABELS.contexto, status: 'pendente', n: null },
      { key: 'parecer', label: PROG_LABELS.parecer, status: 'pendente', n: null },
    ], atualizadoEm: new Date().toISOString(),
  } });

  const prazo = new Promise((_, rej) => setTimeout(() => rej(new Error('tempo_limite')), Math.max(20000, restante())));

  try {
    const { result, valorMercado, avalDb, vminImovel } = await Promise.race([prazo, (async () => {
    // BARRA DE EVOLUÇÃO — estado local das etapas; `flush()` persiste na coluna progresso a cada
    // transição (best-effort). Uma etapa concluída mostra a CONTAGEM (n) de amostras/itens dela.
    const prog = { comparaveis: { status: 'gerando', n: null }, contexto: { status: 'pendente', n: null }, parecer: { status: 'pendente', n: null } };
    const flush = () => marcarProgresso(imovelId, ownerId, [
      { key: 'comparaveis', ...prog.comparaveis }, { key: 'contexto', ...prog.contexto }, { key: 'parecer', ...prog.parecer },
    ]);
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
      // Reaproveitou pesquisa recente: as duas etapas de busca já estão "prontas" (vieram do cache).
      const nReuso = ((mercado.nivel1?.vendas?.length || 0) + (mercado.nivel1?.locacoes?.length || 0) + (mercado.nivel2?.vendas?.length || 0) + (mercado.nivel2?.locacoes?.length || 0)) || null;
      prog.comparaveis = { status: 'concluido', n: nReuso };
      prog.contexto = { status: 'concluido', n: null };
      await flush();
    } else {
      // REAPROVEITAMENTO POR REGIÃO — LIGADO POR PADRÃO (regra do dono: "todo dado deve ser
      // aproveitado, evita desperdício"; desliga só com MERCADO_CACHE=0). Se a microrregião já tem
      // amostra densa e do QUADRIMESTRE ATUAL de VENDA na base própria (indice_amostra, sem leilão),
      // injetamos esses comparáveis REAIS no prompt e reduzimos a busca web de 5 → 2 usos — a IA
      // ancora na base e só complementa lacunas (padrão/anúncio ativo). Se o dado mais recente for de
      // quadrimestre distante, amostrasRegiaoCache devolve miss → busca COMPLETA (5) = refaz/atualiza.
      // Vale igual para dono e cliente (mesmo código). Rural fica fora (régua de ha).
      const segCache = segmentoIndice(mercadoInputs.tipoImovel || imovel?.tipo);
      let cacheReg = null, imRegBase = null;   // imRegBase: a praça do alvo, reusada pelo modo base
      const cacheLigado = process.env.MERCADO_CACHE !== '0';
      if (cacheLigado && segCache !== 'rural') {
        try {
          const [imReg] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=cidade_norm,estado,bairro,latitude,longitude&limit=1`)).json();
          imRegBase = imReg || null;
          cacheReg = await amostrasRegiaoCache(imReg, segCache);
        } catch { cacheReg = null; }
      }
      // QUALIDADE em 1º lugar (decisão do dono: "a busca deve ser apurada; pode demorar mais, mas
      // tem que entregar com qualidade"). Agora em DUAS etapas com buscas SEPARADAS: a Etapa A
      // (comparáveis, essencial) leva o grosso das buscas; a Etapa B (contexto) é enxuta. Com cache
      // denso da praça, poucas buscas bastam (ancora na base própria).
      const maxWebA = cacheReg?.hit ? 2 : 6; // comparáveis (venda/locação + valor) — o essencial
      const maxWebB = cacheReg?.hit ? 1 : 3; // contexto (FipeZAP/zoneamento/perfil/segurança) — leve
      const cacheTxt = cacheReg?.hit ? cacheReg.text : '';
      // FONTES LOCAIS já conhecidas da praça (revalidação ORGÂNICA): injeta as imobiliárias locais
      // vistas recentemente para a IA ir direto COLHER (economiza a busca de descoberta). Best-effort.
      let fontesTxt = '';
      try {
        const fl = await (await sb('rpc/fontes_locais_frescas', { method: 'POST', body: JSON.stringify({ p_cidade_norm: _norm(cidade), p_uf: String(estado || '').toUpperCase() }) })).json();
        if (Array.isArray(fl) && fl.length) fontesTxt = `\n\nIMOBILIÁRIAS LOCAIS JÁ CONHECIDAS de ${cidade}/${estado} (comece por elas: abra os sites e colha anúncios do tipo-alvo; ADICIONE as novas que encontrar em "fontesLocais"):\n` + fl.map(f => `- ${f.nome || f.url} (${f.url})`).join('\n');
      } catch { /* best-effort */ }
      console.log('[mercado-cache]', JSON.stringify({ on: cacheLigado, hit: !!cacheReg?.hit, nivel: cacheReg?.nivel || null, n: cacheReg?.n || 0, maxWebA, maxWebB, imovel: String(imovelId) }));
      // Cada ETAPA é uma chamada com timeout PRÓPRIO (retries:0). UMA etapa nunca soma tempo com
      // a outra — o orçamento é fatiado. pause_turn tratado (a busca server-side pausa em pesquisas
      // longas). max_tokens 32k dá folga p/ os blocos de resultado + o JSON final (a causa do "sem
      // amostras" em cidade grande era a resposta ser cortada, não o nº de buscas). { __falhou } em
      // abort/timeout/erro → o chamador decide re-tentar ou tratar como transitório (self-heal).
      const RESERVA_PARECER = 55000; // guarda p/ o parecer + a escrita final
      const buscarEtapa = async ({ prompt, sistema, msBudget, webUses, pauseCap = 8, minReserva = RESERVA_PARECER + 12000 }) => {
        // MOTOR PRIMÁRIO: Gemini (Google Search grounding). Aceita se devolveu JSON útil (mais que
        // só __diag); se falhar/vier vazio, CAI para o Claude web_search abaixo (fallback seguro).
        if (MERCADO_MOTOR === 'gemini' && GEMINI_KEY) {
          // TETO DE BUSCAS TAMBÉM NO GEMINI (06/08). `webUses` cai de 6 para 2 quando a base
          // própria já cobre a praça — é o mecanismo que faz o relatório BARATEAR conforme a
          // base cresce. Só que ele era passado como `max_uses` do Claude e o Gemini, motor
          // PRIMÁRIO desde 30/07, nunca o via: a economia estava ligada no motor errado e o
          // custo não caía por mais densa que a base ficasse. O `google_search` do Gemini não
          // tem parâmetro de teto, então o limite vai por INSTRUÇÃO — que é onde ele funciona.
          const teto = `\n\nORÇAMENTO DE BUSCA: faça no MÁXIMO ${webUses} busca(s) na web. ${webUses <= 2
            ? 'A base própria acima já cobre esta praça: use-a como fonte principal e busque apenas para CONFIRMAR/ATUALIZAR o que estiver faltando ou desatualizado. Não refaça do zero o que já está na base.'
            : 'Priorize as buscas que trazem comparáveis do MESMO tipo e da MENOR distância.'}`;
          const g = await buscarGeminiGrounding({ prompt: prompt + teto, sistema, timeoutMs: Math.min(115000, Math.max(30000, msBudget)) });
          if (g && !g.__falhou && Object.keys(g).some((k) => k !== '__diag')) return g;
        }
        try {
          const messages = [{ role: 'user', content: prompt }];
          let data, stop, cont = 0;
          do {
            data = await anthropic({
              model: MODEL, max_tokens: 32000,
              tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: webUses }],
              system: sistema,
              messages,
            }, true, { retries: 0, timeoutMs: Math.max(30000, msBudget), noFallback: true });
            stop = data?.stop_reason;
            if (stop === 'pause_turn' && Array.isArray(data.content)) { messages.push({ role: 'assistant', content: data.content }); cont++; }
          } while (stop === 'pause_turn' && cont < pauseCap && restante() > minReserva);
          const txt = extractText(data);
          const parsed = parseJSON(txt) || {};
          // Diagnóstico PERSISTIDO (fica no result mesmo quando vazio) p/ validar o fluxo pelo banco.
          parsed.__diag = { stop: stop || null, blocos: Array.isArray(data?.content) ? data.content.length : 0, textoLen: txt.length, out_tokens: data?.usage?.output_tokens || 0, buscas: webUses, continuou: cont };
          return parsed;
        } catch (e) { return { __falhou: true, __erroApi: String(e?.message || e || '').slice(0, 120) }; }
      };

      // ── ETAPA A — COMPARÁVEIS (ESSENCIAL): venda + locação (níveis 1/2) + valor consolidado ──
      // MODO BASE primeiro: com a praça já coberta em nível fino e densidade suficiente, os
      // comparáveis saem da base própria e a busca (a etapa CARA) não roda. Ver mercadoDaBase().
      const daBase = process.env.MERCADO_MODO_BASE === '0' ? null : await mercadoDaBase(cacheReg, segCache, imRegBase);
      const sysComp = `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${mercadoInputs.tipoImovel}). Retorne apenas JSON válido.`;
      const promptA = promptComparaveis(mercadoInputs) + cacheTxt + fontesTxt;
      // 1ª busca: reserva o parecer, ~55s p/ a Etapa B (contexto) e ~35s p/ uma 2ª tentativa da A.
      let compar = daBase || await buscarEtapa({ prompt: promptA, sistema: sysComp, msBudget: Math.min(135000, restante() - RESERVA_PARECER - 90000), webUses: maxWebA });
      if (daBase) console.log('[modo-base]', JSON.stringify({ imovel: String(imovelId), ...daBase.__modoBase, tipo: segCache }));
      const semAmostrasA = (m) => (((m?.nivel1?.vendas?.length || 0) + (m?.nivel1?.locacoes?.length || 0) + (m?.nivel2?.vendas?.length || 0) + (m?.nivel2?.locacoes?.length || 0)) === 0) && !(Number(m?.consolidado?.precoMedioM2) > 0);
      // Re-tenta se (vazio OU falhou) E ainda há orçamento. Falhou → 1 busca (quase sempre conclui e
      // dá um R$/m² de referência); vazio-mas-concluiu (praça fina) → ≤3 buscas. A ampla já foi a 1ª.
      if (!daBase && (compar.__falhou || semAmostrasA(compar)) && restante() > RESERVA_PARECER + 55000) {
        const usos = compar.__falhou ? 1 : Math.min(maxWebA, 3);
        compar = await buscarEtapa({ prompt: promptA, sistema: sysComp, msBudget: Math.min(100000, restante() - RESERVA_PARECER - 30000), webUses: usos });
      }
      // Monta o `mercado` a partir da Etapa A (mesmos campos derivados de antes). Se a A FALHOU
      // (abort/timeout — não "vazio de verdade"), vira TRANSITÓRIO (__instavel): o Índice BidPro/
      // self-heal assume mais abaixo; não derruba aqui. Vazio genuíno (JSON ok, 0 anúncio) segue.
      if (compar.__falhou) {
        mercado = { vendas: [], locacoes: [], precoMedioM2: 0, pesquisaEm: new Date().toISOString(), __instavel: true, __erroApi: compar.__erroApi || '' };
        prog.comparaveis = { status: 'erro', n: 0 };
      } else {
        mercado = compar;
        mercado.precoMedioM2 = mercado.consolidado?.precoMedioM2 || mercado.nivel2?.precoMedioM2 || 0;
        mercado.aluguelMedio = mercado.consolidado?.aluguelMedio || 0;
        // ALUGUEL RECALCULADO NO SERVIDOR (07/08) — mesmo princípio da correção de Cotia: se o
        // servidor TEM as amostras, ele não reimprime o agregado que o modelo mandou.
        // Caso real (Sorocaba, `8407e489`): as 7 locações vieram PERFEITAS (R$ 950 a 2.100,
        // 42-47 m², todas em Caguassu/Jd. Carandá a menos de 1 km), mas o `consolidado` trouxe
        // `aluguelMedio: 27,62` — a mediana em R$/m²·mês, não a mediana do valor MENSAL
        // (que é R$ 1.300). O modelo carregou a unidade do bloco vizinho (`unidadeValor:
        // m2_privativo`, `baseCalculo: "R$ 3206,91/m² × 47,4 m²"`) para um campo que o resto do
        // sistema trata como TOTAL — a linha 2134 abaixo prova a semântica ao fazer
        // `aluguelMedio = aluguelM2 × área`. Sem esta trava o estrago é em cascata: card com
        // "R$ 27,62/mês", yield contaminado, e `valorLocacao` do parecer virando R$ 28 de renda
        // mensal (Analise.jsx:814 arredonda o aluguelMedio para o formulário).
        // A regra é a MESMA que o prompt já pede — mediana do `valorMensal` — só que executada
        // de forma determinística, com o mínimo de 3 amostras que o dono definiu.
        {
          const locs = [...(mercado.nivel1?.locacoes || []), ...(mercado.nivel2?.locacoes || []), ...(Array.isArray(mercado.locacoes) ? mercado.locacoes : [])];
          const mensais = locs.map(l => Number(l?.valorMensal) || 0).filter(v => v > 0).sort((a, b) => a - b);
          if (mensais.length >= 3) {
            const mediana = mensais.length % 2
              ? mensais[(mensais.length - 1) / 2]
              : Math.round((mensais[mensais.length / 2 - 1] + mensais[mensais.length / 2]) / 2);
            const doModelo = Number(mercado.aluguelMedio) || 0;
            // Só sobrescreve quando o modelo DIVERGE do que as amostras dizem (>5%), para não
            // mexer no caso em que ele acertou. A divergência típica aqui é de ordem de grandeza.
            if (Math.abs(mediana - doModelo) / mediana > 0.05) {
              mercado.__diagAluguel = { doModelo, recalculado: mediana, nAmostras: mensais.length, motivo: 'mediana do valorMensal das locações' };
              mercado.aluguelMedio = mediana;
              if (mercado.consolidado) mercado.consolidado.aluguelMedio = mediana;
              // O yield foi derivado do aluguel ERRADO, então corrigir só o aluguel deixaria a
              // rentabilidade mentindo do lado do número certo. Fórmula ANUAL, a mesma da linha
              // ~787: aluguel × 12 / valor × 100. No caso de Sorocaba, 0,0103 vira ~10,3% a.a.
              const valImovel = Number(mercado.consolidado?.valorEstimadoImovel) || 0;
              if (valImovel > 0) {
                const yBruto = Number(((mediana * 12 / valImovel) * 100).toFixed(2));
                mercado.__diagAluguel.yieldAntes = Number(mercado.consolidado?.yieldBruto) || 0;
                mercado.__diagAluguel.yieldDepois = yBruto;
                if (mercado.consolidado) mercado.consolidado.yieldBruto = yBruto;
              }
            }
          }
        }
        mercado.yieldBruto = mercado.consolidado?.yieldBruto || 0;
        mercado.yieldLiquido = mercado.consolidado?.yieldLiquido || 0;
        // O PDF lista TODAS as amostras (nível 1 = mesmo condomínio é a mais relevante;
        // antes só o nível 2 entrava e um lote com amostras só de condomínio saía sem nenhuma).
        mercado.vendas = [...(mercado.nivel1?.vendas || []), ...(mercado.nivel2?.vendas || [])];
        mercado.locacoes = [...(mercado.nivel1?.locacoes || []), ...(mercado.nivel2?.locacoes || [])];
        // Agregados por nível SEMPRE consistentes com as listas: o repair de JSON truncado
        // preserva os arrays e perde os agregados (que vêm depois) → a tela mostrava
        // "0 amostras · Mín/Médio/Máx R$ 0" ao lado de uma lista cheia. Recalcula no servidor.
        for (const nv of [mercado.nivel1, mercado.nivel2].filter(Boolean)) {
          const vs = (nv.vendas || []).map(v => Number(v.valorM2 ?? v.valor_m2)).filter(x => x > 0).sort((a, b) => a - b);
          nv.totalAmostras = Math.max(Number(nv.totalAmostras) || 0, (nv.vendas?.length || 0) + (nv.locacoes?.length || 0));
          if (vs.length) {
            if (!(Number(nv.precoMedioM2) > 0)) nv.precoMedioM2 = Math.round(vs.reduce((s, x) => s + x, 0) / vs.length);
            if (!(Number(nv.precoMinM2) > 0)) nv.precoMinM2 = Math.round(vs[0]);
            if (!(Number(nv.precoMaxM2) > 0)) nv.precoMaxM2 = Math.round(vs[vs.length - 1]);
          }
        }
        mercado.totalAmostrasVenda = mercado.vendas.length; // o PDF imprime esta contagem (era undefined)
        mercado.pesquisaEm = new Date().toISOString();
        const nA = (mercado.nivel1?.vendas?.length || 0) + (mercado.nivel1?.locacoes?.length || 0) + (mercado.nivel2?.vendas?.length || 0) + (mercado.nivel2?.locacoes?.length || 0);
        prog.comparaveis = { status: 'concluido', n: nA };
      }
      prog.contexto = { status: mercado.__instavel ? 'pulado' : 'gerando', n: null };
      await flush();

      // ── ETAPA B — CONTEXTO (BEST-EFFORT): FipeZAP, zoneamento, perfil, segurança, tipologias ──
      // Só roda se a A NÃO falhou (se falhou, vamos ao Índice/transitório — o contexto seria inútil)
      // E se ainda há orçamento além do parecer. Timeout e buscas PRÓPRIOS e curtos: se falhar/
      // estourar, o relatório entrega assim mesmo com os comparáveis da Etapa A (nunca mais esvazia).
      if (!mercado.__instavel && restante() > RESERVA_PARECER + 30000) {
        const ctx = await buscarEtapa({
          prompt: promptContexto(mercadoInputs),
          sistema: 'Você é um perito avaliador imobiliário. Traga referências e contexto da região SÓ de fontes confiáveis; nunca invente (sem base, "encontrado": false). Retorne apenas JSON válido.',
          msBudget: Math.min(55000, restante() - RESERVA_PARECER - 8000), webUses: maxWebB, pauseCap: 4, minReserva: RESERVA_PARECER + 8000,
        });
        if (ctx && !ctx.__falhou) {
          for (const k of ['referenciaFipeZap', 'zoneamento', 'perfilRegiao', 'segurancaPublica', 'outrasTipologias', 'outrosBairros']) {
            if (ctx[k] != null) mercado[k] = ctx[k];
          }
          mercado.__diagContexto = ctx.__diag || null;
          const nB = (mercado.outrosBairros?.length || 0) + Object.values(mercado.outrasTipologias || {}).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
          prog.contexto = { status: 'concluido', n: nB };
        } else {
          mercado.__diagContexto = { falhou: true, erro: ctx?.__erroApi || 'sem_resposta' };
          prog.contexto = { status: 'erro', n: null }; // best-effort: NÃO derruba o relatório
        }
      } else if (!mercado.__instavel) {
        prog.contexto = { status: 'pulado', n: null }; // sem orçamento p/ o contexto
      }
      await flush();
    }
    // Parecer entra em geração (a barra sinaliza a última etapa). Best-effort.
    prog.parecer = { status: 'gerando', n: null };
    await flush();
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
      [imDb] = await (await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}&select=fonte,valor_avaliacao,valor_minimo,valor_minimo_2,data_leilao,data_leilao_2,area_m2,ficha_juridica,cidade_norm,estado,bairro,latitude,longitude&limit=1`)).json();
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
      // ÁREA DO ACERVO como fallback — mesma família do bug de Cotia: o servidor JÁ LIA
      // `area_m2` aqui (está no select acima) e mandava imprimir o 0 que veio do cliente.
      // Sem área, `valorMercado = precoM2 × área × 0,9` não computa e o relatório sai sem
      // referência — a ausência que produziu os ROIs impossíveis. Confirmado no banco em
      // 07/08: 4 mercadológicos concluíram sem valor de mercado APESAR de a pesquisa ter
      // achado preço/m², e em 2 deles o acervo tinha a área. Ordem: matrícula > acervo >
      // cliente — a matrícula continua vencendo logo abaixo e no bloco de divergência.
      // `areaFonte` sai no relatório (result.mercado.area.fonte), então 'acervo' é
      // declarado ao cliente como o que é: a área do anúncio do leiloeiro, a confirmar
      // na matrícula — nunca um número mudo passando por medição própria.
      const aAcervo = Number(imDb?.area_m2) || 0;
      if (areaM2 <= 0 && aAcervo >= 5 && aAcervo <= 100000) { areaM2 = aAcervo; areaFonte = 'acervo'; }
      const aDoc = Number(imDb?.ficha_juridica?.areaPrivativaM2) || 0;
      if (aDoc >= 5 && aDoc <= 100000) { areaM2 = aDoc; areaFonte = 'matricula'; } // autoritativa
    } catch { /* segue com a área informada */ }

    // ── METRAGEM DA MATRÍCULA sem depender do documental (05/08) ────────────────
    // O documental (ficha_juridica) só existe se o cliente já gerou aquele relatório.
    // Aqui colhemos a leitura DETERMINÍSTICA disparada no início (cache-first, custo
    // zero): se a matrícula declara a área privativa, ela PREVALECE sobre a do anúncio
    // — os casos documentados de divergência mostram que o site erra (traz total/
    // terreno) e o R$/m² sai inflado. Divergência > 10% vira aviso EXPLÍCITO no
    // relatório: o cliente precisa saber que o anúncio e a matrícula discordam.
    let divergenciaArea = null;
    if (areaFonte !== 'matricula') {
      // Reusa o que já foi colhido ANTES da busca; só corre atrás de novo se lá não deu tempo.
      let mat = matriculaPre;
      if (!mat) { try { mat = await Promise.race([extratoMatriculaP, new Promise(r => setTimeout(() => r(null), 2500))]); } catch { /* best-effort */ } }
      const aMat = Number(mat?.areaPrivativaM2) || 0;
      if (aMat >= 5 && aMat <= 100000) {
        // A referência da divergência é a área ANUNCIADA, capturada antes de a matrícula
        // sobrescrever o input da busca — senão a comparação seria matrícula×matrícula e o
        // aviso ao cliente nunca dispararia.
        const aAnuncio = areaAnunciada > 0 ? areaAnunciada : (Number(areaM2) || 0);
        if (aAnuncio > 0 && Math.abs(aMat - aAnuncio) / aAnuncio > 0.10) {
          divergenciaArea = {
            anuncio: aAnuncio, matricula: aMat,
            diferencaPct: Math.round(((aMat - aAnuncio) / aAnuncio) * 100),
            fonte: mat.fonteUrl || null,
          };
          try { await registrarAnomalia('area_divergente', fonteDb, imovelId, 'area_m2',
            `Área do anúncio ${aAnuncio} m² vs matrícula ${aMat} m² (${divergenciaArea.diferencaPct > 0 ? '+' : ''}${divergenciaArea.diferencaPct}%) — o relatório usou a da MATRÍCULA.`); } catch { /* best-effort */ }
        }
        areaM2 = aMat; areaFonte = 'matricula';
        // Persiste o nº da matrícula quando o acervo ainda não tem (grátis, durável).
        if (mat.numeroMatricula && !imDb?.numero_matricula) {
          try { await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ numero_matricula: String(mat.numeroMatricula).slice(0, 40) }) }); } catch { /* best-effort */ }
        }
      }
    }

    // ── CONDIÇÕES DO EDITAL (colhe o extrato disparado lá no início; a busca de mercado
    // já deu o tempo de sobra — se ainda não terminou em 3s, segue sem ele). Divergente
    // (edital de OUTRO lote anexado por engano) → descarta + anomalia; nunca "confirma"
    // no relatório um documento que não bate com o lote.
    let extratoDoc = editalPre; // já colhido antes da busca (identidade); não relê
    try { if (!extratoDoc) extratoDoc = await Promise.race([extratoEditalP, new Promise(r => setTimeout(() => r(null), 3000))]); } catch { /* best-effort */ }
    if (extratoDoc && extratoDoc.pertenceAoLote === false) {
      try { await registrarAnomalia('edital_divergente', fonteDb, imovelId, 'anexos', `Edital lido (${extratoDoc.fonteUrl || '?'}) diverge dos valores do lote — extrato descartado no mercadológico.`); } catch { /* log best-effort */ }
      extratoDoc = null;
    }
    if (extratoDoc) {
      // Avaliação do edital cobre a lacuna do card (com as MESMAS travas de sanidade do
      // garantirValores) e é persistida — o acervo inteiro se beneficia, não só o relatório.
      const aEd = Number(extratoDoc.avaliacao) || 0;
      const vmDb = Number(imDb?.valor_minimo) || 0;
      if (!(avalDb > 0) && aEd > 0 && (vmDb <= 0 || (aEd > vmDb && aEd <= vmDb * 10))) {
        avalDb = aEd;
        try {
          await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
            valor_avaliacao: aEd,
            ...(vmDb > 0 && aEd >= vmDb ? { desconto_percentual: Math.round((1 - vmDb / aEd) * 100), viavel: (1 - vmDb / aEd) >= 0.3, score_viabilidade: Math.min(100, Math.round((1 - vmDb / aEd) * 150)) } : {}),
          }) });
        } catch { /* patch best-effort */ }
      }
      // Praças do edital completam as colunas VAZIAS (nunca sobrescrevem o scraper): a
      // escolha da praça de referência abaixo passa a enxergar a 2ª praça/datas reais.
      const p1 = extratoDoc.pracas.find(p => p.n === 1);
      const p2 = extratoDoc.pracas.find(p => p.n === 2);
      if (imDb) {
        const patchPr = {};
        if (!(Number(imDb.valor_minimo_2) > 0) && p2?.valor > 0 && p2.valor !== (Number(imDb.valor_minimo) || 0)) {
          imDb.valor_minimo_2 = p2.valor; patchPr.valor_minimo_2 = p2.valor;
        }
        // A DATA da 2ª praça é o PRAZO PARA DAR LANCE (vira `data_fim`) e NÃO pode ficar
        // dependendo do VALOR: quando o lance da 2ª praça já estava preenchido — ou quando o
        // edital só publica a data —, o prazo real nunca era gravado. Mesmo defeito que
        // escondia a 2ª data na tela em 02/08, aqui no lado da escrita.
        if (p2?.data && !imDb.data_leilao_2) { imDb.data_leilao_2 = p2.data; patchPr.data_leilao_2 = p2.data; }
        if (p1?.data && !imDb.data_leilao) { imDb.data_leilao = p1.data; patchPr.data_leilao = p1.data; }
        // Edital sem praça DATADA (ou sem praça nenhuma — alienação/venda por proposta): usa as
        // datas ancoradas do texto. Cobre o lote cujo LEILOEIRO não publica data na página, mas
        // o edital publica (achado do dono em 03/08). Só preenche COLUNA VAZIA: a página do
        // leiloeiro continua sendo a fonte de verdade quando ela diz alguma coisa.
        const dEd = extratoDoc.datas;
        if (dEd) {
          if (!imDb.data_leilao && dEd.inicio) { imDb.data_leilao = dEd.inicio; patchPr.data_leilao = dEd.inicio; }
          if (!imDb.data_leilao_2 && dEd.fim) { imDb.data_leilao_2 = dEd.fim; patchPr.data_leilao_2 = dEd.fim; }
        }
        if (Object.keys(patchPr).length) {
          try { await sb(`imoveis_leilao?id=eq.${encodeURIComponent(String(imovelId))}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patchPr) }); } catch { /* best-effort */ }
        }
      }
      // Vai no result (dentro de mercado): o front/PDF mostram e o parecer cita.
      mercado.condicoesEdital = {
        pracas: extratoDoc.pracas,
        datas: extratoDoc.datas || null,
        formaPagamento: extratoDoc.formaPagamento || null,
        avaliacao: aEd || null,
        fonte: extratoDoc.fonteUrl || null,
        // REGRAS ESTRUTURADAS p/ projeção de fluxo de caixa (05/08): à vista?, parcelas,
        // sinal/caução, comissão do leiloeiro, prazo de pagamento, financiável/FGTS.
        regrasPagamento: extratoDoc.pagamento || null,
        // CUSTOS DECLARADOS (06/08): taxa administrativa, IPTU e condomínio — carrego e
        // débito separados. O front aplica na projeção (campos da viabilidade) e o parecer
        // cita como número do DOCUMENTO, não premissa.
        custos: extratoDoc.custos || null,
        identidade: extratoDoc.identidade || null,
      };
      // O AGENTE APRENDE: cada leitura bem-sucedida vota no padrão do leiloeiro ×
      // modalidade. Só de documento que PERTENCE ao lote (extratos divergentes já
      // foram descartados acima) — o consenso não pode ser envenenado por edital alheio.
      if (extratoDoc.pagamento && !extratoDoc.deCache) {
        try { await pagamentoAprender(fonteDb, String(imDb?.modalidade || ''), extratoDoc.pagamento); } catch { /* best-effort */ }
      }
    }
    // EDITAL NÃO LIDO (escaneado/judicial/sem PDF): herda o CONSENSO aprendido do
    // leiloeiro × modalidade, sempre rotulado como estimativa com a base declarada —
    // o cliente vê "padrão deste leiloeiro (N editais lidos)", nunca um número órfão.
    if (!mercado.condicoesEdital?.regrasPagamento && fonteDb) {
      try {
        const prior = await pagamentoPrior(fonteDb, String(imDb?.modalidade || ''));
        if (prior) {
          const { amostras, ...regras } = prior;
          mercado.condicoesEdital = {
            ...(mercado.condicoesEdital || {}),
            regrasPagamento: regras,
            regrasOrigem: 'padrao_leiloeiro',
            regrasAmostras: amostras,
          };
        }
      } catch { /* best-effort */ }
    }
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
    // MODO BASE + TERRENO: sem a IA, não há `valorEstimadoImovel`, e o fallback acima cobre só
    // as bases por m² construído — um terreno sairia SEM valor de mercado. Aqui a conta é a
    // mesma, com a régua do tipo: R$/m² de TERRENO da base × área de terreno (da matrícula
    // quando ela foi lida). É determinística, que é justamente o ponto do modo base.
    else if (mercado?.__modoBase && baseTipo === 'terreno' && precoM2 > 0) {
      const aT = Number(mercadoInputs.areaTerrenoM2) || Number(areaM2) || 0;
      if (aT > 0) {
        valorMercado = Math.round(precoM2 * aT * 0.9);
        mercado.consolidado = { ...(mercado.consolidado || {}), valorEstimadoImovel: valorMercado, areaConsiderada: aT,
          baseCalculo: `R$ ${Math.round(precoM2).toLocaleString('pt-BR')}/m² de terreno (mediana da base própria) × ${Math.round(aT).toLocaleString('pt-BR')} m², com margem conservadora de 10% para revenda` };
      }
    }
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
    // Demografia: dispara JUNTO com as leituras do Índice (não em série) e é colhida logo
    // abaixo. Vale para TODO tipo de imóvel — inclusive rural —, por isso fica fora do bloco
    // que só trata do índice por m².
    const pSocio = lerSocioRegiao(imDb);
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
      // NO MODO BASE, NÃO regrava: os comparáveis VIERAM da base. Reinserir faria a base
      // crescer de si mesma — a mesma amostra contada várias vezes inflaria a densidade e a
      // praça nunca mais sairia do modo base, congelando um retrato antigo como se fosse
      // evidência nova. É a diferença entre reaproveitar e se auto-alimentar.
      if (!mercado.__modoBase) await gravarAmostrasIndice(imDb, mercado, imovelId, segIdx);
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
    mercado.socio = await pSocio;

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

    // PRAÇA DE REFERÊNCIA (regra do dono: "no relatório deve fazer em relação à praça MAIS
    // DESCONTADA as projeções"). O imóvel pode ter 1ª e 2ª praça (valor_minimo/data_leilao e
    // valor_minimo_2/data_leilao_2). Escolhemos o MENOR lance entre as praças cuja DATA ainda
    // esteja no FUTURO (uma praça já encerrada não vale como oportunidade); se nenhuma tiver
    // data futura conhecida, cai no menor lance disponível; por fim, no valor_minimo. Robusto a
    // qual coluna guarda a 1ª/2ª (fontes divergem): decide pelo valor, não pela posição.
    const escolherPraca = () => {
      const agora = new Date().toISOString().slice(0, 10);
      const futuraOuSemData = (d) => !d || String(d).slice(0, 10) >= agora;
      const cand = [
        { valor: Number(imDb?.valor_minimo) || 0, data: imDb?.data_leilao || null },
        { valor: Number(imDb?.valor_minimo_2) || 0, data: imDb?.data_leilao_2 || null },
      ].filter(p => p.valor > 0);
      if (!cand.length) return { valor: 0, data: null, qual: 'nenhuma' };
      const futuras = cand.filter(p => futuraOuSemData(p.data));
      const pool = futuras.length ? futuras : cand; // sem futura conhecida → considera todas
      const melhor = pool.reduce((a, b) => (b.valor < a.valor ? b : a));
      const temDuas = cand.length === 2 && cand[0].valor !== cand[1].valor;
      const ehMaisDescontada = temDuas && melhor.valor === Math.min(cand[0].valor, cand[1].valor);
      return { valor: melhor.valor, data: melhor.data, qual: temDuas ? (ehMaisDescontada ? '2a_praca' : '1a_praca') : 'unica', temDuas };
    };
    const pracaRef = escolherPraca();
    mercado.pracaReferencia = pracaRef; // consta no relatório (qual praça sustentou as projeções)
    // CLASSIFICAÇÃO DE INTENÇÃO (revenda/locação/temporada) — consta no relatório e vira defesa no
    // parecer. Desconto pela avaliação confirmada (avalDb) × lance da PRAÇA MAIS DESCONTADA (futura).
    const vminImovel = pracaRef.valor || Number(imDb?.valor_minimo) || 0;
    const descontoImovel = (avalDb > 0 && vminImovel > 0 && avalDb >= vminImovel) ? (1 - vminImovel / avalDb) * 100 : 0;
    const yieldParaCls = Number(mercado.yieldBruto) > 0 ? Number(mercado.yieldBruto)
      : (Number(mercado.indiceBidPro?.aluguel_m2) > 0 && Number(mercado.indiceBidPro?.venda_m2) > 0
        ? Number(mercado.indiceBidPro.aluguel_m2) * 12 / Number(mercado.indiceBidPro.venda_m2) * 100 : 0);
    mercado.classificacaoIntencao = classificarIntencao({ baseTipo, desconto: descontoImovel, yieldBruto: yieldParaCls, cidadeNorm: imDb?.cidade_norm, turismoSazonal: mercado.perfilRegiao?.turismoSazonal });

    // 2) Laudo (parecer). Carrega os docs do lote para o parecer poder dizer se os
    // débitos informados já constam na documentação (ou apontar onde buscar).
    let parecer = '';
    // DIAGNÓSTICO DO PARECER (persiste no result para diagnóstico pelo banco): a CAUSA-RAIZ do
    // "relatório concluído mas em branco" era o erro da REDAÇÃO do parecer ser ENGOLIDO no catch
    // vazio (erro de API silenciado) → parecer '' sem pista do motivo, e o self-heal do cron
    // re-tentava contra o MESMO bug, queimando as tentativas sem nunca preencher. Agora: (a)
    // registramos POR QUE o parecer saiu vazio (sem inputs / sem orçamento / erro de API), e
    // (b) RE-TENTAMOS a redação, já que a busca de mercado (a etapa CARA) já foi paga — não
    // desperdiça o custo por causa de um 429/overloaded transitório.
    const parecerDiag = { tinhaInputs: !!parecerInputs?.d, restanteInicio: Math.round(restante()), tentativas: 0 };
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
        // ALUGUEL: mesma correção do valorMercado, um campo ao lado. A tela manda
        // `valorLocacao` do formulário — que é 0 enquanto a pesquisa não rodou — e o servidor
        // nunca aplicava o `aluguelMedio` que ACABOU de descobrir. Medição em 07/08: 43 dos
        // 55 relatórios com inputs gravados tinham locação 0 no cliente com aluguel real
        // encontrado pela busca (Cotia: R$ 4.771/mês) → TODO parecer imprimia yield 0,00%,
        // como se o imóvel não rendesse nada.
        const aluguelServidor = Number(mercado?.aluguelMedio) || 0;
        const locacaoCliente = Number(parecerInputs.d?.valorLocacao) || 0;
        const pInp = {
          ...parecerInputs.d,
          valorMercado: valorMercado || parecerInputs.d.valorMercado,
          valorLocacao: locacaoCliente > 0 ? locacaoCliente : aluguelServidor,
          _cenario: parecerInputs.cenario, _teto: parecerInputs.teto, _perfil: perfilInvestidor,
        };
        // ── MÉTRICAS RECALCULADAS NO SERVIDOR (07/08) ────────────────────────────────
        // As métricas de viabilidade (capital, lucro, ROI, teto de lance) chegavam PRONTAS
        // do cliente: a tela as calcula no clique, ANTES da pesquisa de mercado existir.
        // Quando o imóvel ainda não tinha valor de mercado preenchido, o cliente calculava
        // com valorMercado = 0 e mandava o resultado disso — o servidor corrigia só o
        // `valorMercado` do pInp e imprimia as métricas velhas no parecer. Caso real (Cotia,
        // 07/08): mercado R$ 895.000 contra praça de R$ 500.929 (44% de desconto), mas o
        // parecer saiu com capital R$ 169.407, prejuízo de R$ 629.427 e ROI −371,55% —
        // números de um imóvel que valeria zero. O LAUDO leu o parecer e REPROVOU, com
        // razão; o terceiro relatório era o mensageiro, não o bug. Agora o servidor
        // recalcula com o valor que ele mesmo descobriu, usando a MESMA função pura da
        // tela, para que parecer, laudo e tela falem do mesmo imóvel.
        const isAVistaParecer = parecerInputs.cenario === 'À Vista' || !!pInp.somenteAVista;
        let metricasParecer = parecerInputs.metricas || {};
        const vmCliente = Number(parecerInputs.d?.valorMercado) || 0;
        const vmServidor = Number(pInp.valorMercado) || 0;
        // Recalcula quando o cliente não tinha valor de mercado, quando o servidor achou
        // outro (>2% de diferença), quando o aluguel entrou só agora (yield estava 0) ou
        // quando as métricas vieram vazias/zeradas.
        const aluguelEntrouAgora = locacaoCliente <= 0 && aluguelServidor > 0;
        const precisaRecalcular = (vmServidor > 0 || aluguelEntrouAgora)
          && (vmCliente <= 0
            || aluguelEntrouAgora
            || (vmServidor > 0 && Math.abs(vmServidor - vmCliente) / vmServidor > 0.02)
            || !(Number(metricasParecer.capitalMobilizado) > 0));
        if (precisaRecalcular) {
          try {
            const antesRoi = Number(metricasParecer.roi) || 0;
            metricasParecer = calcularMetricasCenario(pInp, Number(pInp.valorArrematacao) || 0, isAVistaParecer);
            // Mesma meta da tela: uso próprio não persegue retorno, investimento mira 30%.
            const metaRetorno = pInp.objetivoCompra === 'uso_proprio' ? 0 : 30;
            pInp._teto = calcularTetoLance(pInp, isAVistaParecer, metaRetorno, vmServidor);
            parecerDiag.metricasRecalculadas = {
              vmCliente, vmServidor, cenario: isAVistaParecer ? 'aVista' : 'alavancado',
              locacaoCliente, locacaoUsada: Number(pInp.valorLocacao) || 0,
              roiAntes: Math.round(antesRoi * 100) / 100,
              roiDepois: Math.round((Number(metricasParecer.roi) || 0) * 100) / 100,
              yieldAntes: Math.round((Number(parecerInputs.metricas?.yieldAnual) || 0) * 100) / 100,
              yieldDepois: Math.round((Number(metricasParecer.yieldAnual) || 0) * 100) / 100,
              tetoAntes: Math.round(Number(parecerInputs.teto) || 0),
              tetoDepois: Math.round(Number(pInp._teto) || 0),
            };
          } catch (e) {
            // Falhou o recálculo: segue com o que veio do cliente (parecer imperfeito é
            // melhor que geração perdida), mas fica registrado no diagnóstico.
            metricasParecer = parecerInputs.metricas || {};
            parecerDiag.metricasErro = String(e?.message || e || '').slice(0, 160);
          }
        }
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
        const sysParecer = 'Você é gestor sênior da BidPro Brasil. Redija um parecer MERCADOLÓGICO e de VIABILIDADE FINANCEIRA. Não faça análise jurídica (CNJ, gravames, diligências) — isso é de outros relatórios. EXCEÇÃO: os débitos/encargos informados que serão assumidos DEVEM constar (são custo da operação), com a indicação de onde confirmá-los. Preciso e persuasivo. Nunca use markdown nem asteriscos. Nunca use travessão (o caractere "—"); escreva com vírgula, ponto ou dois-pontos. Apenas texto simples.' + aprendizadoMercado;
        let conteudoParecer = promptParecer(pInp, metricasParecer, mercado, docs);
        // Condições LIDAS no edital (extrato determinístico): o parecer cenariza pela
        // praça real (valores/datas) e cita o pagamento do DOCUMENTO, não suposição.
        if (mercado.condicoesEdital) {
          const ce = mercado.condicoesEdital;
          const linhas = (ce.pracas || []).filter(p => p.valor > 0 || p.data)
            .map(p => `${p.n}ª praça: ${p.valor > 0 ? `R$ ${Math.round(p.valor).toLocaleString('pt-BR')}` : 'valor não localizado'}${p.data ? ` em ${String(p.data).split('-').reverse().join('/')}` : ''}`);
          conteudoParecer += `\n\nCONDIÇÕES LIDAS NO EDITAL DO LOTE (fonte de verdade; use nos cenários de lance e indique a melhor entrada):\n${linhas.join(' · ') || 'praças não localizadas'}${ce.formaPagamento ? `\nPagamento segundo o edital: ${ce.formaPagamento}` : ''}${ce.avaliacao ? `\nAvaliação no edital: R$ ${Math.round(ce.avaliacao).toLocaleString('pt-BR')}` : ''}`;
          // CUSTOS DECLARADOS NO DOCUMENTO × os que sustentaram as projeções (06/08). A
          // comissão do leiloeiro MUDA de edital para edital e a taxa administrativa às
          // vezes nem é mencionada na página do lote: quando o documento diz um número
          // diferente do projetado, o parecer avisa e recalcula o efeito, em vez de
          // apresentar uma viabilidade construída sobre premissa vencida.
          const cst = ce.custos || {};
          const comissaoEd = Number(ce.regrasPagamento?.comissaoPct) || 0;
          const brlN = (v) => Math.round(Number(v)).toLocaleString('pt-BR');
          const cl = [];
          if (comissaoEd > 0) cl.push(`Comissão do leiloeiro no edital: ${String(comissaoEd).replace('.', ',')}%${Number(pInp.taxaLeiloeiroPercentual) >= 0 ? ` (a projeção usou ${String(Number(pInp.taxaLeiloeiroPercentual) || 0).replace('.', ',')}%)` : ''}`);
          if (Number(cst.taxaAdmPct) > 0) cl.push(`Taxa administrativa: ${String(cst.taxaAdmPct).replace('.', ',')}% sobre a arrematação (a projeção usou ${String(Number(pInp.taxaAdministrativaPercentual) || 0).replace('.', ',')}%)`);
          if (Number(cst.despesasAdm) > 0) cl.push(`Despesas administrativas fixas: R$ ${brlN(cst.despesasAdm)}`);
          if (Number(cst.iptuMensal) > 0) cl.push(`IPTU informado: R$ ${brlN(cst.iptuMensal)}/mês`);
          else if (Number(cst.iptuAnual) > 0) cl.push(`IPTU informado: R$ ${brlN(cst.iptuAnual)}/ano (equivale a R$ ${brlN(cst.iptuAnual / 12)}/mês de carrego)`);
          if (Number(cst.condominioMensal) > 0) cl.push(`Condomínio informado: R$ ${brlN(cst.condominioMensal)}/mês`);
          if (Number(cst.iptuDebito) > 0) cl.push(`DÉBITO de IPTU em aberto: R$ ${brlN(cst.iptuDebito)} (verifique no edital de quem é a responsabilidade após a arrematação)`);
          if (Number(cst.condominioDebito) > 0) cl.push(`DÉBITO de condomínio em aberto: R$ ${brlN(cst.condominioDebito)} (débito propter rem — confirme no edital quem assume)`);
          if (cl.length) {
            conteudoParecer += `\n\nCUSTOS E ENCARGOS DECLARADOS NO DOCUMENTO DO LOTE (lidos automaticamente do edital, use estes números em vez de qualquer premissa):\n${cl.map(x => '- ' + x).join('\n')}
COMO USAR (obrigatório): dedique um parágrafo aos CUSTOS DA OPERAÇÃO segundo o documento. Se algum número do edital DIVERGIR do que sustentou as projeções acima, diga isso EXPLICITAMENTE ao cliente, estime o impacto no capital aportado e no retorno, e oriente a refazer a conta com o número do edital. Os DÉBITOS em aberto (IPTU/condomínio) NÃO são carrego mensal: são valores a assumir na aquisição, e a responsabilidade depende de cláusula do edital, portanto trate-os como tal e mande confirmar. Não invente valor que não esteja nesta lista.`;
          }
        }
        // RE-TENTA a redação: até 2 tentativas enquanto houver orçamento. Um 429/overloaded/timeout
        // do Anthropic (retries:0) não pode mais deixar o parecer vazio de forma definitiva. A causa
        // da última falha fica em parecerDiag.erro (não é mais engolida).
        for (let tent = 1; tent <= 2 && !parecer && restante() > 18000; tent++) {
          parecerDiag.tentativas = tent;
          try {
            const pData = await anthropic({
              model: MODEL, max_tokens: 8000,
              system: sysParecer,
              messages: [{ role: 'user', content: conteudoParecer }],
            // Teto 150s (era 60s): a redação pode ter até 8k tokens — em API lenta estourava os 60s
            // e AMBAS as tentativas morriam em 'aborted' com minutos de orçamento sobrando (3 casos
            // reais em 30/07, restanteInicio 240–281s). O guard restante()-12s preserva a escrita.
            }, false, { retries: 0, timeoutMs: Math.min(150000, restante() - 12000), noFallback: true });
            parecer = extractText(pData);
            parecerDiag.len = parecer.length;
            if (!parecer) parecerDiag.erro = 'resposta_sem_texto';
          } catch (e) {
            parecerDiag.erro = String(e?.message || e || '').slice(0, 160);
            console.error(`[parecer] falha na redação (tentativa ${tent}) imovel ${imovelId}:`, parecerDiag.erro);
          }
        }
      } catch (e) { parecerDiag.erroSetup = String(e?.message || e || '').slice(0, 160); }
    } else {
      parecerDiag.erro = !parecerInputs?.d ? 'sem_parecerInputs' : 'sem_orcamento';
    }
    // Anexa o diagnóstico ao mercado (vai dentro do result salvo) — torna trivial diagnosticar
    // pelo banco por que um parecer específico saiu vazio, sem depender de logs da Vercel.
    if (mercado && typeof mercado === 'object') mercado.__diagParecer = parecerDiag;
    // Fecha a barra de evolução: parecer concluído (ou erro/pulado). O status 'concluida' logo
    // abaixo é o sinal final p/ o front; esta marca deixa a última etapa cheia por um instante.
    prog.parecer = { status: (parecer && parecer.trim()) ? 'concluido' : (parecerInputs?.d ? 'erro' : 'pulado'), n: null };
    await flush();

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
      // valorAvaliacao: fecha o loop servidor→tela — o valor confirmado no edital (garantir
      // Valores/extrato) chegava ao BANCO mas nunca voltava ao card já aberto ("Não informada").
      // ── NOTA METODOLÓGICA (pedido do dono, 06/08) ───────────────────────────────────────
      // "Como funciona em apresentações: letras pequenas no rodapé dizendo a metodologia de
      //  pesquisa e de análise realizada, para resguardo das informações em cima de um parecer."
      //
      // Fatos ESTRUTURADOS desta geração — não texto genérico. A frase é montada na tela a
      // partir daqui, então o rodapé descreve o que ESTE relatório de fato fez: se pesquisou ou
      // leu da base, quantas amostras, de que período, que documento foi lido, qual área
      // prevaleceu. Um rodapé padrão que diz sempre a mesma coisa não resguarda nada; o que
      // resguarda é ele bater com o relatório acima dele.
      const nVend = (mercado.nivel1?.vendas?.length || 0) + (mercado.nivel2?.vendas?.length || 0);
      const nLoc = (mercado.nivel1?.locacoes?.length || 0) + (mercado.nivel2?.locacoes?.length || 0);
      const datasAmostra = [...(mercado.nivel1?.vendas || []), ...(mercado.nivel2?.vendas || []),
        ...(mercado.nivel1?.locacoes || []), ...(mercado.nivel2?.locacoes || [])]
        .map(a => String(a?.data || '')).filter(d => /^\d{4}-\d{2}/.test(d)).sort();
      mercado.metodologia = {
        geradoEm: new Date().toISOString(),
        comparaveis: {
          origem: mercado.__modoBase ? 'base_propria'
            : mercado.fonteEstimativa === 'indice_bidpro' ? 'indice_bidpro'
            : reaproveitado ? 'reaproveitado' : 'pesquisa_web',
          motor: mercado.__diag?.motor || (mercado.__modoBase ? null : 'web'),
          nVendas: nVend, nLocacoes: nLoc,
          nivelBase: mercado.__modoBase?.nivel || null,
          periodo: datasAmostra.length ? { de: datasAmostra[0].slice(0, 7), ate: datasAmostra[datasAmostra.length - 1].slice(0, 7) } : null,
          pesquisaEm: mercado.pesquisaEm || null,
        },
        area: { valor: areaM2 || null, fonte: areaFonte, divergencia: divergenciaArea },
        documento: {
          editalLido: !!mercado.condicoesEdital?.fonte,
          editalFonte: mercado.condicoesEdital?.fonte || null,
          regrasOrigem: mercado.condicoesEdital?.regrasOrigem || (mercado.condicoesEdital?.regrasPagamento ? 'edital' : null),
          custosLidos: !!mercado.condicoesEdital?.custos,
        },
        referencias: {
          fipeZap: !!mercado.referenciaFipeZap?.encontrado,
          zoneamento: !!mercado.zoneamento?.encontrado,
          seguranca: !!mercado.segurancaPublica?.encontrado,
          ibge: !!mercado.socio,
          indiceBidPro: mercado.indiceBidPro?.nivel || null,
          valorizacaoAnos: Array.isArray(mercado.valorizacao?.serie) ? mercado.valorizacao.serie.length : 0,
        },
      };
      const result = { mercado, parecer, valorMercado, valorLocacao, valorAvaliacao: avalDb > 0 ? avalDb : null, reaproveitado, pesquisaEm: mercado.pesquisaEm, mercadoVazio,
        // DIVERGÊNCIA DE ÁREA: era calculada, virava anomalia interna e MORRIA aqui — nunca
        // chegava ao cliente, apesar de o comentário do bloco prometer "aviso EXPLÍCITO no
        // relatório". Agora vai no result e a tela mostra.
        divergenciaArea };
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
      // ENTREGA INCOMPLETA: mercado veio, mas o PARECER saiu vazio (a redação falhou). Antes isso
      // ia para o 360 como 'relatorio_mercado_ok' — a falha ficava INVISÍVEL para diagnóstico. Agora
      // é um evento próprio (relatorio_parecer_vazio) com o motivo (__diagParecer), rastreável no
      // Cliente 360. O self-heal do cron re-gera; o evento fica como trilha do que aconteceu.
      const dp = m.__diagParecer || null;
      const semParecer = !mercadoVazio && !(result.parecer || '').trim();
      const evento = mercadoVazio ? 'relatorio_mercado_vazio' : semParecer ? 'relatorio_parecer_vazio' : 'relatorio_mercado_ok';
      const detalhe = mercadoVazio
        ? `Sem estimativa de mercado${m.__erroApi ? ` (API: ${m.__erroApi})` : ' (sem comparáveis ativos)'}`
        : semParecer
          ? `Entrega incompleta: mercado OK${valorMercado ? ` (R$ ${Math.round(valorMercado).toLocaleString('pt-BR')})` : ''} mas SEM parecer — motivo: ${dp?.erro || dp?.erroSetup || 'desconhecido'}${dp?.tentativas ? ` (${dp.tentativas} tentativa(s))` : ''}`
          : `Mercado estimado por ${fonte}${valorMercado ? ` — R$ ${Math.round(valorMercado).toLocaleString('pt-BR')}` : ''}`;
      await logAtividade(ownerId, evento, detalhe,
        { imovelId: String(imovelId), cidade: cidade || null, fonte, comparaveis: nComp, valorMercado: valorMercado || null, erroApi: m.__erroApi || null, parecerDiag: dp, reaproveitado: !!result.reaproveitado, ator: user.id });
      // CUSTO REAL desta geração (uma linha por relatório). Sem isto, "quanto custa um
      // mercadológico" só saía por inferência do agregado diário — que num dia com
      // documentais junto mistura os dois. `ok:false` na entrega incompleta: o gasto de
      // uma geração que não entregou precisa aparecer como desperdício, não como custo
      // normal do produto. Vale para geração reaproveitada também (custo perto de zero,
      // que é justamente o que o cache economiza e queremos ver na média).
      await registrarCustoGeracao('mercadologico', {
        userId: ownerId, imovelId: String(imovelId), custoMicro: _custoMicroReq,
        ok: !mercadoVazio && !semParecer,
        meta: { cidade: cidade || null, comparaveis: nComp, reaproveitado: !!result.reaproveitado, evento },
      });
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
    // REGERAÇÃO QUE FALHOU: devolve o relatório anterior em vez de deixar o cliente sem nada.
    // Volta como 'concluida' (é um relatório íntegro, o de antes) com o motivo da falha em
    // `erro`, para a tela poder avisar "não deu para atualizar, este é o anterior".
    if (resultAnterior) {
      await upsertAnalise({ ...base, status: 'concluida', erro: `regeracao_falhou: ${String(msg).slice(0, 160)}`, result: resultAnterior });
    } else {
      await upsertAnalise({ ...base, status: 'erro', erro: msg });
    }
    try { await logAtividade(ownerId, 'relatorio_mercado_erro', String(msg).slice(0, 200), { imovelId: String(imovelId), cidade: cidade || null, timeout, erroApi: e?.detalhe || null, restaurouAnterior: !!resultAnterior, ator: user.id }); } catch { /* log best-effort */ }
    // Estorna a cota consumida (não cobra por análise que falhou; evita cobrança
    // dupla na re-tentativa, já que 'erro' não conta como concluída em isNovo).
    if (cota && cota.ok && cota.tipo) {
      try { await sb('rpc/estornar_analise_por', { method: 'POST', body: JSON.stringify({ p_user_id: user.id, p_tipo: cota.tipo }) }); } catch { /* estorno best-effort */ }
    }
    res.status(timeout ? 504 : 500).json({ error: timeout ? 'Tempo limite ao gerar a análise' : 'Falha ao gerar a análise', detalhe: msg });
  }
}
