/**
 * GET /api/meta-insights-cron — puxa da META INSIGHTS API (leitura) o gasto/cliques/
 * impressões DIÁRIOS por campanha dos últimos 7 dias e grava em marketing_metricas_dia
 * (upsert → reexecuções corrigem retroativamente). Alimenta o painel Marketing (CAC/ROAS
 * automáticos do canal Meta Ads).
 *
 * DORMENTE até existirem META_ADS_TOKEN (token com ads_read do Business) e
 * META_AD_ACCOUNT_ID (ex.: act_1114056112873901). Guard: x-cron-secret (padrão dos crons).
 * Somente LEITURA no Meta — este token não gerencia campanhas nem gasta orçamento.
 */
// Sem `config`, herdava o default da Vercel — e este cron faz várias chamadas à Graph API
// em série (7 dias × campanhas) antes de gravar. Cortado no meio, ele grava METADE do
// período e devolve sucesso: o painel de CAC/ROAS mostra número menor sem nada indicar
// que faltou dado. Marketing errado para baixo é pior que marketing ausente. (11/08)
export const config = { runtime: 'nodejs', maxDuration: 120 };

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const API_VER = (process.env.META_GRAPH_VERSION || 'v21.0').trim();

export default async function handler(req, res) {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const recebido = String(req.headers['x-cron-secret'] || '');
  const ehVercelCron = !!req.headers['x-vercel-cron'];
  const okSecret = cronSecret && recebido.length === cronSecret.length &&
    crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(cronSecret));
  if (!okSecret && !ehVercelCron) return res.status(401).json({ error: 'nao_autorizado' });

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
