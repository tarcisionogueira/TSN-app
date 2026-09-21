/**
 * POST /api/login-rate  { action: 'check' | 'registrar_falha', email }
 *
 * Rate-limit de LOGIN por conta (achado do QA de 21/09): `Login.jsx` chamava
 * `supabase.auth.signInWithPassword` direto, sem nenhuma fricção própria — só o limite
 * genérico do GoTrue, pensado pra abuso de infra, não pra travar tentativa de senha contra
 * UMA conta específica (credential-stuffing, possivelmente rotacionando IP). Mesmo padrão
 * de `verificar_cpf_rate`/`api/verificar-cpf.js`: tabela própria, RLS ligado sem política —
 * só este endpoint (service_role) acessa.
 *
 * 'check': o front chama ANTES de tentar a senha; bloqueia se a conta já tem falhas
 *   recentes demais. 'registrar_falha': o front chama DEPOIS de um signIn que falhou —
 *   só falha conta pro limite (login certo não penaliza ninguém).
 */
export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const JANELA_MIN = 15;   // minutos
const TETO_FALHAS = 8;   // falhas na janela que bloqueiam a PRÓXIMA tentativa

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

async function contarFalhas(email) {
  const janela = new Date(Date.now() - JANELA_MIN * 60_000).toISOString();
  const res = await sb(`login_tentativas?email=eq.${encodeURIComponent(email)}&criado_em=gte.${janela}&select=id`).catch(() => null);
  if (!res?.ok) return null; // infra indisponível → não sabemos, fail-open no chamador
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? rows.length : null;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };
  let body; try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const email = String(body?.email || '').trim().toLowerCase().slice(0, 254);
  if (!email || !/\S+@\S+\.\S+/.test(email)) return new Response(JSON.stringify({ error: 'E-mail inválido' }), { status: 400, headers });

  if (body?.action === 'registrar_falha') {
    // Best-effort: se a gravação falhar, o pior caso é o rate-limit ficar mais frouxo
    // desta vez — nunca deve travar o fluxo de login por causa da própria infra do limite.
    await sb('login_tentativas', { method: 'POST', body: JSON.stringify({ email }), headers: { Prefer: 'return=minimal' } }).catch(() => {});
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  // action: 'check' (padrão)
  const falhas = await contarFalhas(email);
  // Infra indisponível (falhas === null) → fail-open: não bloqueia tráfego legítimo por
  // causa de uma falha NOSSA de leitura, mesmo critério de verificar-cpf.js.
  const bloqueado = falhas != null && falhas >= TETO_FALHAS;
  return new Response(JSON.stringify({ bloqueado, minutos: JANELA_MIN }), { status: 200, headers });
}
