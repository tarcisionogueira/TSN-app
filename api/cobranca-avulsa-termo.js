/**
 * POST /api/cobranca-avulsa-termo — TERMO DE ACEITE antes do pagamento de uma cobrança avulsa (05/11, dono).
 *
 * Caso que originou: assessoria para 2 imóveis fechada por R$ 8.000 em 12x sem juros. O cliente recebe só o link
 * da cobrança; os dados dele entram AQUI, no ato do pagamento: primeiro CPF + e-mail; se já tem cadastro, os dados
 * vêm preenchidos e ele só completa o que falta. Depois lê o termo JÁ com os dados dele e aceita. O pagamento só
 * libera depois do aceite (api/mp-checkout.js recusa cobrança com termo não aceito).
 *
 *   { acao: 'identificar', id, cpf, email }  → { cadastrado, dados? }   (dados só se CPF E e-mail são da MESMA conta)
 *   { acao: 'aceitar', id, cpf, email, nome, telefone, endereco{…} } → grava o aceite (texto final + hash + IP + UA)
 *
 * O `id` (uuid imprevisível do link) é a credencial do fluxo, como em cobranca-avulsa-info.js. O texto aceito é o
 * do BANCO (cobrancas_avulsas.termo_texto) preenchido no servidor — nunca o que o navegador mandar.
 */
export const config = { runtime: 'edge' };

import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { validarCPF, hashCpf } from './_cpf.js';
import { preencherSignatario, enderecoDoPerfil, formatarDocumento, temMarcadorSignatario } from './_signatario.js';
import { erroNome, normalizarNome } from './_nome.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } });
const sb = (path, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
  ...opts, signal: AbortSignal.timeout(10000),
  headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
});
const soDigitos = (v) => String(v || '').replace(/\D/g, '');

