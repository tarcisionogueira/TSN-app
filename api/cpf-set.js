/**
 * POST /api/cpf-set  — grava o CPF do PRÓPRIO usuário autenticado já com os
 * derivados criptografados (cpf_hash + cpf_enc), pois a chave (CPF_ENC_KEY) só
 * existe no backend. O front nunca escreve hash/cifra direto: chama este
 * endpoint. Assim qualquer tela nova que precise salvar CPF já entra
 * parametrizada — basta chamar /api/cpf-set.
 *
 * Corpo: { cpf }. Atualiza SOMENTE a linha do usuário do token (não recebe id).
 * Se CPF_ENC_KEY ainda não estiver no ambiente, grava só o texto claro (o
 * backfill preenche os derivados depois) — nada quebra durante a migração.
 */
export const config = { runtime: 'nodejs' };

import { getUser } from './_auth.js';
import { hashCpf, encryptCpf, cpfCriptoAtivo, validarCPF } from './_cpf.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

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
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(204).end();
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).json({ error: 'Configuração ausente' });

  const user = await getUser(req);
  if (!user?.id) return res.status(401).json({ error: 'Não autorizado' });

  const cpf = String(req.body?.cpf || '').replace(/\D/g, '');
  // Valida o dígito verificador (não só o comprimento) — barra CPFs fictícios.
  if (!validarCPF(cpf)) return res.status(400).json({ error: 'CPF inválido.' });

  const [cpf_hash, cpf_enc] = cpfCriptoAtivo()
    ? await Promise.all([hashCpf(cpf), encryptCpf(cpf)])
    : [null, null];

  const up = await sb(`perfis?id=eq.${encodeURIComponent(user.id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    // Só hash + cifra; zera qualquer texto claro remanescente na coluna.
    body: JSON.stringify({ cpf: null, cpf_hash, cpf_enc }),
  });
  if (!up.ok) {
    const txt = await up.text().catch(() => '');
    console.error('[cpf-set] PATCH falhou', up.status, txt);
    return res.status(500).json({ error: 'Não foi possível salvar o CPF.' });
  }
  return res.status(200).json({ ok: true });
}
