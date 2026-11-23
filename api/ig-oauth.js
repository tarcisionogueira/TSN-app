/**
 * /api/ig-oauth — "Conectar Instagram": o token sai do login OFICIAL do Instagram, em tela cheia.
 * ═══════════════════════════════════════════════════════════════════════════════════════
 * Por que existe (22/11): o "Gerar token" do painel da Meta abre o login numa janela embutida, e o
 * navegador bloqueia os cookies do Instagram ali — "Não foi possível se conectar" mesmo com a senha
 * certa. Aqui o login acontece em instagram.com como página principal (onde a sessão já funciona).
 *
 * POST (admin logado)  → { url } para onde a tela redireciona. O `state` é ASSINADO (HMAC) com o id
 *                        do admin e validade de 15 min: sem tabela, e ninguém forja um retorno.
 * GET ?code&state      → é o retorno do Instagram: troca o code pelo token curto, troca pelo de
 *                        longa duração (~60 dias), grava em `ig_credencial` e volta para
 *                        /admin/instagram com ?ig=ok (ou ?ig=erro&motivo=...).
 *
 * ENVS (nomes; o repositório é público): IG_APP_SECRET_INSTAGRAM (segredo do app do Instagram).
 * O endereço de retorno abaixo precisa estar cadastrado no painel: app "BidPro - Atendimento" →
 * Instagram → Configuração da API com login do Instagram → Configurar login de empresa → URIs de
 * redirecionamento do OAuth.
 */
export const config = { runtime: 'nodejs', maxDuration: 20 };

import crypto from 'node:crypto';
import { getUser } from './_auth.js';
import { credencialAtual } from './_instagram-envio.js';

const SB = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const IG_APP_ID = process.env.IG_APP_ID_INSTAGRAM || '911295054971510';   // id público do app "BidPro - Atendimento-IG"
const IG_SECRET = process.env.IG_APP_SECRET_INSTAGRAM;
export const REDIRECT_URI = 'https://www.bidprobrasil.com.br/api/ig-oauth';
const VOLTA = 'https://www.bidprobrasil.com.br/#/admin/instagram';
const ESCOPOS = ['instagram_business_basic', 'instagram_business_manage_messages', 'instagram_business_manage_comments'];
const VALIDADE_STATE_MS = 15 * 60 * 1000;

async function sb(method, path, body, prefer) {
  const r = await fetch(`${SB}/rest/v1/${path}`, {
    method,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`PostgREST ${r.status} em ${path.split('?')[0]}: ${(await r.text().catch(() => '')).slice(0, 200)}`);
  return r.status === 204 ? null : r.json().catch(() => null);
}

const chaveState = () => process.env.CRON_SECRET || SVC || '';

/** state = base64url(json).assinatura — puro, testável. */
export function assinarState(dados, chave = chaveState()) {
  const corpo = Buffer.from(JSON.stringify(dados)).toString('base64url');
  const sig = crypto.createHmac('sha256', chave).update(corpo).digest('base64url');
  return `${corpo}.${sig}`;
}

export function lerState(state, chave = chaveState(), agora = Date.now()) {
  const [corpo, sig] = String(state || '').split('.');
  if (!corpo || !sig || !chave) return null;
  const esperado = crypto.createHmac('sha256', chave).update(corpo).digest('base64url');
  const a = Buffer.from(sig); const b = Buffer.from(esperado);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const d = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
    return d?.exp && d.exp > agora ? d : null;
  } catch { return null; }   // corpo assinado mas ilegível = state inválido (a falha É a resposta)
}

export function urlAutorizacao(state) {
  const u = new URL('https://www.instagram.com/oauth/authorize');
  u.searchParams.set('client_id', IG_APP_ID);
  u.searchParams.set('redirect_uri', REDIRECT_URI);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', ESCOPOS.join(','));
  u.searchParams.set('enable_fb_login', '1');   // oferece "Continuar com o Facebook": entra sem a senha do Instagram (captcha em loop, 22/11)
  u.searchParams.set('state', state);
  return u.toString();
}

