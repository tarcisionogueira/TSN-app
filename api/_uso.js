// Medição de uso/custo das integrações metradas — best-effort, NUNCA lança para
// o caller (se o Supabase estiver fora, o fluxo principal segue). Alimenta o
// painel "Custos & Uso" do dashboard e os marcadores de teto (grátis/orçamento).
// Grava via RPC registrar_uso (incremento atômico por provedor/operacao/dia).
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

// Preços por TOKEN em USD (catálogo dos provedores, 2026). Chave = model id.
// Usado só para ESTIMAR custo; o valor real é o do painel de billing de cada um.
const PRECO = {
  'claude-opus-4-8':            { in: 5e-6,    out: 25e-6 },
  'claude-sonnet-4-6':          { in: 3e-6,    out: 15e-6 },
  'claude-sonnet-5':            { in: 3e-6,    out: 15e-6 },
  'claude-haiku-4-5':           { in: 1e-6,    out: 5e-6  },
  'gemini-2.5-flash':           { in: 0.30e-6, out: 2.50e-6 },
  'gemini-2.5-flash-lite':      { in: 0.10e-6, out: 0.40e-6 },
  'gemini-2.5-pro':             { in: 1.25e-6, out: 10e-6  },
};
export const WEB_SEARCH_USD = 0.01;   // Claude web_search: US$ 10 / 1.000 buscas
export const GROUNDING_USD  = 0.035;  // Gemini grounding: US$ 35 / 1.000 (após cota grátis)

// Normaliza o model id para a chave de preço (remove sufixo de data -20251001).
function precoDe(model) {
  const m = String(model || '').trim();
  return PRECO[m] || PRECO[m.replace(/-\d{6,8}$/, '')] || null;
}

export function custoMicro(model, tin = 0, tout = 0) {
  const p = precoDe(model);
  if (!p) return 0;
  return Math.round((tin * p.in + tout * p.out) * 1e6); // micro-USD
}

// Custo (micro-USD) de UMA resposta do Claude a partir do usage — inclui cache e buscas
// web metradas. Usado pelos geradores para ACUMULAR o custo real da geração e cobrar
// crédito (custo × multiplicador) quando a cota mensal do plano já acabou. Mesmo cálculo
// do medirClaude (que alimenta o painel), mas RETORNANDO o valor em vez de só registrar.
export function custoRespostaClaude(model, usage = {}) {
  const tin = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
  const tout = usage.output_tokens || 0;
  const buscas = usage?.server_tool_use?.web_search_requests || 0;
  return custoMicro(model, tin, tout) + Math.round(buscas * WEB_SEARCH_USD * 1e6);
}
// Custo (micro-USD) de N leituras via Bright Data (Web Unlocker ~US$1,5/1.000 = 1500 micro/req).
export const BRIGHTDATA_MICRO_POR_REQ = 1500;
export function custoBrightData(nRequests = 0) {
  return Math.max(0, Math.round(nRequests)) * BRIGHTDATA_MICRO_POR_REQ;
}

// Registra uso (fire-and-forget: chame SEM await no caminho quente, ou com await
// em contexto que já vai encerrar). dados: {requests, tokens_in, tokens_out,
// unidades, custo_usd_micro}.
export async function registrarUso(provedor, operacao, dados = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_uso`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        p_provedor: provedor,
        p_operacao: operacao || 'default',
        p_requests: dados.requests ?? 1,
        p_tokens_in: Math.round(dados.tokens_in ?? 0),
        p_tokens_out: Math.round(dados.tokens_out ?? 0),
        p_unidades: dados.unidades ?? 0,
        p_custo_usd_micro: Math.round(dados.custo_usd_micro ?? 0),
      }),
    });
  } catch { /* medição nunca quebra o fluxo principal */ }
}

// Soma as UNIDADES já usadas HOJE (UTC) de um provedor — para travas de custo
// (ex.: teto diário de geocodes pagos do Google). Best-effort: retorna 0 se o
// Supabase estiver indisponível (falha ABERTO — nunca bloqueia o fluxo por erro de
// medição; a trava só age quando consegue LER um número acima do limite).
async function somaUnidades(provedor, filtroDia) {
  if (!SUPABASE_URL || !SERVICE_KEY) return 0;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/uso_integracoes?provedor=eq.${encodeURIComponent(provedor)}&${filtroDia}&select=unidades`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return 0;
    const rows = await r.json();
    return Array.isArray(rows) ? rows.reduce((s, x) => s + (Number(x.unidades) || 0), 0) : 0;
  } catch { return 0; }
}

