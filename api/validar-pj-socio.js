/**
 * POST /api/validar-pj-socio
 * Verifica, de graça (dado aberto da Receita), se o CPF do parceiro consta no quadro
 * societário (QSA) do CNPJ que ele cadastrou. Em caso positivo (CPF + nome batem),
 * marca a PJ como validada automaticamente (pj_validada_em, via='auto_qsa') e guarda o
 * snapshot do QSA para auditoria. Na dúvida, NÃO valida — o fluxo cai para conferência
 * manual (fail-closed). Só o próprio usuário dispara para a sua conta.
 */
export const config = { runtime: 'edge' };

import { getAuthUser, unauthorized } from './_auth.js';
import { checkRateLimit, getIP, rateLimitedResponse } from './_rate-limit.js';
import { cpfDoRegistro } from './_cpf.js';
import { verificarSocioQSA } from './_pj-socio.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const json = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'Content-Type': 'application/json' } });

async function rpc(fn, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(args || {}),
  });
  const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; }
  return { ok: r.ok, data: d };
}

export default async function handler(req) {
  if (req.method !== 'POST') return json({ ok: false, error: 'Método não permitido' }, 405);

  const ip = getIP(req);
  const rl = await checkRateLimit(`validar-pj-socio:${ip}`, 8, 5 * 60 * 1000);
  if (!rl.ok) return rateLimitedResponse(rl.resetAt);

  const user = await getAuthUser(req);
  if (!user) return unauthorized();

  let body = {}; try { body = await req.json(); } catch { body = {}; }

  const res = await fetch(`${SUPABASE_URL}/rest/v1/perfis?id=eq.${user.id}&select=nome,cpf,cpf_enc,cnpj,razao_social,pj_validada_em,pj_revalidacao_pendente,role`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
  const perfil = (await res.json())?.[0];
  if (!perfil) return json({ ok: false, error: 'Perfil não encontrado' }, 404);

  // MODO DIAGNÓSTICO (só admin): testa a consulta REAL à Receita com qualquer CNPJ+CPF,
  // sem gravar nada — serve para validar a integração com dados reais.
  if (perfil.role === 'admin' && body && body.cnpj && body.cpf) {
    const r = await verificarSocioQSA({ cnpj: String(body.cnpj), cpf: String(body.cpf), nome: String(body.nome || '') });
    return json({ ok: r.ok, diagnostico: true, matched: r.matched, motivo: r.motivo, fonte: r.fonte,
      socios: (r.socios || []).map((s) => ({ nome: s.nome, cpf_masc: s.cpf_masc })) });
  }

  // Já validada e SEM pendência de revalidação → nada a fazer. Se houver revalidação pendente
  // (reconferência periódica divergiu), reprocessa a consulta para tentar limpar a pendência.
  if (perfil.pj_validada_em && !perfil.pj_revalidacao_pendente) return json({ ok: true, matched: true, ja_validada: true });
  if (!perfil.cnpj || !String(perfil.cnpj).trim()) return json({ ok: false, error: 'Cadastre o CNPJ da empresa primeiro.' }, 400);

  const cpf = await cpfDoRegistro(perfil);
  const r = await verificarSocioQSA({ cnpj: perfil.cnpj, cpf, nome: perfil.nome });

  if (r.matched) {
    await rpc('registrar_pj_validacao_auto', { p_user_id: user.id, p_snapshot: r.snapshot });
    return json({ ok: true, matched: true, via: 'auto_qsa', fonte: r.fonte });
  }
  // Não confirmou automaticamente → conferência manual (nunca auto-aprova na dúvida).
  return json({ ok: true, matched: false, motivo: r.motivo, socios: r.socios || [] });
}
