export const config = { runtime: 'edge' };

// COLETA OPORTUNISTA (pedido do dono): quando o STAFF abre o app (celular ou PC), dispara os
// scrapers das fontes PAGAS (Bright Data) na nuvem — SÓ se já passou o espaçamento desde o último
// disparo (gate atômico `coleta_oportunista_claim`, ~20h). Assim, quem acessa todo dia mantém as
// pagas frescas SEM depender de um computador sempre ligado, e sem gastar BD a cada abertura.
// Rede de segurança dos 7 dias = os workflows dessas fontes já rodam 1x/semana na CI.
// As fontes GRÁTIS (CEF + cluster puppeteer) já rodam diárias na CI — não entram aqui.
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_ACTIONS_TOKEN;
const REPO_OWNER   = 'tarcisionogueira';
const REPO_NAME    = 'TSN-app';
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC          = process.env.SUPABASE_SERVICE_KEY;
const STAFF        = new Set(['admin', 'analista', 'advogado', 'consultor']);
const ESPACAMENTO  = process.env.COLETA_OPORTUNISTA_ESPACAMENTO || '20 hours';
// Fonte → workflow (só as PAGAS por Bright Data).
const FONTES = { SOLEON: 'scraper-soleon.yml', GESTAO: 'scraper-gestao.yml', RJ: 'scraper-rj.yml', PECINI: 'scraper-pecini.yml' };

async function claim(fonte) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/coleta_oportunista_claim`, {
      method: 'POST',
      headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_fonte: fonte, p_espacamento: ESPACAMENTO }),
    });
    return (await r.json().catch(() => false)) === true;
  } catch { return false; }
}

async function dispatch(wf) {
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${wf}/dispatches`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ref: 'main' }),
    });
    return r.ok;
  } catch { return false; }
}

export default async function handler(req) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: cors });

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (!STAFF.has(role)) return forbidden();
  if (!GITHUB_TOKEN || !SUPABASE_URL || !SVC) return new Response(JSON.stringify({ ok: false, erro: 'infra ausente (GITHUB_ACTIONS_TOKEN/SERVICE_KEY)' }), { status: 200, headers: cors });

  // Dispara cada fonte paga cujo espaçamento venceu (o claim é atômico → sem corrida entre abas).
  const disparadas = [];
  for (const [fonte, wf] of Object.entries(FONTES)) {
    if (!(await claim(fonte))) continue;
    if (await dispatch(wf)) disparadas.push(fonte);
  }
  return new Response(JSON.stringify({ ok: true, disparadas }), { status: 200, headers: cors });
}
