/**
 * POST /api/assinar-com-cadastro
 * Fluxo "pagar primeiro" para o VISITANTE não-logado assinar um plano recorrente
 * (Investidor Pro) criando a conta no mesmo passo — de forma ATÔMICA:
 *
 *   1. cria a conta (Admin API, já confirmada)
 *   2. cria a assinatura transparente no Mercado Pago (preapproval por card_token)
 *   3. se o MANDATO não for aceito → APAGA a conta (rollback): nada fica gravado,
 *      o cliente refaz o cadastro/compra
 *   4. se aceito → grava o perfil (com CPF/endereço p/ NFS-e) e o preço travado.
 *      NÃO ativa plano e NÃO manda boas-vindas: o mandato aceito é permissão de
 *      cobrar, não dinheiro recebido. Quem ativa e dá as boas-vindas é
 *      `ativarPlanoDireto` (api/_webhook-core.js), na primeira cobrança CONFIRMADA.
 *
 * Segurança: preço SEMPRE do servidor; role só é elevado com cobrança recebida
 * (decisão do dono, 16/08); rate limit por IP; senha forte.
 */
export const config = { runtime: 'nodejs', maxDuration: 30 };

import { checkRateLimit } from './_rate-limit.js';
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
  if (!(await checkRateLimit(`assinar-cadastro:${ip}`, 6, 60_000)).ok) {
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
  //    quando a PRIMEIRA COBRANÇA for confirmada.
  //
  // `authorized` NÃO É PAGAMENTO (corrigido em 16/08). É o MANDATO autorizado: o MP
  // validou o cartão (uma transação de R$ 0,00, `card_validation`) e ganhou permissão
  // de cobrar. A primeira cobrança é ASSÍNCRONA e pode ser recusada minutos depois.
  // Foi o que aconteceu com o 1º assinante Pro: mandato `authorized` às 11:39:19,
  // cobrança de R$ 49,90 RECUSADA às 12:01:32 (`cc_rejected_high_risk`), zero real
  // recebido. Como este arquivo lia `authorized` como "aprovado", ele mandou um
  // "Bem-vindo ao Investidor Pro" 22 minutos ANTES da recusa — e o MP, que dispara o
  // "você tem um novo assinante" na mesma validação de R$ 0,00, confirmou a versão
  // errada. O cliente ficou com dois "parabéns" na caixa de entrada e nenhum acesso.
  //
  // Regra desde então (decisão do dono, 16/08 — "opção 1"): ACESSO SÓ COM DINHEIRO NA
  // CONTA. Aqui não se grava role nem se manda boas-vindas; quem faz as duas coisas é
  // `ativarPlanoDireto` no webhook, e só quando a ativação carrega cobrança RECEBIDA.
  const mandatoOk = sub?.status === 'authorized' || sub?.status === 'pending';
  if (subErro || !mandatoOk) {
    await rollback();
    return res.status(402).json({ error: subErro || 'Pagamento não autorizado. Verifique os dados do cartão e refaça a assinatura.', status: sub?.status || null });
  }

  // 4) Grava o perfil (dados fiscais para NFS-e). NUNCA role/plano aqui — ver o bloco
  //    acima: sem cobrança confirmada não há acesso.
  //
  //    O `plano` desta linha também gravava `plano: 'top2'`, que VIOLA a check constraint
  //    `perfis_plano_check` (aceita só gratuito|analista|gestor) — o mesmo defeito que
  //    `_webhook-core.js` já documenta como corrigido lá ("NÃO gravar em `plano`… toda
  //    ativação de plano pago falhava") e que tinha ficado aqui. O upsert INTEIRO falhava,
  //    dentro de um try/catch que só logava: por este caminho o role nunca era gravado,
  //    nem para quem pagava direito. O acaso é que isso vinha SEGURANDO o buraco de acesso
  //    descrito acima — os dois defeitos se anulavam, e corrigir só um abriria o outro.
  try {
    const [cpf_hash, cpf_enc] = cpf ? await Promise.all([hashCpf(cpf), encryptCpf(cpf)]) : [null, null];
    const rPerfil = await sb('perfis?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: userId, nome, cpf_hash, cpf_enc,
        endereco_cep: end.cep || null, endereco_logradouro: end.logradouro || null,
        endereco_numero: end.numero || null, endereco_complemento: end.complemento || null,
        endereco_bairro: end.bairro || null, endereco_cidade: end.cidade || null, endereco_uf: end.uf || null,
        lgpd_aceito: true, lgpd_data: meta.lgpd_data,
      }),
    });
    // `.ok` conferido: era exatamente a checagem ausente que deixou o upsert falhar em
    // silêncio por semanas. Sem CPF/endereço a NFS-e não sai, então isto precisa gritar.
    if (!rPerfil.ok) {
      console.error(`[assinar-com-cadastro] perfil NÃO gravado user=${userId} status=${rPerfil.status}: ${await rPerfil.text().catch(() => '')}`);
    }
  } catch (e) { console.error('[assinar-com-cadastro] perfil:', e?.message || e); }

  // Preço travado (trava de 12 meses para recorrência) — best-effort. Vale já na criação
  // do mandato: é o valor que a recorrência VAI cobrar, não uma confirmação de pagamento.
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/registrar_preco_contratado`, {
      method: 'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_user_id: userId, p_plano_key: plano }),
    });
  } catch { /* não bloqueia */ }

  // `acesso` é explícito para o front não ter que reinterpretar o status do gateway —
  // foi a interpretação de `authorized` que criou o problema todo.
  return res.status(200).json({ ok: true, status: sub.status, acesso: 'aguardando_pagamento', plano });
}
