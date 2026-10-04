/**
 * Cron diário — REGRA DE NÃO-ARREMATAÇÃO.
 * Apaga as análises geradas (analises_mercado) que NÃO foram arrematadas após o
 * leilão. Se arrematado, NUNCA apaga (vira operação real / portfólio).
 *
 *  - praça conhecida  → apaga 15 dias após a ÚLTIMA praça, sem arrematar.
 *  - sem praça em lugar nenhum (lote manual etc.) → fallback de 60 dias após a criação.
 *
 * A decisão é por (user_id, imovel_id) e apaga mercadológico + documental + laudo JUNTOS.
 * Antes era por tabela, e como a `data_leilao` costuma vir preenchida na mercadológica e nula
 * na documental, o mercadológico vencia sozinho: o cliente ficava com a análise pela metade,
 * com cara de relatório que sumiu. Detalhes em `supabase/migrations/analises_retencao_por_imovel.sql`.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { logAtividade } from './_atividade.js';

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

  // EVENTO 'relatorio_stale' (05/10, pendência 81): o rebaixamento na TELA (AnalisesContext,
  // 9 min) não deixa rastro — relatório preso só existia no navegador de quem esperava. Aqui
  // grava no atividade_log (Cliente 360) cada linha 'gerando' há > 9 min, ANTES do destrave
  // abaixo mudar o status. Dedup por id: consulta o que já foi registrado; se a consulta
  // falhar, NÃO registra (melhor faltar um evento hoje do que duplicar todo dia).
  const corteStale = new Date(Date.now() - 9 * 60000).toISOString();
  const stale = {};
  for (const tabela of ['analises_mercado', 'analises_documental', 'analises_laudo']) {
    try {
      const rs = await sb(`${tabela}?status=eq.gerando&updated_at=lt.${corteStale}&select=id,user_id,imovel_id,updated_at&limit=200`);
      if (!rs.ok) { stale[tabela] = { erro: `leitura HTTP ${rs.status}` }; continue; }
      const linhas = (await rs.json().catch(() => null));
      if (!Array.isArray(linhas)) { stale[tabela] = { erro: 'leitura sem JSON' }; continue; }
      if (!linhas.length) { stale[tabela] = { registrados: 0 }; continue; }
      const ids = linhas.map(l => l.id).join(',');
      const rd = await sb(`atividade_log?evento=eq.relatorio_stale&meta->>registro_id=in.(${ids})&select=rid:meta->>registro_id`);
      if (!rd.ok) { stale[tabela] = { erro: `dedup HTTP ${rd.status}`, pendentes: linhas.length }; continue; }
      const ja = new Set(((await rd.json().catch(() => [])) || []).map(x => x.rid));
      let n = 0;
      for (const l of linhas) {
        if (ja.has(l.id) || !l.user_id) continue;
        await logAtividade(l.user_id, 'relatorio_stale', `Relatório preso em "gerando" (${tabela})`,
          { registro_id: l.id, tabela, imovel_id: l.imovel_id, gerando_desde: l.updated_at });
        n++;
      }
      stale[tabela] = { registrados: n, ja_registrados: linhas.length - n };
    } catch (e) { stale[tabela] = { erro: String(e?.message || e).slice(0, 120) }; }
  }
  out.stale = stale;
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

  // A RPC passou a decidir por IMÓVEL (12/08) e devolve {imoveis, mercado, documental, laudo}.
  // O formato antigo era por tabela ({analises_mercado: {por_leilao, sem_data}, ...}) e some daqui
  // junto com ele — somar chave que não existe mais daria `total: 0` com a limpeza funcionando,
  // que é exatamente o tipo de zero que este repositório passou o dia inteiro caçando.
  const total = (apagados?.mercado || 0) + (apagados?.documental || 0) + (apagados?.laudo || 0);

  // TTL do log de atividade (Cliente 360): apaga o que passou de apagar_em (90d por padrão)
  // — não deixa o histórico acumular lixo no banco.
  let atividadeApagadas = 0;
  try {
    const ra = await sb('rpc/atividade_log_limpar', { method: 'POST', body: '{}' });
    atividadeApagadas = ra.ok ? (Number(await ra.json().catch(() => 0)) || 0) : 0;
  } catch { /* best-effort */ }

  return res.status(200).json({ ok: true, destravadas: out, apagados, total, atividade_apagadas: atividadeApagadas });
}
