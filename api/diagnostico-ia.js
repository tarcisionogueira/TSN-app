// DIAGNÓSTICO POR IA sobre os indicadores do dashboard — assertividade + economia.
// Barato e cacheado: roda no GEMINI (não no Claude) e regenera no MÁXIMO 1×/dia
// (ou sob demanda com ?forcar=1), para o painel ler sem custo a cada abertura.
// Ancorado nos NÚMEROS REAIS do sistema (snapshot + custos medidos): não inventa.
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { getUser, getUserRoleById, isCronAuthorized } from './_auth.js';
import { medirGemini } from './_uso.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const GEMINI_KEY   = (process.env.GEMINI_API_KEY || '').trim();
const GEMINI_MODEL = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
// TTL de 68h (~3 dias, com folga p/ o cron das 11h não achar o cache "fresco" e
// pular a regeneração). Era 20h, casado com o cron diário. A cadência passou a ser
// de 3 dias por decisão do dono (07/08) e o TTL tem de acompanhar: senão a primeira
// visita do admin ao painel depois de 20h regeneraria assim mesmo e o intervalo de
// 3 dias não existiria na prática. Três dias também é um prazo mais honesto para os
// indicadores que ele lê — demanda de busca, saúde da coleta e custo do mês mal se
// mexem em 24h, então o diagnóstico anterior repetia a si mesmo.
const TTL_HORAS    = Number(process.env.DIAGNOSTICO_TTL_HORAS || 68);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function rpc(nome, body = {}) {
  try { const r = await sb(`rpc/${nome}`, { method: 'POST', body: JSON.stringify(body) }); return r.ok ? await r.json() : null; }
  catch { return null; }
}
function parseJSON(t) {
  if (!t) return null;
  const s = t.trim();
  try { return JSON.parse(s); } catch { /* tenta extrair */ }
  const md = s.match(/```(?:json)?\s*([\s\S]*?)```/); if (md) { try { return JSON.parse(md[1].trim()); } catch { /* */ } }
  const o = s.match(/\{[\s\S]*\}/); if (o) { try { return JSON.parse(o[0]); } catch { /* */ } }
  return null;
}

// Reúne o "fluxo" (números reais) para o diagnóstico.
async function coletarSnapshot() {
  const [snap, sust, demanda] = await Promise.all([rpc('diagnostico_snapshot'), rpc('sustentabilidade_ia'), rpc('demanda_busca_agregada')]);
  // Custos do mês por provedor + custo/análise aprendido.
  const inicioMes = new Date().toISOString().slice(0, 8) + '01';
  let custos = {};
  let custoAnaliseUsd = Number(process.env.IA_CUSTO_ANALISE_USD || 0.49);
  try {
    const r = await sb(`uso_integracoes?dia=gte.${inicioMes}&select=provedor,operacao,requests,custo_usd_micro`);
    if (r.ok) {
      const rows = await r.json();
      for (const x of rows) {
        custos[x.provedor] = (custos[x.provedor] || 0) + (x.custo_usd_micro || 0) / 1e6;
      }
      const ws = rows.filter((x) => x.provedor === 'claude' && x.operacao === 'web_search');
      const req = ws.reduce((s, x) => s + (x.requests || 0), 0);
      const usd = ws.reduce((s, x) => s + (x.custo_usd_micro || 0) / 1e6, 0);
      if (req >= 5) custoAnaliseUsd = usd / req;
    }
  } catch { /* segue com o que tem */ }
  // Saúde da COLETA (fontes de leilão): estratégia ativa + status por fonte. Deixa
  // a IA monitorar o scraping — inclusive a economia (LJUD/CEF migraram para
  // NAVEGADOR grátis; Bright Data virou backup).
  let coleta = [];
  try {
    const r = await sb('fonte_saude?select=fonte,total,status,estrategia,executado_em&order=executado_em.desc&limit=80');
    if (r.ok) {
      const rows = await r.json();
      const vistos = new Set();
      for (const x of rows) { if (vistos.has(x.fonte)) continue; vistos.add(x.fonte); coleta.push({ fonte: x.fonte, total: x.total, status: x.status, estrategia: x.estrategia, em: x.executado_em }); }
    }
  } catch { /* segue sem a saúde da coleta */ }

  return { snapshot: snap || {}, sustentabilidade: sust || {}, custos_mes_usd: custos, custo_analise_usd: Math.round(custoAnaliseUsd * 1e4) / 1e4, coleta_fontes: coleta, demanda_busca: demanda || {} };
}