function voltar(res, ok, motivo) {
  const q = ok ? '?ig=ok' : `?ig=erro&motivo=${encodeURIComponent(String(motivo || 'falha').slice(0, 200))}`;
  res.writeHead(302, { Location: `${VOLTA}${q}` });
  res.end();
}

export default async function handler(req, res) {
  if (!SB || !SVC) return res.status(500).json({ error: 'Supabase não configurado' });

  if (req.method === 'POST') {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    try {
      const [perfil] = (await sb('GET', `perfis?id=eq.${user.id}&select=role`)) || [];
      if (perfil?.role !== 'admin') return res.status(403).json({ error: 'Apenas admin' });
      if (!IG_SECRET) return res.status(503).json({ error: 'IG_APP_SECRET_INSTAGRAM ausente na Vercel' });
      const state = assinarState({ u: user.id, exp: Date.now() + VALIDADE_STATE_MS, n: crypto.randomBytes(8).toString('hex') });
      return res.status(200).json({ url: urlAutorizacao(state), redirect_uri: REDIRECT_URI });
    } catch (e) {
      console.error('[ig-oauth] iniciar:', e?.message || e);
      return res.status(500).json({ error: String(e?.message || e).slice(0, 200) });
    }
  }

  if (req.method !== 'GET') return res.status(405).json({ error: 'Método não permitido' });
  const q = req.query || {};
  if (q.error) return voltar(res, false, `Instagram: ${q.error_description || q.error_reason || q.error}`);
  if (!q.code) return res.status(200).json({ ok: true, service: 'ig-oauth', redirect_uri: REDIRECT_URI, configurado: !!IG_SECRET });
  if (!lerState(q.state)) return voltar(res, false, 'link de conexão vencido ou inválido — clique em Conectar de novo');
  if (!IG_SECRET) return voltar(res, false, 'IG_APP_SECRET_INSTAGRAM ausente na Vercel');

  try {
    // 1. code → token curto (form-urlencoded, como a Meta documenta para este endpoint)
    const form = new URLSearchParams({
      client_id: IG_APP_ID, client_secret: IG_SECRET, grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI, code: String(q.code).replace(/#_$/, ''),
    });
    const r1 = await fetch('https://api.instagram.com/oauth/access_token', { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
    const j1 = await r1.json().catch(() => null);
    if (!r1.ok || !j1?.access_token) return voltar(res, false, `troca do código: ${j1?.error_message || j1?.error?.message || r1.status}`);

    // 2. curto → longa duração
    const u2 = new URL('https://graph.instagram.com/access_token');
    u2.searchParams.set('grant_type', 'ig_exchange_token');
    u2.searchParams.set('client_secret', IG_SECRET);
    u2.searchParams.set('access_token', j1.access_token);
    const r2 = await fetch(u2, { signal: AbortSignal.timeout(10000) });
    const j2 = await r2.json().catch(() => null);
    if (!r2.ok || !j2?.access_token) return voltar(res, false, `token de longa duração: ${j2?.error?.message || r2.status}`);

    // 3. quem é (só para mostrar o @ na tela; o envio continua usando IG_USER_ID)
    let username = null;
    try {
      const r3 = await fetch('https://graph.instagram.com/me?fields=username', { headers: { Authorization: `Bearer ${j2.access_token}` }, signal: AbortSignal.timeout(8000) });
      username = r3.ok ? (await r3.json().catch(() => null))?.username || null : null;
    } catch (e) { console.warn('[ig-oauth] não li o @ da conta:', e?.message || e); }

    const agora = new Date();
    await sb('POST', 'ig_credencial?on_conflict=id', {
      id: 1, token: j2.access_token, username,
      expira_em: new Date(agora.getTime() + (Number(j2.expires_in) || 59 * 86400) * 1000).toISOString(),
      renovado_em: agora.toISOString(), origem: 'tela', ultimo_erro: null,
    }, 'resolution=merge-duplicates,return=minimal');
    await credencialAtual({ fresco: true });
    return voltar(res, true);
  } catch (e) {
    console.error('[ig-oauth] retorno:', e?.message || e);
    return voltar(res, false, String(e?.message || e));
  }
}
