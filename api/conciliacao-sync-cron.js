/**
 * /api/conciliacao-sync-cron — puxa o extrato das contas conectadas sozinho, todo dia.
 *
 * PERGUNTA DO DONO (08/08): "Precisa mesmo ter que importar o extrato? Você não tem acesso a
 * puxar dos bancos que já está conectado?"
 *
 * Tem — e a resposta certa é esta: o botão "Importar" nunca devia ser o caminho normal. Ele
 * existia porque eu comecei pela tela, e quem lembra de apertar um botão de importação todo dia
 * é ninguém. O extrato passa a entrar sozinho; o botão fica só como "atualizar agora" para quem
 * quer ver o movimento de hoje sem esperar a próxima rodada.
 *
 * JANELA DE 45 DIAS, não do mês corrente: gateway reprocessa, estorno cai depois, e recebimento
 * de boleto entra com data retroativa. Reimportar é seguro — a chave (banco, chave_origem) torna
 * a operação idempotente, então o mesmo lançamento nunca duplica.
 *
 * Depois de importar, classifica: credor conhecido → conta dele; senão regra; senão 9.9, visível.
 */
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const BASE = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';
const DIAS = Number(process.env.CONCILIACAO_SYNC_DIAS || 45);

const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts,
  headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'Supabase não configurado' }); return; }

  // O extrato é lido pela rota interna, que já sabe falar com Asaas e Mercado Pago. Ela exige
  // admin; o cron usa o CRON_SECRET, que ela também aceita — assim não há uma segunda cópia da
  // lógica de leitura das contas para dessincronizar.
  const r = await fetch(`${BASE}/api/financeiro-extrato?dias=${DIAS}&lista=completa`, {
    headers: { 'x-cron-secret': process.env.CRON_SECRET || '' },
  });
  if (!r.ok) {
    const det = await r.text().catch(() => '');
    console.error('[conciliacao-sync] extrato', r.status, det.slice(0, 200));
    res.status(502).json({ error: 'Falha ao ler o extrato das contas', status: r.status });
    return;
  }
  const ext = await r.json();
  const linhas = (ext.lancamentos || [])
    .filter(l => l.data && l.id)
    .map(l => ({
      banco: l.banco, chave_origem: l.id, data: l.data, descricao: l.descricao || '',
      direcao: l.direcao, valor_bruto: l.bruto, valor_liquido: l.liquido, taxa: l.taxa,
      metodo: l.metodo, classificado_por: 'pendente',
    }));

  let gravados = 0;
  if (linhas.length) {
    const up = await sb('conciliacao_lancamento?on_conflict=banco,chave_origem', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(linhas),
    });
    if (!up.ok) {
      const det = await up.text().catch(() => '');
      console.error('[conciliacao-sync] upsert', up.status, det.slice(0, 300));
      res.status(502).json({ error: 'Falha ao gravar os lançamentos' });
      return;
    }
    gravados = linhas.length;
  }

  // MÍDIA PAGA (08/08): o custo operacional é pago pelo cartão do Mercado Pago e entra pelo
  // extrato acima — MENOS o Google Ads, que não aceita cartão pré-pago. Esse gasto ficava
  // fora da contabilidade inteira. Como o script do Google já alimenta `marketing_metricas_dia`
  // todo dia, a ponte transforma aquele dado em lançamento na conta 6.1. Origem própria
  // ("Google Ads (mídia)") para nunca se confundir com extrato bancário, e idempotente por
  // dia+campanha. Best-effort: mídia é complemento — se falhar, não derruba a conciliação.
  let midia = null;
  try {
    const m = await sb('rpc/midia_para_conciliacao', { method: 'POST', body: JSON.stringify({ p_desde: null }) });
    midia = m.ok ? await m.json().catch(() => null) : null;
    if (!m.ok) console.error('[conciliacao-sync] midia', m.status, (await m.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('[conciliacao-sync] midia erro', e?.message); }

  // TAXA DE GATEWAY (08/08): já era capturada, mas ficava numa coluna do lançamento e nunca
  // chegava à conta 4.1. Na DRE, "Deduções da receita" aparecia zerada mesmo havendo taxa, e
  // a receita entrava pelo bruto sem o custo de receber — erro que cresce na proporção do
  // faturamento. Também best-effort, pelo mesmo motivo da mídia.
  let taxas = null;
  try {
    const t = await sb('rpc/taxas_para_conciliacao', { method: 'POST', body: JSON.stringify({ p_desde: null }) });
    taxas = t.ok ? await t.json().catch(() => null) : null;
    if (!t.ok) console.error('[conciliacao-sync] taxas', t.status, (await t.text().catch(() => '')).slice(0, 200));
  } catch (e) { console.error('[conciliacao-sync] taxas erro', e?.message); }

  const cl = await sb('rpc/conciliacao_classificar', { method: 'POST', body: JSON.stringify({ p_competencia: null }) });
  const classificados = cl.ok ? await cl.json().catch(() => 0) : 0;

  // Quantos ainda estão sem conta: é o número que diz se a DRE do mês fecha. Aparece no log
  // mesmo quando é zero — silêncio não distingue "nada pendente" de "cron parou".
  const pend = await (await sb('conciliacao_lancamento?conta=eq.9.9&select=id&limit=1000')).json().catch(() => []);
  console.log('[conciliacao-sync]', JSON.stringify({ lidos: linhas.length, gravados, classificados, midia, taxas, a_classificar: pend.length, avisos: ext.avisos }));
  res.status(200).json({ ok: true, lidos: linhas.length, gravados, classificados, midia, taxas, a_classificar: pend.length, avisos: ext.avisos });
}