async function gerarDiagnostico(dados) {
  const usdBrl = Number(process.env.APP_USD_BRL || 5.4);
  const prompt = `Você recebe os INDICADORES REAIS de hoje da BidPro Brasil (plataforma de leilões imobiliários). Produza um diagnóstico curto e ACIONÁVEL.

REGRAS:
- Baseie-se SOMENTE nos números abaixo. Não invente dados nem métricas que não estão aqui.
- Cada sugestão deve equilibrar ASSERTIVIDADE (qualidade/funcionalidade para o cliente) e ECONOMIA (custo): economize onde NÃO prejudica o cliente; invista onde melhora resultado e for viável.
- Seja direto, específico e prático. Nada de generalidades.
- Câmbio de referência: US$ 1 = R$ ${usdBrl}.
- MONITORE a COLETA (campo "coleta_fontes"): é a saúde do scraping dos leiloeiros (1 registro por fonte com estratégia ativa + status).
  * Sinalize como ponto de PRIORIDADE ALTA / impacto "risco" qualquer fonte com status "falhou" (coleta zerada) ou "degradado" (qualidade reprovou) — o acervo dessa fonte para de atualizar e some das análises.
  * Se uma fonte esperada (CEF, MEGA, SUPERBID, SOLD, ZUK, SODRE, FRAZAO, LJUD) não aparecer em "coleta_fontes", trate como coleta parada (site pode ter mudado / fingerprint bloqueado) e recomende reconectar.
  * Comente a ECONOMIA da coleta: LJUD e CEF migraram para NAVEGADOR real (page.evaluate / puppeteer) — coleta grátis; Bright Data ficou só como BACKUP (custa cota). Se a estratégia ativa de uma fonte for "brightdata"/pago quando havia caminho grátis, aponte como oportunidade de economia. Se o grátis estiver saudável, confirme que não há gasto de cota desnecessário.
  * Se toda a coleta estiver saudável e grátis, diga isso em 1 frase — não invente problema onde não há.
- APRENDA COM A DEMANDA (campo "demanda_busca": o que os clientes BUSCAM/VISUALIZAM, agregado e anônimo, últimos 30 dias) e transforme em DIRECIONAMENTOS de crescimento:
  * "demanda_sem_oferta" = cidades onde a busca voltou 0 resultados = PROCURA NÃO ATENDIDA. É o sinal mais forte: recomende CAPTAR leiloeiro/imóvel nessas praças e/ou rodar CAMPANHA de aquisição onde já há procura. Cite as cidades concretas (com o nº de buscas sem resultado).
  * Cruze "top_cidades" (e "media_resultados" baixa = pouca oferta), "top_tipos", "top_pagamento" e "imoveis_mais_vistos": onde há muita procura e pouca oferta é oportunidade; a forma de pagamento predominante (ex.: financiado/hipotecado) orienta o foco comercial e de conteúdo.
  * Gere ao menos 1 ponto com impacto "crescimento" a partir dessa demanda, quando houver sinal claro.

INDICADORES (JSON):
${JSON.stringify(dados, null, 2)}

Responda APENAS com este JSON (sem markdown):
{
  "saude": "verde | amarelo | vermelho",
  "resumo": "2 a 3 frases com a leitura geral (crescimento, custo, sustentabilidade do grátis).",
  "economia_potencial_brl": 0,
  "pontos": [
    { "area": "ex.: Custo IA / Sustentabilidade grátis / Crescimento / Inadimplência", "diagnostico": "o que os números mostram", "sugestao": "ação concreta", "prioridade": "alta | media | baixa", "impacto": "economia | qualidade | crescimento | risco" }
  ]
}`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 45000);
  try {
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(GEMINI_MODEL)}:generateContent`,
      { method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': GEMINI_KEY }, signal: ctrl.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: 4000, thinkingConfig: { thinkingBudget: 0 }, temperature: 0.4 },
        }) },
    );
    if (!r.ok) return null;
    const data = await r.json();
    medirGemini(GEMINI_MODEL, data, 'messages'); // mede o custo do próprio diagnóstico
    const text = (data?.candidates?.[0]?.content?.parts || []).map((p) => (p && typeof p.text === 'string' ? p.text : '')).join('');
    return parseJSON(text);
  } catch { return null; }
  finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  // Admin (via token) OU cron (para regenerar automaticamente 1×/dia).
  let autorizado = isCronAuthorized(req);
  if (!autorizado) {
    const user = await getUser(req);
    if (user && (await getUserRoleById(user.id)) === 'admin') autorizado = true;
  }
  if (!autorizado) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  const forcar = String(req.query?.forcar || '') === '1';

  // Cache: devolve o último se ainda fresco (a menos que forçado).
  let cache = null;
  try { const c = await (await sb('diagnostico_ia?id=eq.1&select=*&limit=1')).json(); cache = Array.isArray(c) ? c[0] : null; } catch { /* */ }
  if (cache && !forcar) {
    const idadeH = (Date.now() - new Date(cache.gerado_em).getTime()) / 3600000;
    if (idadeH < TTL_HORAS) { res.status(200).json({ ...cache, cacheado: true, idade_horas: Math.round(idadeH * 10) / 10 }); return; }
  }

  if (!GEMINI_KEY) {
    if (cache) { res.status(200).json({ ...cache, cacheado: true, aviso: 'Gemini indisponível; diagnóstico anterior.' }); return; }
    res.status(200).json({ saude: null, resumo: 'Diagnóstico por IA indisponível (GEMINI_API_KEY ausente).', pontos: [] }); return;
  }

  const dados = await coletarSnapshot();
  const diag = await gerarDiagnostico(dados);
  if (!diag) {
    if (cache) { res.status(200).json({ ...cache, cacheado: true, aviso: 'Falha ao gerar agora; diagnóstico anterior.' }); return; }
    res.status(200).json({ saude: null, resumo: 'Não foi possível gerar o diagnóstico agora. Tente novamente.', pontos: [] }); return;
  }

  const row = {
    id: 1, gerado_em: new Date().toISOString(), modelo: GEMINI_MODEL,
    saude: diag.saude || null, resumo: diag.resumo || '',
    economia_potencial_brl: Number(diag.economia_potencial_brl) || 0,
    pontos: Array.isArray(diag.pontos) ? diag.pontos : [], snapshot: dados,
  };
  try { await sb('diagnostico_ia?on_conflict=id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(row) }); } catch { /* cache best-effort */ }

  res.status(200).json({ ...row, cacheado: false });
}
