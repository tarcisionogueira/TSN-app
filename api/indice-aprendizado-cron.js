/**
 * GET/POST /api/indice-aprendizado-cron — fecha o loop de precisão do Índice BidPro.
 *   (3) RECÊNCIA: consolida o índice (nível cidade) a partir das amostras DATADAS
 *       recentes (indice_consolidar_amostras) — dado velho deixa de dominar.
 *   (4) CALIBRAÇÃO: ajusta fator_calibracao comparando a REVENDA real com o índice
 *       (indice_calibrar). Sem gabarito de revenda, não mexe em nada.
 *   (+) SUPERVISOR (opcional, Gemini): lê anomalias/vícios recentes + regiões calibradas
 *       e ESCREVE uma sugestão de ajuste (aprendizado_sugestoes) para o DONO revisar.
 *       Nunca altera prompt sozinho. Dormente sem GEMINI_API_KEY.
 *
 * Roda 1x/dia (vercel.json). Autorizado por CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { geminiFetch } from './_gemini.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const hdr = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, { ...opts, headers: { ...hdr, ...(opts.headers || {}) } });
}
async function rpc(name, body) {
  const r = await sb(`rpc/${name}`, { method: 'POST', body: JSON.stringify(body || {}) });
  return r.ok ? r.json().catch(() => null) : null;
}
async function get(path) { const r = await sb(path); return r.ok ? r.json().catch(() => []) : []; }

// Supervisor: monta um resumo dos sinais da semana e pede ao Gemini 2-4 sugestões
// CONCRETAS de ajuste de prompt/regra. Só grava se houver o que revisar e sem repetir
// em <6 dias. Best-effort: nunca quebra o cron.
async function supervisor() {
  if (!process.env.GEMINI_API_KEY) return { rodou: false, motivo: 'sem GEMINI_API_KEY' };
  try {
    const ultimas = await get('aprendizado_sugestoes?select=criado_em&order=criado_em.desc&limit=1');
    if (ultimas?.[0]?.criado_em && (Date.now() - Date.parse(ultimas[0].criado_em)) < 6 * 86400000) {
      return { rodou: false, motivo: 'sugestão recente (<6d)' };
    }
    const desde = new Date(Date.now() - 7 * 86400000).toISOString();
    const [anomalias, qualidade, calibradas] = await Promise.all([
      get(`relatorio_anomalias?select=tipo&criado_em=gte.${desde}`),
      get(`agente_aprendizado?select=agente,qualidade&criado_em=gte.${desde}&limit=500`),
      get('cidade_indicadores?select=cidade_norm,uf,fator_calibracao&fator_calibracao=neq.1&limit=50'),
    ]);
    // Agrega os sinais (contagens) — poison-resistente, sem PII.
    const contAnom = {};
    for (const a of (anomalias || [])) contAnom[a.tipo] = (contAnom[a.tipo] || 0) + 1;
    const contVicio = {};
    for (const q of (qualidade || [])) for (const [k, v] of Object.entries(q.qualidade || {})) if (v === true) contVicio[k] = (contVicio[k] || 0) + 1;

    const temSinal = Object.keys(contAnom).length || Object.keys(contVicio).length || (calibradas || []).length;
    if (!temSinal) return { rodou: false, motivo: 'sem sinais na semana' };

    const resumoSinais = JSON.stringify({ anomalias: contAnom, vicios: contVicio, regioes_calibradas: (calibradas || []).length });
    const prompt = `Você é um supervisor de qualidade dos relatórios imobiliários da BidPro. Com base nos SINAIS agregados da última semana (contagens, sem dados pessoais), proponha de 2 a 4 ajustes CONCRETOS de prompt/regra que aumentem a precisão das próximas análises. Seja específico e acionável (o que mudar e por quê). Responda em JSON: {"sugestoes":[{"titulo":"","acao":"","porque":""}]}.\n\nSINAIS: ${resumoSinais}`;

    const resp = await geminiFetch({ method: 'POST', body: JSON.stringify({
      system: 'Responda só JSON válido, em português, sem markdown.',
      messages: [{ role: 'user', content: prompt }], max_tokens: 1200,
    }) }, { timeoutMs: 20000 });
    if (!resp) return { rodou: false, motivo: 'gemini indisponível' };
    const data = await resp.json().catch(() => null);
    const texto = data?.content?.[0]?.text || '';
    let detalhe = null; try { detalhe = JSON.parse(texto.replace(/```json|```/g, '').trim()); } catch { detalhe = { bruto: texto.slice(0, 4000) }; }

    await sb('aprendizado_sugestoes', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ escopo: 'mercadologico', resumo: `Revisão semanal (${Object.keys(contAnom).length} tipos de anomalia, ${Object.keys(contVicio).length} vícios)`, detalhe: { sinais: { anomalias: contAnom, vicios: contVicio }, sugestoes: detalhe } }),
    });
    return { rodou: true };
  } catch (e) { return { rodou: false, motivo: e?.message }; }
}

export const GET = handler;
export const POST = handler;
async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!SUPABASE_URL || !SERVICE_KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });

  const consolidadas = await rpc('indice_consolidar_amostras', {});
  const calibradas   = await rpc('indice_calibrar', {});
  const sup          = await supervisor();

  return new Response(JSON.stringify({
    ok: true,
    cidades_consolidadas: Number.isFinite(+consolidadas) ? +consolidadas : consolidadas,
    regioes_calibradas:   Number.isFinite(+calibradas) ? +calibradas : calibradas,
    supervisor: sup,
  }), { headers: { 'Content-Type': 'application/json' } });
}
