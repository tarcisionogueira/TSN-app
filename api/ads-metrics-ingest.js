/**
 * POST /api/ads-metrics-ingest — recebe métricas diárias de anúncios enviadas pelo
 * GOOGLE ADS SCRIPT (roda agendado dentro do próprio Google Ads e faz POST para cá).
 * Caminho oficial e sem burocracia: dispensa developer token / OAuth da Google Ads API.
 *
 * Segurança: header `x-ads-secret` deve bater com a env ADS_INGEST_SECRET (comparação
 * timing-safe). DORMENTE até a env existir. Payload limitado (200 linhas) e validado —
 * só grava números em marketing_metricas_dia (upsert por data+canal+campanha), nada mais.
 * Reenvio dos últimos 7 dias a cada execução corrige valores retroativamente.
 */
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

const CANAIS_OK = new Set(['Google Ads', 'Meta Ads', 'Outro']);
const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method' });

  const secret = (process.env.ADS_INGEST_SECRET || '').trim();
  if (!secret) return res.status(503).json({ error: 'ingest_inativo', dica: 'Defina ADS_INGEST_SECRET no Vercel.' });
  const recebido = String(req.headers['x-ads-secret'] || '');
  const okSecret = recebido.length === secret.length &&
    crypto.timingSafeEqual(Buffer.from(recebido), Buffer.from(secret));
  if (!okSecret) return res.status(401).json({ error: 'nao_autorizado' });

  const linhas = Array.isArray(req.body?.linhas) ? req.body.linhas.slice(0, 200) : [];
  // `termos` (18/08): termos de PESQUISA — o que as pessoas digitaram. Opcional: o script
  // antigo (só `linhas`) continua funcionando; o novo manda os dois.
  const termos = Array.isArray(req.body?.termos) ? req.body.termos.slice(0, 500) : [];
  if (!linhas.length && !termos.length) return res.status(400).json({ error: 'sem_linhas' });

  const rows = [];
  for (const l of linhas) {
    const data = String(l?.data || '').slice(0, 10);
    const canal = CANAIS_OK.has(l?.canal) ? l.canal : 'Google Ads';
    if (!DATA_RE.test(data)) continue;
    rows.push({
      data,
      canal,
      campanha: String(l?.campanha || '').slice(0, 120),
      gasto: Math.max(0, Number(l?.gasto) || 0),
      cliques: Math.max(0, Math.trunc(Number(l?.cliques) || 0)),
      impressoes: Math.max(0, Math.trunc(Number(l?.impressoes) || 0)),
      conversoes: l?.conversoes == null ? null : Math.max(0, Number(l.conversoes) || 0),
      atualizado_em: new Date().toISOString(),
    });
  }
  if (!rows.length && !termos.length) return res.status(400).json({ error: 'linhas_invalidas' });

  if (rows.length) {
    const { error } = await supabase.from('marketing_metricas_dia')
      .upsert(rows, { onConflict: 'data,canal,campanha' });
    if (error) {
      console.error('[ads-ingest]', error.message);
      return res.status(500).json({ error: 'gravar_falhou' });
    }
  }

  let termosGravados = 0;
  if (termos.length) {
    const tRows = [];
    for (const t of termos) {
      const data = String(t?.data || '').slice(0, 10);
      const termo = String(t?.termo || '').trim().slice(0, 200);
      if (!DATA_RE.test(data) || !termo) continue;
      tRows.push({
        data,
        campanha: String(t?.campanha || '').slice(0, 120),
        termo,
        palavra_chave: t?.palavra_chave ? String(t.palavra_chave).slice(0, 200) : null,
        gasto: Math.max(0, Number(t?.gasto) || 0),
        cliques: Math.max(0, Math.trunc(Number(t?.cliques) || 0)),
        impressoes: Math.max(0, Math.trunc(Number(t?.impressoes) || 0)),
        conversoes: t?.conversoes == null ? null : Math.max(0, Number(t.conversoes) || 0),
        atualizado_em: new Date().toISOString(),
      });
    }
    if (tRows.length) {
      const { error: e2 } = await supabase.from('marketing_termos_dia')
        .upsert(tRows, { onConflict: 'data,campanha,termo' });
      // Termos falharem NÃO derruba as métricas já gravadas — mas fala, nunca engole.
      if (e2) console.error('[ads-ingest] termos:', e2.message);
      else termosGravados = tRows.length;
    }
  }

  return res.status(200).json({ ok: true, gravadas: rows.length, termos: termosGravados });
}
