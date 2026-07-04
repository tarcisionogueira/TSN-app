/**
 * /api/monitor-fontes-cron — monitor de regressão das fontes de leiloeiros.
 *
 * Lê a tabela fonte_saude (1 linha por fonte por execução do scraper) e alerta
 * por e-mail quando uma conexão que já funcionava quebra ou piora:
 *   - fonte esperada sem coleta recente (>36h) → scraper parou / seletor mudou
 *   - status 'falhou' (0 imóveis) ou 'degradado' (validação de qualidade reprovou)
 *   - queda de volume registrada pelo próprio scraper
 * Só envia e-mail se houver problema. Idempotente. Autorizado por CRON_SECRET.
 *
 * Roda 1x/dia após o scraper diário (vercel.json).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { createClient } from '@supabase/supabase-js';

const RESEND_KEY  = process.env.RESEND_API_KEY;
const FROM_EMAIL  = process.env.APP_FROM_EMAIL || 'noreply@bidprobrasil.com.br';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br';
const APP_URL     = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

// Fontes que o scraper Puppeteer deve reportar a cada execução.
// LJUD fora por ora (parqueado — exige navegador real; ver scraper-puppeteer.mjs).
const FONTES_ESPERADAS = ['MEGA', 'SUPERBID', 'SOLD', 'ZUK', 'SODRE', 'FRAZAO'];
const MAX_IDADE_H = 36; // sem coleta há mais que isso = alerta

export default async function handler(req) {
  if (!isCronAuthorized(req)) return new Response('unauthorized', { status: 401 });
  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500 });
  }
  const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const desde = new Date(Date.now() - 5 * 24 * 3600 * 1000).toISOString();
  const { data: linhas, error } = await supabase
    .from('fonte_saude')
    .select('fonte,total,status,motivo,estrategia,uf_pct,valor_pct,link_pct,foto_pct,executado_em')
    .gte('executado_em', desde)
    .order('executado_em', { ascending: false });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });

  // Última linha por fonte.
  const ultima = {};
  for (const l of linhas || []) if (!ultima[l.fonte]) ultima[l.fonte] = l;

  const agoraMs = Date.now();
  const problemas = [];
  for (const fonte of FONTES_ESPERADAS) {
    const u = ultima[fonte];
    if (!u) { problemas.push({ fonte, tipo: 'sem coleta', detalhe: `nenhuma execução nos últimos 5 dias` }); continue; }
    const idadeH = (agoraMs - new Date(u.executado_em).getTime()) / 3600000;
    if (idadeH > MAX_IDADE_H) {
      problemas.push({ fonte, tipo: 'coleta parada', detalhe: `última coleta há ${idadeH.toFixed(0)}h (${u.total} imóveis)` });
    } else if (u.status === 'falhou') {
      problemas.push({ fonte, tipo: 'falhou (0 imóveis)', detalhe: u.motivo || 'coleta zerada' });
    } else if (u.status === 'degradado') {
      problemas.push({ fonte, tipo: 'degradado', detalhe: `${u.total} imóveis — ${u.motivo || 'qualidade abaixo do critério'}` });
    }
  }

  if (!problemas.length) {
    return new Response(JSON.stringify({ ok: true, problemas: 0, fontes: Object.keys(ultima).length }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const agora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  if (RESEND_KEY) {
    const linhasHtml = problemas.map(p => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:700">${p.fonte}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;color:#dc2626">${p.tipo}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee">${p.detalhe}</td>
      </tr>`).join('');
    const html = `
      <div style="font-family:sans-serif;max-width:640px;margin:0 auto">
        <div style="background:#dc2626;color:white;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="margin:0">🔴 Fontes de leilão com problema (${problemas.length})</h2>
          <p style="margin:8px 0 0;opacity:.9">${agora} (BRT)</p>
        </div>
        <div style="background:#fff;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:20px">
          <table style="width:100%;border-collapse:collapse;font-size:14px">
            <thead><tr style="text-align:left;color:#64748b">
              <th style="padding:8px 12px">Fonte</th><th style="padding:8px 12px">Problema</th><th style="padding:8px 12px">Detalhe</th>
            </tr></thead>
            <tbody>${linhasHtml}</tbody>
          </table>
          <p style="margin-top:16px;color:#64748b;font-size:13px">O acervo de imóveis dessas fontes continua no ar (o scraper não apaga em coleta ruim); o alerta é para reconectar/ajustar o parser.</p>
          <a href="${APP_URL}/#/admin" style="display:inline-block;margin-top:8px;background:#0D63DB;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:700">Abrir Admin →</a>
        </div>
      </div>`;
    try {
      await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: FROM_EMAIL, to: ADMIN_EMAIL, subject: `🔴 BidPro — ${problemas.length} fonte(s) de leilão com problema`, html }),
      });
    } catch (e) { /* não bloqueia o retorno */ }
  }

  return new Response(JSON.stringify({ ok: true, problemas: problemas.length, detalhes: problemas }), {
    headers: { 'Content-Type': 'application/json' },
  });
}
