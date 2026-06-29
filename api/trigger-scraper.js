export const config = { runtime: 'edge' };

import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';

const GITHUB_TOKEN = process.env.GITHUB_ACTIONS_TOKEN;
const REPO_OWNER   = 'tarcisionogueira';
const REPO_NAME    = 'TSN-app';
// Dispara o scraper ROBUSTO (scripts/scraper.js — mapeia colunas por NOME do
// cabeçalho). NÃO usar scraper-caixa.mjs (índice fixo): a Caixa mudou o layout
// do CSV e o índice fixo corrompeu 91% do acervo (modalidade=descrição, etc).
const WORKFLOW_ID  = 'scraper.yml';

export default async function handler(req) {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' } });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  // Autenticação: apenas admin ou analista
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();

  if (!GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: 'GITHUB_ACTIONS_TOKEN não configurado no Vercel' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  let ufs = '';
  try {
    const body = await req.json();
    ufs = (body.estados || []).join(',');
  } catch (_) {}

  const dispatchUrl = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/actions/workflows/${WORKFLOW_ID}/dispatches`;

  const ghRes = await fetch(dispatchUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { ufs } }),
  });

  if (!ghRes.ok) {
    const txt = await ghRes.text();
    return new Response(JSON.stringify({ error: `GitHub API ${ghRes.status}: ${txt}` }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  return new Response(JSON.stringify({ ok: true, msg: `Workflow disparado para: ${ufs || 'todos os estados'}` }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
  });
}
