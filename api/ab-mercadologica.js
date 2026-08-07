// PILOTO A/B — Pesquisa mercadológica: Claude (Sonnet 4.6 + web_search) vs
// Gemini (2.5 Flash + Google Search grounding). Para cada imóvel real do banco,
// roda os DOIS modelos com o MESMO prompt (promptMercado, fonte única em
// gerar-analise.js) e grava a comparação em `ab_mercadologica`. Objetivo:
// decidir com dados se o Gemini pode assumir a mercadológica (custo) sem perder
// qualidade — a métrica-chave é o preço médio por m² consolidado.
//
// NÃO afeta produção: a geração real (api/gerar-analise.js) continua no Claude.
// Protegido por CRON_SECRET (isCronAuthorized). Disparado em laço por um GitHub
// Action (workflow_dispatch) até acumular a amostra desejada.
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { isCronAuthorized } from './_auth.js';
import { anthropicFetch } from './_claude.js';
import { medirGemini } from './_uso.js';
import { promptMercado, extractText, parseJSON } from './gerar-analise.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const GEMINI_KEY   = (process.env.GEMINI_API_KEY || '').trim();
const CLAUDE_MODEL = 'claude-sonnet-4-6';                 // MESMO da produção
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// Extrai as métricas comparáveis de um objeto de mercado (formato do promptMercado).
function metricas(m) {
  const precoM2 = Number(m?.consolidado?.precoMedioM2 || m?.nivel2?.precoMedioM2 || 0) || 0;
  const valor   = Number(m?.consolidado?.valorEstimadoImovel || 0) || 0;
  const fipezap = m?.referenciaFipeZap?.encontrado ? (Number(m.referenciaFipeZap.precoMedioM2) || 0) : 0;
  const amostras = (Number(m?.nivel1?.totalAmostras) || 0) + (Number(m?.nivel2?.totalAmostras) || 0);
  return { precoM2, valor, fipezap, amostras };
}

