/**
 * Disparo das coletas diárias pelo cron da Vercel (pendência 507, 17/11).
 *
 * O agendamento do GitHub Actions ATRASA: medido em 15–17/11, todo workflow diário começou 9–10 h depois do
 * horário marcado (o CEF das 09:00 começava ~18:30; o diário de leiloeiros das 10:00, ~19:30). O cron da Vercel
 * dispara na hora, então ele é quem acorda as coletas que dependem de horário; o `schedule` de cada workflow
 * continua lá como REDE DE SEGURANÇA e se pula sozinho (job `gate`) quando este disparo já rodou nas últimas 20 h.
 *
 * Um cron só na Vercel ("3 9,10,22 * * *"); a hora UTC escolhe o workflow. O `origem: agenda` vira o título da
 * execução (`run-name` com "[agenda]") — é por ele que o `gate` reconhece este disparo e não um manual de teste.
 * Autorizado por CRON_SECRET. Sem GITHUB_ACTIONS_TOKEN não há o que fazer: responde 500 (o health-check vê o
 * cron falhando) em vez de 200 calado.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { isCronAuthorized } from './_auth.js';

const REPO = 'tarcisionogueira/TSN-app';
// Hora UTC → workflows. Mudou o horário aqui, mude o cron em vercel.json junto.
export const AGENDA = {
  9: ['scraper.yml'],                 // CEF (CSV grátis)
  10: ['leiloeiros-puppeteer.yml'],   // diário de leiloeiros (3 grupos em paralelo)
  22: ['scraper-prazo-curto.yml'],    // 2ª coleta das fontes de prazo curto (#504), ~12 h depois do diário
};

export function workflowsDaHora(hora, pedido) {
  if (pedido) return Object.values(AGENDA).flat().includes(pedido) ? [pedido] : [];
  return AGENDA[hora] || [];
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) return res.status(401).json({ error: 'Não autorizado' });
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) return res.status(500).json({ ok: false, erro: 'GITHUB_ACTIONS_TOKEN ausente' });

  // `?wf=` só para disparo manual de teste, e só dentro da agenda (nunca um workflow arbitrário).
  const pedido = typeof req.query?.wf === 'string' ? req.query.wf : '';
  const alvo = workflowsDaHora(new Date().getUTCHours(), pedido);
  if (!alvo.length) return res.status(200).json({ ok: true, disparados: [], motivo: pedido ? 'wf fora da agenda' : 'nada agendado nesta hora' });

  const resultados = [];
  for (const wf of alvo) {
    try {
      const r = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: 'main', inputs: { origem: 'agenda' } }),
        signal: AbortSignal.timeout(15000),
      });
      resultados.push({ wf, ok: r.status === 204, status: r.status, erro: r.status === 204 ? undefined : (await r.text()).slice(0, 200) });
    } catch (e) {
      resultados.push({ wf, ok: false, erro: e.message });
    }
  }
  const ok = resultados.every((r) => r.ok);
  if (!ok) console.error('[disparar-coletas-cron] falha ao disparar:', JSON.stringify(resultados));
  return res.status(ok ? 200 : 502).json({ ok, disparados: resultados });
}
