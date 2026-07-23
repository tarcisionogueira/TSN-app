/**
 * Cron diário — REGRA DE NÃO-ARREMATAÇÃO.
 * Apaga as análises geradas (analises_mercado) que NÃO foram arrematadas após o
 * leilão. Se arrematado, NUNCA apaga (vira operação real / portfólio).
 *
 *  - data_leilao conhecida  → apaga 15 dias após o leilão sem arrematar.
 *  - sem data_leilao (lote manual etc.) → fallback de 60 dias após a criação.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const DIAS_POS_LEILAO = Number(process.env.ANALISE_LIMPAR_DIAS || 15);
const DIAS_SEM_DATA   = Number(process.env.ANALISE_LIMPAR_DIAS_SEM_DATA || 60);

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const out = {};

  // Recuperação de análises TRAVADAS: a função de geração (maxDuration 5 min) pode
  // morrer sem gravar o resultado, deixando a linha em 'gerando' e o app girando.
  // Após 15 min, marca como 'erro' para o usuário poder gerar de novo. Backstop do
  // banco — o app já se recupera sozinho na tela (STALE_GERANDO_MS no contexto).
  const corteGerando = new Date(Date.now() - 15 * 60000).toISOString();
  for (const tabela of ['analises_mercado', 'analises_documental', 'analises_laudo']) {
    try {
      const rg = await sb(`${tabela}?status=eq.gerando&updated_at=lt.${corteGerando}&select=id`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'erro', erro: 'Geração excedeu o tempo limite (função encerrada). Gere novamente.', updated_at: new Date().toISOString() }),
      });
      out[`${tabela}_destravadas`] = rg.ok ? ((await rg.json().catch(() => [])).length || 0) : 0;
    } catch { out[`${tabela}_destravadas`] = 0; }
  }

  // Regra 15d pós-leilão (ou 60d sem data) para não-arrematados. GUARDA: preserva a
  // análise se o imóvel segue ATIVO com data_leilao FUTURA (2ª praça/re-agendamento) —
  // senão o relatório sumia com o imóvel ainda listado. Feito na RPC atômica.
  let apagados = {};
  try {
    const rr = await sb('rpc/limpar_analises_orfas', {
      method: 'POST',
      body: JSON.stringify({ p_dias: DIAS_POS_LEILAO, p_dias_sem_data: DIAS_SEM_DATA }),
    });
    apagados = rr.ok ? (await rr.json().catch(() => ({}))) : { erro: `rpc HTTP ${rr.status}` };
  } catch (e) { apagados = { erro: String(e.message).slice(0, 120) }; }

  const total = ['analises_mercado', 'analises_documental']
    .reduce((s, t) => s + ((apagados[t]?.por_leilao || 0) + (apagados[t]?.sem_data || 0)), 0);

  // TTL do log de atividade (Cliente 360): apaga o que passou de apagar_em (90d por padrão)
  // — não deixa o histórico acumular lixo no banco.
  let atividadeApagadas = 0;
  try {
    const ra = await sb('rpc/atividade_log_limpar', { method: 'POST', body: '{}' });
    atividadeApagadas = ra.ok ? (Number(await ra.json().catch(() => 0)) || 0) : 0;
  } catch { /* best-effort */ }

  return res.status(200).json({ ok: true, destravadas: out, apagados, total, atividade_apagadas: atividadeApagadas });
}
