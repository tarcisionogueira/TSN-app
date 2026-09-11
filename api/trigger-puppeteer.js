export const config = { runtime: 'edge' };

import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_ACTIONS_TOKEN;
const REPO_OWNER   = 'tarcisionogueira';
const REPO_NAME    = 'TSN-app';
const WORKFLOW_ID  = 'leiloeiros-puppeteer.yml';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();

  if (!GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_ACTIONS_TOKEN não configurado no Vercel' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  // `fontes` (11/09): dispara SÓ uma fonte (ex.: SODRE_VEICULOS, o piloto de veículos) em vez
  // da rodada inteira — mesmo mecanismo do input manual `workflow_dispatch` que já existe no
  // YAML, só exposto por botão em vez de exigir a UI do GitHub. Allowlist de caracteres (não
  // de valores) porque quem decide o que cada código faz é o próprio scraper-puppeteer.mjs
  // (`rodar()`/`ONLY.includes()`) — aqui só evita injetar algo fora do formato esperado.
  let fontes = '';
  try {
    const body = await req.json().catch(() => null);
    const raw = String(body?.fontes || '');
    if (raw && !/^[A-Z0-9_,]{1,200}$/.test(raw)) {
      return new Response(JSON.stringify({ error: 'fontes inválido — use só letras maiúsculas, números, _ e ,' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    fontes = raw;
  } catch { /* corpo ausente = roda tudo, comportamento de sempre */ }

  const dispatchUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`;

  const ghRes = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', ...(fontes ? { inputs: { fontes } } : {}) }),
  });

  if (!ghRes.ok) {
    const txt = await ghRes.text();
    return new Response(JSON.stringify({ error: `GitHub API ${ghRes.status}: ${txt}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({
    ok: true,
    msg: fontes ? `Scraper Puppeteer (${fontes}) agendado via GitHub Actions` : 'Scraper Puppeteer (Mega/Sold/Superbid/BB) agendado via GitHub Actions',
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
