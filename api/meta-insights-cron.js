/**
 * GET /api/meta-insights-cron — puxa da META INSIGHTS API (leitura) o gasto/cliques/
 * impressões DIÁRIOS por campanha dos últimos 7 dias e grava em marketing_metricas_dia
 * (upsert → reexecuções corrigem retroativamente). Alimenta o painel Marketing (CAC/ROAS
 * automáticos do canal Meta Ads).
 *
 * DORMENTE até existirem META_ADS_TOKEN (token com ads_read do Business) e
 * META_AD_ACCOUNT_ID (ex.: act_1114056112873901). Guard: `isCronAuthorized` (padrão dos crons).
 * Somente LEITURA no Meta — este token não gerencia campanhas nem gasta orçamento.
 *
 * ⚠️ CONSERTO 18/08 — ELE NUNCA RODOU UMA VEZ SEQUER. O guard era artesanal e lia só
 * `x-cron-secret` e a presença de `x-vercel-cron`; o Vercel Cron autentica mandando
 * **`Authorization: Bearer <CRON_SECRET>`**, que este handler não olhava. Resultado medido
 * no log de produção: `08:10:39 GET /api/meta-insights-cron 401`, todo dia, no minuto exato
 * do agendamento. Morria na porta — nem chegava a testar as envs do Meta.
 *
 * A armadilha para quem for diagnosticar isto de novo: a resposta ESPERADA sem as envs é
 * `200 {skipped:'dormente'}`, e é fácil ler o silêncio em `marketing_metricas_dia` como
 * "ainda não configurei o token". Eram duas ausências empilhadas, e a de cima escondia a
 * de baixo. Era o ÚNICO cron do vercel.json com guard próprio incapaz de ler o Bearer —
 * todos os outros usam `isCronAuthorized`, que aceita as duas formas. Por isso o conserto
 * é adotar o helper, e não remendar o guard: cópia da regra de auth foi o que divergiu.
 */
// Sem `config`, herdava o default da Vercel — e este cron faz várias chamadas à Graph API
// em série (7 dias × campanhas) antes de gravar. Cortado no meio, ele grava METADE do
// período e devolve sucesso: o painel de CAC/ROAS mostra número menor sem nada indicar
// que faltou dado. Marketing errado para baixo é pior que marketing ausente. (11/08)
export const config = { runtime: 'nodejs', maxDuration: 120 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const API_VER = (process.env.META_GRAPH_VERSION || 'v21.0').trim();

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'nao_autorizado' });

  const token = (process.env.META_ADS_TOKEN || '').trim();
  let conta = (process.env.META_AD_ACCOUNT_ID || '').trim();
  if (!token || !conta) return res.status(200).json({ skipped: 'dormente', dica: 'Defina META_ADS_TOKEN e META_AD_ACCOUNT_ID no Vercel.' });
  if (!conta.startsWith('act_')) conta = `act_${conta}`;

  const ate = new Date();
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const fmt = (d) => d.toISOString().slice(0, 10);

  try {
    const url = `https://graph.facebook.com/${API_VER}/${encodeURIComponent(conta)}/insights` +
      `?level=campaign&time_increment=1` +
      `&time_range=${encodeURIComponent(JSON.stringify({ since: fmt(desde), until: fmt(ate) }))}` +
      `&fields=campaign_name,spend,clicks,impressions&limit=200` +
      `&access_token=${encodeURIComponent(token)}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      console.error('[meta-insights] HTTP', r.status, JSON.stringify(body?.error || body).slice(0, 300));
      return res.status(502).json({ error: 'meta_api', http: r.status, detalhe: body?.error?.message || null });
    }
    const rows = (body?.data || []).map(d => ({
      data: d.date_start,
      canal: 'Meta Ads',
      campanha: String(d.campaign_name || '').slice(0, 120),
      gasto: Math.max(0, Number(d.spend) || 0),
      cliques: Math.max(0, Math.trunc(Number(d.clicks) || 0)),
      impressoes: Math.max(0, Math.trunc(Number(d.impressions) || 0)),
      conversoes: null,
      atualizado_em: new Date().toISOString(),
    })).filter(x => /^\d{4}-\d{2}-\d{2}$/.test(String(x.data || '')));

    if (rows.length) {
      const { error } = await supabase.from('marketing_metricas_dia')
        .upsert(rows, { onConflict: 'data,canal,campanha' });
      if (error) throw new Error(error.message);
    }
    return res.status(200).json({ ok: true, gravadas: rows.length });
  } catch (e) {
    console.error('[meta-insights]', e?.message || e);
    return res.status(500).json({ error: String(e?.message || e) });
  }
}
