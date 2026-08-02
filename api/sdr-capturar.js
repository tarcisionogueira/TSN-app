/**
 * POST /api/sdr-capturar
 * Captura de lead SDR (link gratuito). Faz TUDO no backend porque o cliente não
 * pode, com segurança: (a) escolher o consultor por SORTEIO, (b) setar
 * perfis.indicado_por (cai na "carteira" do consultor), (c) conceder acesso.
 *
 * Fluxo (modelo definido pelo dono): o link é sempre de ACESSO GRATUITO.
 *   1. cria a conta já confirmada (o visitante entra na hora)
 *   2. sorteia um consultor ativo → vira "cliente na carteira" dele (ainda não
 *      pagante, para o consultor entrar em contato)
 *   3. concede o acesso gratuito (role 'explorador') — o conteúdo em si é o
 *      conteudo_url do produto, mostrado na tela de sucesso
 *   4. grava o lead (com respostas do questionário) para a equipe/consultor
 *
 * Produto PAGO ("paga na hora") e desconto ficam para a etapa 2 (redireciona ao
 * checkout que já existe). Aqui nunca se concede plano pago de graça.
 *
 * Segurança: role SEMPRE 'explorador'; rate limit por IP; senha mínima.
 */
export const config = { runtime: 'nodejs' };

import { checkRateLimit } from './_rate-limit.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req, res) {
  const origin = process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
  res.setHeader('Access-Control-Allow-Origin', origin);
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!(await checkRateLimit(`sdr-capturar:${ip}`, 6, 60_000)).ok) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde um instante e tente de novo.' });
  }

  const b = req.body || {};
  const produtoId = String(b.produtoId || '').trim();
  const nome      = String(b.nome || '').trim();
  const email     = String(b.email || '').trim().toLowerCase();
  const senha     = String(b.senha || '');
  const whatsapp  = String(b.whatsapp || '').replace(/\D/g, '');
  const respostas = (b.respostas && typeof b.respostas === 'object') ? b.respostas : {};

  if (!UUID_RE.test(produtoId)) return res.status(400).json({ error: 'Produto inválido.' });
  if (!nome || !email) return res.status(400).json({ error: 'Preencha nome e e-mail.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (senha.length < 6) return res.status(400).json({ error: 'A senha deve ter ao menos 6 caracteres.' });
  if (whatsapp.length < 10) return res.status(400).json({ error: 'WhatsApp inválido.' });

  // Confere que o produto existe e está ativo (nunca confia no cliente).
  const prodRows = await sb(`sdr_produtos?id=eq.${produtoId}&ativo=eq.true&select=id`).then(r => r.json()).catch(() => []);
  if (!Array.isArray(prodRows) || !prodRows.length) return res.status(404).json({ error: 'Produto não encontrado ou inativo.' });

  // 1) Cria a conta já confirmada (acesso gratuito imediato). role explorador.
  const meta = { nome, whatsapp, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString() };
  const cRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: meta }),
  });
  const cData = await cRes.json().catch(() => ({}));
  if (!cRes.ok) {
    const msg = String(cData?.msg || cData?.error_description || cData?.error || cData?.message || '');
    if (/already.*(registered|exists)|been registered|duplicate/i.test(msg)) {
      return res.status(409).json({ error: 'Esse e-mail já tem conta. Entre na plataforma normalmente para acessar o conteúdo.' });
    }
    return res.status(400).json({ error: 'Não foi possível criar a conta.' + (msg ? ` (${msg})` : '') });
  }
  const userId = cData?.id || cData?.user?.id || null;
  if (!userId) return res.status(500).json({ error: 'Falha ao criar a conta.' });

  // 2) Sorteio do consultor ativo. Sem consultores → fica sem dono (pool);
  //    a equipe/admin atribui depois. Não bloqueia o cadastro.
  let consultorId = null;
  try {
    const cons = await sb(`perfis?role=eq.consultor&select=id,ativo`).then(r => r.json()).catch(() => []);
    const ativos = (Array.isArray(cons) ? cons : []).filter(c => c.ativo !== false);
    if (ativos.length) consultorId = ativos[Math.floor(Math.random() * ativos.length)].id;
  } catch { /* pool */ }

  // 3) Perfil: o trigger handle_new_user já criou a linha (nome + role). Aqui
  //    garantimos telefone (WhatsApp) e o vínculo com o consultor (carteira).
  try {
    await sb('perfis?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ id: userId, nome, telefone: whatsapp, role: 'explorador', indicado_por: consultorId, lgpd_aceito: true, lgpd_data: meta.lgpd_data }),
    });
  } catch { /* best-effort */ }

  // 4) Lead para a equipe/consultor (com respostas do questionário).
  try {
    const leadRes = await sb('sdr_leads', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        produto_id: produtoId, nome, whatsapp, email,
        respostas, user_id: userId, consultor_id: consultorId,
        origem: String(b.origem || '').slice(0, 500) || null, status: 'novo',
      }),
    });
    // NUNCA falhar em silêncio: era assim que o lead sumia (schema sem respostas/user_id/
    // consultor_id → 400 → catch vazio → 0 linhas em sdr_leads). A conta já foi criada, então
    // não derrubamos a resposta — mas o erro fica no log do runtime para o health-check/dono.
    if (!leadRes.ok) {
      const det = await leadRes.text().catch(() => '');
      console.error('[sdr-capturar] lead NÃO gravado', leadRes.status, det.slice(0, 300));
    }
  } catch (e) { console.error('[sdr-capturar] lead NÃO gravado (exceção)', String(e?.message || e)); }

  return res.status(200).json({ ok: true, userId });
}
