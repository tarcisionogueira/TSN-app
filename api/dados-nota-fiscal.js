/**
 * /api/dados-nota-fiscal — dados do TOMADOR da nota fiscal (ver api/_dados-nf.js).
 *
 *  POST { cobranca_id,   dados }  → cobrancas_avulsas.dados_nf   (público: o uuid do link é a credencial)
 *  POST { arrematacao_id, dados } → arrematacoes.dados_nf        (público: idem, página do honorário)
 *  POST { perfil: true,  dados }  → perfis (endereço + CPF cifrado) — exige login (e-book e demais compras)
 *  GET  ?perfil=1                 → visão mascarada dos dados do perfil logado
 *
 * `doc` em branco mantém o documento já informado: a tela só vê o documento mascarado.
 */
export const config = { runtime: 'edge' };
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { getAuthUser } from './_auth.js';
import { cpfDoRegistro, hashCpf, encryptCpf, cpfCriptoAtivo } from './_cpf.js';
import { mesclar, faltando, visaoPublica, aPartirDoAceite, aPartirDoPerfil, COLUNAS_PERFIL_NF } from './_dados-nf.js';

const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });
const H = { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json' };

async function ler(path) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { headers: H, signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error(`leitura HTTP ${r.status}: ${path.split('?')[0]}`);
  return r.json();
}
async function patch(path, body) {
  const r = await fetch(`${SB}/rest/v1/${path}${path.includes('?') ? '&' : '?'}select=id`, {
    method: 'PATCH', headers: { ...H, Prefer: 'return=representation' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`gravação HTTP ${r.status}: ${path.split('?')[0]}`);
  return (await r.json()).length > 0;
}
async function emailDaConta(id) {
  const r = await fetch(`${SB}/auth/v1/admin/users/${id}`, { headers: H, signal: AbortSignal.timeout(8000) });
  return r.ok ? ((await r.json().catch(() => null))?.email || '') : '';
}

// Dados do perfil do usuário (com o CPF decifrado só aqui dentro).
async function nfDoPerfil(userId, email) {
  const [p] = await ler(`perfis?id=eq.${userId}&select=${COLUNAS_PERFIL_NF}&limit=1`);
  if (!p) return null;
  return aPartirDoPerfil(p, { cpf: await cpfDoRegistro(p), email });
}

export default async function handler(req) {
  const rl = await checkRateLimit(`dados-nf:${getIP(req)}`, 20, 60_000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  try {
    if (req.method === 'GET') {
      if (new URL(req.url).searchParams.get('perfil') !== '1') return json({ error: 'parâmetros inválidos' }, 400);
      const user = await getAuthUser(req);
      if (!user?.id) return json({ error: 'Faça login.' }, 401);
      return json({ ok: true, nf: visaoPublica(await nfDoPerfil(user.id, user.email)) });
    }
    if (req.method !== 'POST') return json({ error: 'Método não permitido' }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    // ── PERFIL (logado) ──────────────────────────────────────────────────────────────────────────
    if (b?.perfil === true) {
      const user = await getAuthUser(req);
      if (!user?.id) return json({ error: 'Faça login.' }, 401);
      const dados = mesclar(await nfDoPerfil(user.id, user.email), b?.dados || {});
      if (dados.tipo === 'PJ') return json({ error: 'No seu cadastro a nota sai no seu CPF. Para nota em nome de empresa, fale com o Atendimento.' }, 400);
      const f = faltando(dados);
      if (f.length) return json({ error: `Para a nota fiscal, falta: ${f.join(', ')}.`, faltando: f }, 400);
      const campos = {
        nome: dados.nome, endereco_cep: dados.cep, endereco_logradouro: dados.logradouro, endereco_numero: dados.numero,
        endereco_complemento: dados.complemento || null, endereco_bairro: dados.bairro, endereco_cidade: dados.cidade, endereco_uf: dados.uf,
        endereco: `${dados.logradouro}, ${dados.numero}${dados.complemento ? ` ${dados.complemento}` : ''} · ${dados.bairro} · ${dados.cidade} - ${dados.uf} · CEP ${dados.cep}`,
      };
      // CPF só em hash + cifra (mesma regra de api/cpf-set.js); sem a chave configurada, não grava CPF em claro.
      if (cpfCriptoAtivo()) {
        const [cpf_hash, cpf_enc] = await Promise.all([hashCpf(dados.doc), encryptCpf(dados.doc)]);
        Object.assign(campos, { cpf: null, cpf_hash, cpf_enc });
      }
      if (!(await patch(`perfis?id=eq.${user.id}`, campos))) return json({ error: 'Perfil não encontrado.' }, 404);
      return json({ ok: true, nf: visaoPublica(dados) });
    }

    // ── COBRANÇA AVULSA ──────────────────────────────────────────────────────────────────────────
    if (b?.cobranca_id) {
      const id = String(b.cobranca_id);
      if (!UUID_RE.test(id)) return json({ error: 'cobranca_id inválido' }, 400);
      const [cob] = await ler(`cobrancas_avulsas?id=eq.${id}&select=id,status,termo_texto,termo_aceito_em,termo_aceite,dados_nf&limit=1`);
      if (!cob) return json({ error: 'Cobrança não encontrada.' }, 404);
      if (cob.status !== 'aberta') return json({ error: 'Esta cobrança já foi paga ou cancelada.' }, 409);
      if (cob.termo_texto && !cob.termo_aceito_em) return json({ error: 'Leia e aceite o termo antes.' }, 409);
      const dados = mesclar(cob.dados_nf || aPartirDoAceite(cob.termo_aceite), b?.dados || {});
      const f = faltando(dados);
      if (f.length) return json({ error: `Para a nota fiscal, falta: ${f.join(', ')}.`, faltando: f }, 400);
      if (!(await patch(`cobrancas_avulsas?id=eq.${id}&status=eq.aberta`, { dados_nf: { ...dados, gravado_em: new Date().toISOString() } }))) {
        return json({ error: 'Esta cobrança já foi paga ou cancelada.' }, 409);
      }
      return json({ ok: true, nf: visaoPublica(dados) });
    }

    // ── HONORÁRIO DE ÊXITO ───────────────────────────────────────────────────────────────────────
    if (b?.arrematacao_id) {
      const id = String(b.arrematacao_id);
      if (!UUID_RE.test(id)) return json({ error: 'arrematacao_id inválido' }, 400);
      const [arr] = await ler(`arrematacoes?id=eq.${id}&select=id,arrematante_id,honorarios_status,dados_nf&limit=1`);
      if (!arr) return json({ error: 'Cobrança não encontrada.' }, 404);
      if (['pago', 'distribuido'].includes(arr.honorarios_status)) return json({ error: 'Os honorários desta arrematação já foram pagos.' }, 409);
      const base = arr.dados_nf || (arr.arrematante_id ? await nfDoPerfil(arr.arrematante_id, await emailDaConta(arr.arrematante_id)) : null);
      const dados = mesclar(base, b?.dados || {});
      const f = faltando(dados);
      if (f.length) return json({ error: `Para a nota fiscal, falta: ${f.join(', ')}.`, faltando: f }, 400);
      if (!(await patch(`arrematacoes?id=eq.${id}`, { dados_nf: { ...dados, gravado_em: new Date().toISOString() } }))) {
        return json({ error: 'Cobrança não encontrada.' }, 404);
      }
      return json({ ok: true, nf: visaoPublica(dados) });
    }

    return json({ error: 'Informe a cobrança, o honorário ou o perfil.' }, 400);
  } catch (e) {
    console.error('[dados-nota-fiscal]', e?.message || e);
    return json({ error: 'Não consegui salvar agora. Tente de novo em instantes.' }, 502);
  }
}
