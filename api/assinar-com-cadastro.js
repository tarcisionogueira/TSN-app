/**
 * POST /api/assinar-com-cadastro
 * Fluxo "pagar primeiro" para o VISITANTE não-logado assinar um plano recorrente
 * (Investidor Pro) criando a conta no mesmo passo — de forma ATÔMICA:
 *
 *   1. cria a conta (Admin API, já confirmada — o cliente acabou de pagar)
 *   2. cria a assinatura transparente no Mercado Pago (preapproval por card_token)
 *   3. se a assinatura NÃO for autorizada → APAGA a conta (rollback): nada fica
 *      gravado, o cliente refaz o cadastro/compra
 *   4. se autorizada → grava o perfil (com CPF/endereço p/ NFS-e), ativa o plano,
 *      registra o preço travado e manda e-mail de boas-vindas (best-effort)
 *
 * Segurança: preço SEMPRE do servidor; role só é elevado após o pagamento
 * autorizado; rate limit por IP; senha forte.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { checkRateLimit } from './_rate-limit.js';
import { enviarEmail } from './_email.js';
import { hashCpf, encryptCpf } from './_cpf.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const MP_URL   = 'https://api.mercadopago.com';
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();
const BASE_URL = process.env.APP_BASE_URL || 'https://bidprobrasil.com.br';

// Planos recorrentes (preço SEMPRE do servidor — nunca do cliente).
const PLANOS_RECORRENTES = {
  top2:  { nome: 'Investidor Pro',       valor: 49.90 },
  clube: { nome: 'Leilão Club — Mensal', valor: 5000.00 },
};

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
function adminAuth(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/auth/v1/admin/${path}`, {
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
  if (!MP_TOKEN) return res.status(500).json({ error: 'MP_ACCESS_TOKEN não configurado' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!checkRateLimit(`assinar-cadastro:${ip}`, 6, 60_000).ok) {
    return res.status(429).json({ error: 'Muitas tentativas. Aguarde um instante e tente de novo.' });
  }

  const b = req.body || {};
  const nome  = String(b.nome || '').trim();
  const email = String(b.email || '').trim().toLowerCase();
  const senha = String(b.senha || '');
  const cpf   = String(b.cpf || '').replace(/\D/g, '');
  const cardTokenId = String(b.cardTokenId || '');
  const plano = String(b.plano || '');
  const end   = (b.endereco && typeof b.endereco === 'object') ? b.endereco : {};

  const cfg = PLANOS_RECORRENTES[plano];
  if (!cfg) return res.status(400).json({ error: 'Plano inválido.' });
  if (!nome || !email || !senha) return res.status(400).json({ error: 'Preencha nome, e-mail e senha.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'E-mail inválido.' });
  if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/.test(senha)) {
    return res.status(400).json({ error: 'A senha deve ter ao menos 8 caracteres, com maiúscula, minúscula, número e caractere especial.' });
  }
  if (cpf.length !== 11) return res.status(400).json({ error: 'CPF inválido (11 dígitos).' });
  if (!end.logradouro || !end.numero || !end.cidade || !end.uf) return res.status(400).json({ error: 'Endereço incompleto para emissão fiscal.' });
  if (!cardTokenId) return res.status(400).json({ error: 'Dados do cartão ausentes.' });

  // 1) Cria a conta (já confirmada — o cliente vai pagar em seguida). role explorador.
  // CPF NÃO vai para o metadata do Auth (só hash+cifra em perfis, adiante).
  const meta = { nome, role: 'explorador', lgpd_aceito: true, lgpd_data: new Date().toISOString() };
  const cRes = await adminAuth('users', { method: 'POST', body: JSON.stringify({ email, password: senha, email_confirm: true, user_metadata: meta }) });
  const cData = await cRes.json().catch(() => ({}));
  if (!cRes.ok) {
    const msg = String(cData?.msg || cData?.error_description || cData?.error || cData?.message || '');
    if (/already.*(registered|exists)|been registered|duplicate/i.test(msg)) {
      return res.status(409).json({ error: 'Este e-mail já tem conta. Faça login para assinar.' });
    }
    return res.status(400).json({ error: 'Não foi possível criar a conta.' + (msg ? ` (${msg})` : '') });
  }
  const userId = cData?.id || cData?.user?.id;
  if (!userId) return res.status(500).json({ error: 'Falha ao criar a conta.' });

  const rollback = async () => {
    try {
      const d = await adminAuth(`users/${userId}`, { method: 'DELETE' });
      if (!d.ok) console.error(`[assinar-com-cadastro] ROLLBACK falhou user=${userId} status=${d.status} email=${email}`);
    } catch (e) { console.error(`[assinar-com-cadastro] ROLLBACK erro user=${userId}:`, e?.message || e); }
  };

  // 2) Cria a assinatura transparente no MP (preapproval por card_token).
  let sub, subErro = '';
  try {
    const r = await fetch(`${MP_URL}/preapproval`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json', 'X-Idempotency-Key': `${userId}-${plano}` },
      body: JSON.stringify({
        reason: cfg.nome,
        external_reference: `${userId}|${plano}`,
        payer_email: email,
        card_token_id: cardTokenId,
        status: 'authorized',
        back_url: `${BASE_URL}/#/checkout?plano=${plano}&status=assinatura`,
        notification_url: `${BASE_URL}/api/mp-webhook`,
        auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: Number(cfg.valor), currency_id: 'BRL' },
      }),
    });
    sub = await r.json().catch(() => ({}));
    if (!r.ok) subErro = sub?.message || sub?.cause?.[0]?.description || 'Falha no pagamento';
  } catch (e) { subErro = String(e?.message || e); }

  // 3) Recusada de fato → rollback (nada fica gravado). 'pending' NÃO é recusa
  //    (análise antifraude / 3D Secure): mantém a conta; o webhook ativa o plano
  //    quando a assinatura passar a 'authorized'.
  const aprovado = sub?.status === 'authorized';
  const pendente = sub?.status === 'pending';
  if (subErro || (!aprovado && !pendente)) {
    await rollback();
    return res.status(402).json({ error: subErro || 'Pagamento não autorizado. Verifique os dados do cartão e refaça a assinatura.', status: sub?.status || null });
  }

  // 4) Grava o perfil (dados fiscais SEMPRE; role/plano só quando APROVADO — se
  //    'pending', o webhook sobe o role ao confirmar). Upsert garante a linha
  //    mesmo sem trigger de criação de perfil.
  try {
    const [cpf_hash, cpf_enc] = cpf ? await Promise.all([hashCpf(cpf), encryptCpf(cpf)]) : [null, null];
    await sb('perfis?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: userId, nome, cpf_hash, cpf_enc,
        ...(aprovado ? { role: plano, plano, inadimplente_desde: null } : {}),
        endereco_cep: end.cep || null, endereco_logradouro: end.logradouro || null,
        endereco_numero: end.numero || null, endereco_complemento: end.complemento || null,
        endereco_bairro: end.bairro || null, endereco_cidade: end.cidade || null, endereco_uf: end.uf || null,
        lgpd_aceito: true, lgpd_data: meta.lgpd_data,
      }),
    });
  } catch (e) { console.error('[assinar-com-cadastro] perfil:', e?.message || e); }

  if (aprovado) {
    // Preço travado (trava de 12 meses para recorrência) — best-effort.
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_preco_contratado`, {
        method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_user_id: userId, p_plano_key: plano }),
      });
    } catch { /* não bloqueia */ }
    // E-mail de boas-vindas (best-effort — não bloqueia).
    try {
      await enviarEmail({
        from: process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>',
        to: email,
        subject: `Bem-vindo ao ${cfg.nome} — BidPro Brasil`,
        html: `<p>Olá, ${nome.split(' ')[0] || ''}!</p><p>Sua assinatura do <strong>${cfg.nome}</strong> foi confirmada. Já pode entrar na plataforma com o seu e-mail e senha.</p><p>Bons arremates!<br/>BidPro Brasil</p>`,
      });
    } catch { /* não bloqueia */ }
  }

  return res.status(200).json({ ok: true, status: sub.status, plano });
}