// ── CLAUDE: idêntico ao caminho de produção (gerar-analise.js) ────────────────
async function rodarClaude(inp) {
  const t0 = Date.now();
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-beta': 'web-search-2025-03-05' };
  const r = await anthropicFetch({
    method: 'POST', headers,
    body: JSON.stringify({
      model: CLAUDE_MODEL, max_tokens: 8000,
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8 }],
      system: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${inp.tipoImovel}). Retorne apenas JSON válido.`,
      messages: [{ role: 'user', content: promptMercado(inp) }],
    }),
  }, {
    // Sem estas opções o call site herdava `retries=3, timeoutMs=120000`: 4 tentativas de
    // 120s = 480s numa função com `maxDuration: 300`. A função morria antes da última, o
    // upsert em `ab_mercadologica` nunca acontecia e o resultado do Gemini rodando em
    // paralelo ia junto — pagava-se até 4× a pesquisa (Sonnet + 8 buscas) e não se gravava
    // nada. `retries: 0` + 150s: uma tentativa que CABE no orçamento da função e entrega.
    // Mesmo padrão de indice-reforco-cron e gerar-analise.
    retries: 0, timeoutMs: 150000, noFallback: true,
  });
  const data = await r.json();
  const mercado = parseJSON(extractText(data)) || {};
  return { ...metricas(mercado), ms: Date.now() - t0, ok: !!mercado.consolidado };
}

// ── GEMINI: mesmo prompt, com Google Search grounding (tools: google_search) ──
// Chamada dedicada (o _gemini.js compartilhado ignora tools de propósito).
async function rodarGemini(inp) {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, signal: ctrl.signal,
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: `Você é um perito avaliador imobiliário sênior. Busque o MÁXIMO de amostras possível, SEMPRE do mesmo tipo (${inp.tipoImovel}). Retorne apenas JSON válido, sem markdown.` }] },
          contents: [{ role: 'user', parts: [{ text: promptMercado(inp) }] }],
          tools: [{ google_search: {} }],
          // thinkingBudget:0 desliga o "pensamento" do 2.5-flash (que consumia o
          // teto e truncava o JSON → finishReason=MAX_TOKENS). Teto amplo por margem.
          generationConfig: { maxOutputTokens: 20000, thinkingConfig: { thinkingBudget: 0 } },
        }),
      },
    );
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      return { precoM2: 0, valor: 0, fipezap: 0, amostras: 0, ms: Date.now() - t0, ok: false, err: `HTTP ${r.status}: ${body.slice(0, 300)}` };
    }
    const data = await r.json();
    medirGemini(GEMINI_MODEL, data, 'grounding'); // mede tokens + busca (fire-and-forget)
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    const mercado = parseJSON(text) || {};
    const ok = !!mercado.consolidado;
    return { ...metricas(mercado), ms: Date.now() - t0, ok, err: ok ? null : `sem consolidado (finishReason=${data?.candidates?.[0]?.finishReason || '?'}, texto=${(text || '').slice(0, 120)})` };
  } catch (e) {
    return { precoM2: 0, valor: 0, fipezap: 0, amostras: 0, ms: Date.now() - t0, ok: false, err: `exception: ${String(e?.message || e).slice(0, 200)}` };
  } finally {
    clearTimeout(timer);
  }
}

function diffPct(a, b) {
  if (!(a > 0) || !(b > 0)) return null;
  return Math.round((Math.abs(a - b) / ((a + b) / 2)) * 1000) / 10; // 1 casa
}

async function processarImovel(row) {
  const inp = {
    endereco: row.endereco || `${row.bairro || ''} ${row.cidade || ''}`.trim(),
    tipoImovel: row.tipo || 'imovel',
    areaM2: Number(row.area_m2) || 0,
    cidade: row.cidade || '',
    estado: row.estado || '',
    nomeCondominio: '',
  };
  let claude = null, gemini = null, erro = null;
  try {
    [claude, gemini] = await Promise.all([rodarClaude(inp), rodarGemini(inp)]);
  } catch (e) {
    erro = String(e?.message || e);
  }
  // Registra a causa da falha do Gemini (diagnóstico do piloto) sem mascarar erro geral.
  if (!erro && gemini && !gemini.ok && gemini.err) erro = `gemini: ${gemini.err}`;
  const linha = {
    imovel_id: row.id,
    tipo: inp.tipoImovel, cidade: inp.cidade, estado: inp.estado, area_m2: inp.areaM2,
    claude_preco_m2: claude?.precoM2 ?? null, claude_valor: claude?.valor ?? null,
    claude_amostras: claude?.amostras ?? null, claude_fipezap: claude?.fipezap ?? null,
    claude_ok: claude?.ok ?? false, ms_claude: claude?.ms ?? null,
    gemini_preco_m2: gemini?.precoM2 ?? null, gemini_valor: gemini?.valor ?? null,
    gemini_amostras: gemini?.amostras ?? null, gemini_fipezap: gemini?.fipezap ?? null,
    gemini_ok: gemini?.ok ?? false, ms_gemini: gemini?.ms ?? null,
    diff_pct: diffPct(claude?.precoM2, gemini?.precoM2),
    erro,
  };
  await sb('ab_mercadologica?on_conflict=imovel_id', {
    method: 'POST',
    headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
    body: JSON.stringify(linha),
  });
  return linha;
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!CLAUDE_KEY)  { res.status(500).json({ error: 'CLAUDE_KEY ausente' }); return; }
  if (!GEMINI_KEY)  { res.status(500).json({ error: 'GEMINI_API_KEY ausente' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const lote = Math.max(1, Math.min(Number(req.query?.lote) || 2, 5));
  const rc = await sb('rpc/ab_mercado_lote', { method: 'POST', body: JSON.stringify({ p_lote: lote }) });
  if (!rc.ok) { res.status(500).json({ error: 'Falha ao selecionar lote', detalhe: await rc.text().catch(() => '') }); return; }
  const rows = await rc.json().catch(() => []);
  if (!Array.isArray(rows) || !rows.length) { res.status(200).json({ ok: true, processados: 0, msg: 'Sem imóveis pendentes' }); return; }

  const resultados = [];
  for (const row of rows) resultados.push(await processarImovel(row));

  // Total acumulado, para o Action saber quando parar.
  let total = null;
  try {
    const tr = await sb('ab_mercadologica?select=id', { method: 'HEAD', headers: { Prefer: 'count=exact' } });
    const cr = tr.headers.get('content-range') || '';
    total = Number(cr.split('/')[1]) || null;
  } catch { /* contagem best-effort */ }

  res.status(200).json({ ok: true, processados: resultados.length, total, resultados });
}
