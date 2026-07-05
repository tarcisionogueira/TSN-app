/**
 * /api/enriquecer-backfill-cron — completa o banco (DATA do leilão) de imóveis sem
 * data, PRIORIZANDO as cidades de interesse dos usuários (perfis.cidades_interesse).
 * Assim o gasto de Bright Data segue a DEMANDA real, não o tamanho do acervo.
 *
 * Scraper-first e econômico: só busca quem NÃO tem data (nunca sobrescreve), lê a
 * PÁGINA do lote (reusa fetchLote/extrairDataLeilao), respeita o TETO semanal do
 * Bright Data (fetchViaBrightData corta sozinho) e para de martelar quando começa a
 * vir vazio (sinal de teto atingido). Reveza por enriquecido_em. CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { fetchLote, extrairDataLeilao } from './enriquecer-lote.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const LOTE_MAX = parseInt(process.env.ENRIQUECER_BACKFILL_LOTE || '40', 10); // 30–50/execução

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function marcar(id, patch) {
  await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  }).catch(() => {});
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // 1) Cidades de interesse dos usuários (prioridade do backfill).
  let cidadeSet = new Set();
  try {
    const rows = await (await sb('perfis?cidades_interesse=not.is.null&select=cidades_interesse&limit=1000')).json();
    for (const r of (Array.isArray(rows) ? rows : [])) {
      for (const c of (Array.isArray(r?.cidades_interesse) ? r.cidades_interesse : [])) {
        if (c?.cidade) cidadeSet.add(String(c.cidade).trim().toLowerCase());
      }
    }
  } catch { /* sem cidades → backfill geral */ }

  // 2) Pool de candidatos: sem data, não venda direta, ativo, com página de lote.
  //    Puxa um pool maior e ordena as CIDADES DOS USUÁRIOS primeiro (in-memory,
  //    evita o encoding frágil do filtro in.() com acentos/espaços).
  const filtro = [
    'data_leilao=is.null',
    'modalidade=not.ilike.*venda*direta*',
    'ativo=not.is.false',
    'select=id,url_lote,link_edital,cidade,fonte',
    'order=enriquecido_em.asc.nullsfirst',
    `limit=${LOTE_MAX * 5}`,
  ].join('&');
  const pool = await (await sb(`imoveis_leilao?${filtro}`)).json().catch(() => []);
  if (!Array.isArray(pool) || !pool.length) {
    res.status(200).json({ ok: true, processados: 0, com_data: 0, motivo: 'sem_candidatos' }); return;
  }
  if (cidadeSet.size) {
    pool.sort((a, b) => {
      const pa = cidadeSet.has(String(a.cidade || '').toLowerCase()) ? 0 : 1;
      const pb = cidadeSet.has(String(b.cidade || '').toLowerCase()) ? 0 : 1;
      return pa - pb; // cidades dos usuários primeiro (sort estável preserva a ordem por enriquecido_em)
    });
  }
  const lista = pool.slice(0, LOTE_MAX);

  let comData = 0, semConteudo = 0, prioridade = 0;
  const agora = new Date().toISOString();
  for (const im of lista) {
    if (cidadeSet.has(String(im.cidade || '').toLowerCase())) prioridade++;
    const alvo = im.url_lote || im.link_edital;
    const patch = { enriquecido_em: agora };
    if (alvo && /^https?:\/\//.test(alvo)) {
      const { html } = await fetchLote(alvo);
      if (html) {
        const d = extrairDataLeilao(html);
        if (d) { patch.data_leilao = d; comData++; }
      } else {
        semConteudo++;
        // Vazio recorrente = teto do Bright Data atingido → para de martelar.
        if (semConteudo >= 5) { await marcar(im.id, patch); break; }
      }
    }
    await marcar(im.id, patch);
  }

  res.status(200).json({ ok: true, processados: lista.length, com_data: comData, sem_conteudo: semConteudo, de_cidades_de_usuarios: prioridade });
}
