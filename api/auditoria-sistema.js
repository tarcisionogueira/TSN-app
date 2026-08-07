export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

// GET  — serve o ÚLTIMO relatório de auditoria (só leitura) para o dashboard admin.
// POST — DISPARA a auditoria completa sob demanda (o botão do painel).
// A auditoria em si roda na GitHub Action (scripts/auditoria-claude.mjs).
//
// Por que existe o POST: o agendamento diário da Action foi removido em 07/08. Ele
// varria o repositório inteiro todo dia (~2,1 mi de tokens, ~R$ 43-59 por execução)
// sem passar pelo medidor de uso, e desde 02/08 vinha sendo CANCELADO no timeout —
// pagando a execução inteira e gravando nada. Agora quem decide quando gastar é o
// dono, clicando. Só admin dispara.
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

// Dispara a GitHub Action da auditoria. Mesmo mecanismo já usado para as capturas
// de documento (workflow_dispatch com GITHUB_ACTIONS_TOKEN).
async function dispararAuditoria() {
  const token = process.env.GITHUB_ACTIONS_TOKEN;
  if (!token) return { ok: false, motivo: 'GITHUB_ACTIONS_TOKEN não configurado no painel' };
  try {
    const r = await fetch('https://api.github.com/repos/tarcisionogueira/TSN-app/actions/workflows/auditoria-claude.yml/dispatches', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    if (r.ok) return { ok: true };
    return { ok: false, motivo: `GitHub respondeu ${r.status}` };
  } catch (e) { return { ok: false, motivo: e?.message || 'falha de rede ao chamar o GitHub' }; }
}

export default async function handler(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  if (req.method === 'POST') {
    const r = await dispararAuditoria();
    return new Response(JSON.stringify(r), {
      status: r.ok ? 202 : 502, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const KEY = process.env.SUPABASE_SERVICE_KEY;
  let row = null;
  try {
    if (SB && KEY) {
      const r = await fetch(`${SB}/rest/v1/auditoria_sistema?select=*&order=gerado_em.desc&limit=1`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
      });
      if (r.ok) { const [x] = await r.json(); row = x || null; }
    }
  } catch { /* degrada para vazio */ }

  return new Response(JSON.stringify(row || { vazio: true }), {
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
