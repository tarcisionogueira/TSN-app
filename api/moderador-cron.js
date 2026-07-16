/**
 * Cron do AGENTE MODERADOR (semanal). Chama a RPC determinística
 * moderador_gerar_insights() — sem LLM (economia) — que destila padrões dos demais
 * agentes (calibração previsto×realizado, custo Bright Data, dívida de mapeamento,
 * saúde das fontes) para a tabela moderador_insights. Retorna os críticos no payload.
 * Autorizado por CRON_SECRET (header x-cron-secret).
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY   = process.env.RESEND_API_KEY;
const FROM_EMAIL   = process.env.APP_FROM_EMAIL || 'noreply@bidprobrasil.com.br';
const ADMIN_EMAIL  = process.env.ADMIN_EMAIL || 'tarcisioaraujo@reimob.com.br';

const CLAUDE_KEY = process.env.CLAUDE_KEY;
const COR = { critico: '#dc2626', atencao: '#d97706', info: '#0D63DB' };

// Camada LLM (economia: 1 chamada Haiku/semana, só se CLAUDE_KEY existir). Sintetiza
// os insights determinísticos num parecer executivo + direcionamentos por especialista.
async function sintetizarComIA(insights) {
  if (!CLAUDE_KEY || !insights.length) return null;
  const prompt = `Você é o AGENTE MODERADOR de uma plataforma de leilões. Abaixo, insights determinísticos da semana (JSON). Escreva em PT-BR, curto e acionável:
1) Um parecer executivo (2-3 frases) do estado da operação.
2) Até 3 DIRECIONAMENTOS concretos no formato "→ [agente]: [ação]".
Não invente dados além dos insights. Insights:\n${JSON.stringify(insights).slice(0, 6000)}`;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': CLAUDE_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
      signal: AbortSignal.timeout(25000),
    });
    if (!r.ok) return null;
    const d = await r.json();
    return (d?.content?.[0]?.text || '').trim() || null;
  } catch { return null; }
}

async function enviarRelatorio(insights, sintese) {
  if (!RESEND_KEY || !insights.length) return false;
  const linhas = insights.map(i => `
    <tr>
      <td style="padding:6px 10px;border-bottom:1px solid #eee;color:${COR[i.severidade] || '#334155'};font-weight:700;white-space:nowrap">${(i.severidade || 'info').toUpperCase()}</td>
      <td style="padding:6px 10px;border-bottom:1px solid #eee"><strong>${i.titulo}</strong><br><span style="color:#64748b;font-size:13px">${i.detalhe || ''}</span><br><span style="color:#94a3b8;font-size:11px">→ ${i.agente}</span></td>
    </tr>`).join('');
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL, to: ADMIN_EMAIL,
        subject: `🧭 Moderador — relatório semanal (${insights.length} insights)`,
        html: `<div style="font-family:sans-serif;max-width:640px">
          <h2 style="color:#0D63DB">🧭 Agente Moderador</h2>
          ${sintese ? `<div style="background:#f8fafc;border-left:3px solid #0D63DB;padding:10px 14px;margin:8px 0;white-space:pre-wrap;font-size:14px;color:#334155">${String(sintese).replace(/</g, '&lt;')}</div>` : ''}
          <p style="color:#475569">Padrões destilados da operação — direcionamentos por especialista.</p>
          <table style="border-collapse:collapse;width:100%;font-size:14px">${linhas}</table>
          <p style="color:#94a3b8;font-size:12px;margin-top:16px">Gerado automaticamente. Fonte: moderador_insights.</p></div>`,
      }),
      signal: AbortSignal.timeout(12000),
    });
    return true;
  } catch { return false; }
}

export default async function handler(req, res) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).end();
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  const h = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/moderador_gerar_insights`, {
      method: 'POST', headers: h, body: '{}', signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return res.status(502).json({ error: `rpc moderador ${r.status}` });
    const total = await r.json().catch(() => null);

    // Monitoramento de COBERTURA DE DOCUMENTOS: atualiza o insight docs:cobertura
    // (leiloeiros com lacuna CORRIGÍVEL — ver leiloeiro_conhecimento.docs_estrategia)
    // para entrar no relatório semanal sem eu precisar lembrar. Best-effort.
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/moderador_docs_coverage_insight`, {
        method: 'POST', headers: h, body: '{}', signal: AbortSignal.timeout(15000),
      });
    } catch { /* não bloqueia o relatório */ }

    // SUPERVISÃO DO APRENDIZADO (determinística, zero IA): agentes parados, vícios
    // recorrentes e regens pendentes viram insight no relatório semanal — o moderador
    // supervisiona cada agente que aprende. Best-effort.
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/moderador_supervisao_aprendizado`, {
        method: 'POST', headers: h, body: '{}', signal: AbortSignal.timeout(15000),
      });
    } catch { /* não bloqueia o relatório */ }

    // Relatório completo (ordenado: crítico → atenção → info) + e-mail semanal ao admin.
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/moderador_insights?select=categoria,severidade,agente,titulo,detalhe&order=severidade.asc`, {
      headers: h, signal: AbortSignal.timeout(15000),
    });
    const todos = cr.ok ? (await cr.json().catch(() => [])) : [];
    const ordem = { critico: 0, atencao: 1, info: 2 };
    todos.sort((a, b) => (ordem[a.severidade] ?? 9) - (ordem[b.severidade] ?? 9));
    const sintese = await sintetizarComIA(todos);
    if (sintese) {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/moderador_insights`, {
          method: 'POST', headers: { ...h, Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify({ chave: 'sintese:semana', categoria: 'sintese', severidade: 'info', agente: 'moderador', titulo: 'Parecer semanal (IA)', detalhe: sintese.slice(0, 2000), gerado_em: new Date().toISOString() }),
        });
      } catch { /* opcional */ }
    }
    const emailEnviado = await enviarRelatorio(todos, sintese);
    const relevantes = todos.filter(i => i.severidade === 'atencao' || i.severidade === 'critico');
    return res.status(200).json({ ok: true, insights_total: total, email: emailEnviado, sintese_ia: !!sintese, relevantes });
  } catch (e) {
    return res.status(500).json({ error: String(e.message).slice(0, 200) });
  }
}