// Unidades usadas HOJE (UTC) — trava diária opcional (anti-spike).
export async function unidadesUsadasHoje(provedor) {
  const hoje = new Date().toISOString().slice(0, 10);
  return somaUnidades(provedor, `dia=eq.${hoje}`);
}

// Unidades usadas no MÊS corrente (UTC) — trava principal alinhada ao tier grátis
// (ex.: Google Geocoding = 10k/mês). Bater este teto = parar de gastar no mês.
export async function unidadesUsadasMes(provedor) {
  const inicioMes = new Date().toISOString().slice(0, 8) + '01';
  return somaUnidades(provedor, `dia=gte.${inicioMes}`);
}

// Mede uma resposta do Claude (Anthropic) a partir de um CLONE do Response, sem
// perturbar o corpo lido pelo caller. Conta tokens e buscas web (metradas).
export async function medirClaude(options, resClone) {
  try {
    let model = '';
    try { model = JSON.parse(options?.body || '{}').model || ''; } catch { /* ignore */ }
    const data = await resClone.json();
    const u = data?.usage || {};
    const tin = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    const tout = u.output_tokens || 0;
    const buscas = u?.server_tool_use?.web_search_requests || 0;
    const custo = custoMicro(model, tin, tout) + Math.round(buscas * WEB_SEARCH_USD * 1e6);
    await registrarUso('claude', buscas > 0 ? 'web_search' : 'messages',
      { requests: 1, tokens_in: tin, tokens_out: tout, unidades: buscas, custo_usd_micro: custo });
  } catch { /* best-effort */ }
}

// Mede uma resposta do Gemini a partir do JSON já parseado (usageMetadata).
// operacao: 'messages' (sem busca) ou 'grounding' (com google_search).
export async function medirGemini(model, data, operacao = 'messages') {
  try {
    const u = data?.usageMetadata || {};
    const tin = u.promptTokenCount || 0;
    const tout = (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0);
    const buscas = operacao === 'grounding' ? 1 : 0; // 1 grounding por chamada com busca
    const custo = custoMicro(model, tin, tout) + Math.round(buscas * GROUNDING_USD * 1e6);
    await registrarUso('gemini', operacao, { requests: 1, tokens_in: tin, tokens_out: tout, unidades: buscas, custo_usd_micro: custo });
    // DEVOLVE o custo (antes só registrava): os geradores acumulam o custo REAL da geração em
    // `geracao_custos`, e esse acumulador só contava o Claude. Com o mercadológico rodando no
    // Gemini, a maior parte do custo dele ficava de fora da própria métrica de custo.
    return custo;
  } catch { return 0; }
}

/**
 * CUSTO REAL DE UMA GERAÇÃO (uma linha por relatório/índice). `uso_integracoes` agrega
 * por provedor/operação/DIA — num dia com 3 mercadológicos e 3 documentais os dois se
 * misturam e o custo por relatório vira inferência. Aqui cada geração grava o que ELA
 * gastou (o acumulador `_custoMicroReq` de cada gerador), então "quanto custa em média
 * cada relatório" passa a ser uma consulta, não uma estimativa: `custo_por_geracao()`.
 * `ok:false` marca geração que gastou e não entregou — o desperdício fica medido também.
 * Best-effort: nunca lança para o gerador.
 */
export async function registrarCustoGeracao(funcao, { userId = null, imovelId = null, custoMicro = 0, ok = true, meta = null } = {}) {
  if (!SUPABASE_URL || !SERVICE_KEY || !funcao) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_geracao_custo`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify({
        p_funcao: String(funcao), p_user_id: userId || null, p_imovel_id: imovelId ? String(imovelId) : null,
        p_custo_micro: Math.round(Number(custoMicro) || 0), p_ok: !!ok, p_meta: meta || null,
      }),
      signal: AbortSignal.timeout(6000),
    });
  } catch { /* medição nunca quebra a geração */ }
}