// Conta da plataforma cujo CPF E e-mail batem. Leitura que falha LANÇA: "não consegui conferir" não pode virar
// "não tem cadastro" (forma nº 2) — o cliente cadastrado seria levado a redigitar tudo sem motivo.
async function contaDoCliente(cpf, email) {
  const hash = await hashCpf(cpf).catch(() => null);
  const filtro = hash ? `or=(cpf_hash.eq.${hash},cpf.eq.${cpf})` : `cpf=eq.${cpf}`;
  const r = await sb(`perfis?${filtro}&select=id,nome,telefone,endereco,endereco_logradouro,endereco_numero,endereco_complemento,endereco_bairro,endereco_cidade,endereco_uf,endereco_cep&limit=3`);
  if (!r.ok) throw new Error(`perfis HTTP ${r.status}`);
  for (const p of await r.json()) {
    const u = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${p.id}`, { headers: { apikey: SVC, Authorization: `Bearer ${SVC}` }, signal: AbortSignal.timeout(10000) });
    if (!u.ok) throw new Error(`auth HTTP ${u.status}`);
    const conta = await u.json();
    if (String(conta?.email || '').toLowerCase() === email) return p;
  }
  return null;
}

function enderecoTexto(e = {}) {
  const rua = [e.logradouro, e.numero].map((x) => String(x || '').trim()).filter(Boolean).join(', ');
  const cid = String(e.cidade || '').trim();
  const uf = String(e.uf || '').trim().toUpperCase();
  return [rua, String(e.complemento || '').trim(), String(e.bairro || '').trim(), cid && `${cid}${uf ? `/${uf}` : ''}`, soDigitos(e.cep).length === 8 ? `CEP ${soDigitos(e.cep).replace(/^(\d{5})(\d{3})$/, '$1-$2')}` : '']
    .filter(Boolean).join(', ');
}

async function sha256(t) {
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!SUPABASE_URL || !SVC) return json({ error: 'Configuração ausente' }, 500);
  const ip = getIP(req);
  const rl = await checkRateLimit(`cobranca-avulsa-termo:${ip}`, 10, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const id = String(b?.id || '');
  if (!UUID_RE.test(id)) return json({ error: 'Link inválido.' }, 400);
  const cpf = soDigitos(b?.cpf);
  const email = String(b?.email || '').trim().toLowerCase();
  if (cpf.length !== 11 || !validarCPF(cpf)) return json({ error: 'CPF inválido.' }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: 'E-mail inválido.' }, 400);

  const rc = await sb(`cobrancas_avulsas?id=eq.${id}&select=id,status,termo_texto,termo_aceito_em&limit=1`);
  if (!rc.ok) return json({ error: 'Não consegui abrir esta cobrança agora. Tente em instantes.' }, 503);
  const [cob] = await rc.json();
  if (!cob) return json({ error: 'Cobrança não encontrada.' }, 404);
  if (!cob.termo_texto) return json({ error: 'Esta cobrança não tem termo de aceite.' }, 400);
  if (cob.status !== 'aberta') return json({ error: 'Esta cobrança já foi paga ou cancelada.' }, 409);

  let conta;
  try { conta = await contaDoCliente(cpf, email); }
  catch (e) {
    console.error('[cobranca-avulsa-termo] conferência do cadastro falhou:', String(e?.message || e).slice(0, 120));
    return json({ error: 'Não consegui conferir seu cadastro agora. Tente em instantes.' }, 503);
  }

  if (b?.acao === 'identificar') {
    if (!conta) return json({ cadastrado: false });
    return json({ cadastrado: true, dados: {
      nome: conta.nome || '', telefone: conta.telefone || '',
      endereco: { logradouro: conta.endereco_logradouro || '', numero: conta.endereco_numero || '', complemento: conta.endereco_complemento || '',
        bairro: conta.endereco_bairro || '', cidade: conta.endereco_cidade || '', uf: conta.endereco_uf || '', cep: conta.endereco_cep || '' },
      endereco_texto: enderecoDoPerfil(conta) || '',
    } });
  }

  if (b?.acao !== 'aceitar') return json({ error: 'acao deve ser identificar ou aceitar' }, 400);
  if (cob.termo_aceito_em) return json({ ok: true, jaAceito: true });
  if (b?.aceite !== true) return json({ error: 'É preciso marcar o aceite do termo.' }, 400);
  const nomeErro = erroNome(b?.nome);
  if (nomeErro) return json({ error: nomeErro }, 400);
  const nome = normalizarNome(b?.nome);
  const telefone = soDigitos(b?.telefone);
  if (telefone.length < 10 || telefone.length > 13) return json({ error: 'Telefone inválido (DDD + número).' }, 400);
  const e = b?.endereco || {};
  if (!String(e.logradouro || '').trim() || !String(e.numero || '').trim() || !String(e.cidade || '').trim() || !/^[A-Za-z]{2}$/.test(String(e.uf || '').trim()))
    return json({ error: 'Endereço incompleto: informe rua, número, cidade e UF.' }, 400);
  const endereco = enderecoTexto(e);

  const textoFinal = preencherSignatario(cob.termo_texto, { nome, documento: cpf, endereco });
  if (temMarcadorSignatario(textoFinal)) return json({ error: 'Não consegui completar o termo com seus dados. Confira nome, CPF e endereço.' }, 400);
  const aceite = {
    nome, cpf: formatarDocumento(cpf), email, telefone, endereco, user_id: conta?.id || null,
    ip, user_agent: (req.headers.get('user-agent') || '').slice(0, 300),
    hash_sha256: await sha256(textoFinal), texto_aceito: textoFinal, aceito_em: new Date().toISOString(),
  };
  // Só grava se ainda não havia aceite (corrida de dois cliques) e a cobrança segue aberta; `select` prova o que mudou.
  const ru = await sb(`cobrancas_avulsas?id=eq.${id}&termo_aceito_em=is.null&status=eq.aberta`, {
    method: 'PATCH', headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ termo_aceito_em: aceite.aceito_em, termo_aceite: aceite, destinatario_nome: nome, destinatario_email: email }),
  });
  if (!ru.ok) return json({ error: 'Não consegui registrar o aceite agora. Tente em instantes.' }, 503);
  const gravado = await ru.json().catch(() => []);
  if (!gravado.length) return json({ ok: true, jaAceito: true });
  return json({ ok: true, aceito_em: aceite.aceito_em });
}
