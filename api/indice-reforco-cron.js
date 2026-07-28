/**
 * /api/indice-reforco-cron — REFORÇO PROATIVO do Índice de mercado (anti "relatório vazio").
 *
 * MOTIVO (incidente 28/07): um relatório de Belo Horizonte saiu VAZIO porque a busca web ao vivo
 * estourou o tempo E a cidade NÃO tinha almofada de índice (0 amostras). A correção estrutural é
 * SEMEAR o índice das cidades que importam ANTES de alguém pedir o relatório — assim, quando a
 * busca ao vivo falha/demora, o relatório ainda entrega pelo Índice BidPro (base própria).
 *
 * O cron pega, a cada disparo, um LOTE curado de cidades (prioriza as com RELATÓRIO ou muitos
 * imóveis ATIVOS e índice MAGRO — indice_reforco_proximas), roda a busca ARROJADA e FRESCA (o
 * MESMO núcleo do gerador ao vivo, _indice-core.js) e semeia indice_amostras. É do SISTEMA: sem
 * usuário e SEM cobrança. Rotaciona (marca ultimo_em) para não repetir cidade dentro de N dias.
 *
 * Gate: CRON_SECRET (header x-cron-secret). Desligável por env INDICE_REFORCO=0. Lote via
 * INDICE_REFORCO_LOTE (default 3, máx 6). Janela de rotação via INDICE_REFORCO_DIAS (default 14).
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { anthropicFetch } from './_claude.js';
import { norm, extractText, parseJSON, promptIndice, montarAmostras } from './_indice-core.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;
const CRON_SECRET  = process.env.CRON_SECRET;
const MODEL = 'claude-sonnet-4-6';

async function rpc(name, body) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return r.ok ? r.json().catch(() => null) : null;
}

// upsert do estado de rotação (PK cidade_norm,uf) — evita reforçar a mesma cidade toda hora.
async function marcarEstado(cn, uf, patch) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/indice_reforco_estado?on_conflict=cidade_norm,uf`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify({ cidade_norm: cn, uf, ...patch }),
    });
  } catch { /* melhor esforço */ }
}

// Busca FRESCA e arrojada (4 tipos) de uma cidade e semeia indice_amostras. Reusa o núcleo do
// gerador ao vivo (mesmo prompt/parse/montagem) — o reforço nunca diverge da geração real.
async function reforcarCidade(cidade, uf) {
  const cidadeNorm = norm(cidade);
  const t0 = Date.now();
  const headers = { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-beta': 'web-search-2025-03-05' };
  const buscar = async (webUses, timeoutMs) => {
    const r = await anthropicFetch({
      method: 'POST', headers,
      body: JSON.stringify({
        model: MODEL, max_tokens: 16000,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: webUses }],
        system: 'Perito avaliador. Cubra os 4 tipos (apartamento, casa, terreno, comercial) e marque o "tipo" de CADA amostra. Só mercado livre (descarte leilão). Retorne apenas JSON válido.',
        messages: [{ role: 'user', content: promptIndice({ tipo: 'todos', cidade, uf }) }],
      }),
    }, { retries: 0, timeoutMs, noFallback: true });
    if (!r.ok) throw new Error(`anthropic_http_${r.status}`);
    return parseJSON(extractText(await r.json())); // null se truncou
  };
  try {
    // 1ª arrojada (8 buscas); se travar/truncar, 2ª ESTREITA (3) que conclui (igual ao gerador ao vivo).
    let mercado = null;
    try { mercado = await buscar(8, 150000); } catch { mercado = null; }
    if (!mercado) { try { mercado = await buscar(3, 70000); } catch { mercado = null; } }
    if (!mercado) return { cidade, uf, erro: 'busca instável', ms: Date.now() - t0 };
    const amostras = montarAmostras(mercado, { cidadeNorm, uf, bairroNorm: null, lat: null, lng: null, tipo: 'todos', todos: true });
    let inseridas = 0;
    if (amostras.length) inseridas = (await rpc('ingerir_amostras_indice', { p_amostras: amostras })) || 0;
    return { cidade, uf, amostras: amostras.length, inseridas, ms: Date.now() - t0 };
  } catch (e) {
    return { cidade, uf, erro: String(e?.message || e).slice(0, 120), ms: Date.now() - t0 };
  }
}

export default async function handler(req, res) {
  // Só o agendador da Vercel (ou o dono via header) dispara.
  const secret = req.headers['x-cron-secret'] || String(req.headers['authorization'] || '').replace(/^Bearer\s+/i, '');
  if (!CRON_SECRET || secret !== CRON_SECRET) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!CLAUDE_KEY || !SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'serviço indisponível' }); return; }
  if (process.env.INDICE_REFORCO === '0') { res.status(200).json({ ok: true, desligado: true }); return; }

  const LOTE = Math.max(1, Math.min(6, Number(process.env.INDICE_REFORCO_LOTE || 3)));
  const DIAS = Math.max(1, Number(process.env.INDICE_REFORCO_DIAS || 14));
  const cidades = (await rpc('indice_reforco_proximas', { p_n: LOTE, p_dias: DIAS, p_min_amostras: 60 })) || [];
  if (!Array.isArray(cidades) || !cidades.length) { res.status(200).json({ ok: true, reforcadas: [], nota: 'nada elegível' }); return; }

  // Reforça em PARALELO (I/O-bound); cada cidade tem timeout < maxDuration. Marca o estado de
  // cada uma (mesmo em erro) para a rotação seguir em frente e não travar no mesmo lote.
  const resultados = await Promise.all(cidades.map(async (c) => {
    const r = await reforcarCidade(c.cidade, c.uf);
    await marcarEstado(c.cidade_norm, c.uf, {
      ultimo_em: new Date().toISOString(),
      amostras_ultimo: r.amostras || 0,
      inseridas_ultimo: r.inseridas || 0,
      ultimo_erro: r.erro || null,
    });
    return r;
  }));
  const inseridasTotal = resultados.reduce((a, r) => a + (r.inseridas || 0), 0);
  console.log('[indice-reforco]', JSON.stringify({ lote: LOTE, inseridasTotal, cidades: resultados.map(r => `${r.cidade}/${r.uf}:${r.inseridas ?? r.erro}`) }));
  res.status(200).json({ ok: true, lote: LOTE, inseridas_total: inseridasTotal, reforcadas: resultados });
}
