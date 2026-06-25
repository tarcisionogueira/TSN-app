/**
 * POST /api/mp-saque
 * Gerencia solicitações de saque de comissão para consultores/analistas/advogados.
 *
 * Actions:
 *  solicitar  — profissional solicita saque (status: pendente)
 *  listar     — admin lista saques pendentes / processados
 *  aprovar    — admin aprova e registra transferência (dia fixo: sexta-feira)
 *  rejeitar   — admin rejeita com motivo
 *
 * Dia de pagamento: toda sexta-feira (cron semanal notifica admin com resumo)
 */

export const config = { runtime: 'edge' };

import { getAuthUser } from './_auth.js';

const SUPABASE    = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

async function sbFetch(path, opts = {}) {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  try { return { ok: res.ok, data: JSON.parse(text), status: res.status }; }
  catch { return { ok: res.ok, data: text, status: res.status }; }
}

async function getRole(userId) {
  const r = await sbFetch(`perfis?id=eq.${userId}&select=role,nome,email,dados_bancarios`);
  return r.data?.[0] || null;
}

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response('ok', { status: 200 });
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });

  let user;
  try { user = await getAuthUser(req); } catch { /* falls through to null check */ }
  if (!user) return new Response(JSON.stringify({ error: 'Não autenticado' }), { status: 401 });

  let body;
  try { body = await req.json(); } catch {
    return new Response(JSON.stringify({ error: 'Body inválido' }), { status: 400 });
  }

  const { action } = body;
  const perfil = await getRole(user.id);
  const isAdmin = perfil?.role === 'admin';

  try {
    // ── Solicitar saque ────────────────────────────────────────────────────
    if (action === 'solicitar') {
      const roles = ['consultor', 'analista', 'advogado'];
      if (!roles.includes(perfil?.role)) {
        return new Response(JSON.stringify({ error: 'Apenas profissionais da equipe podem solicitar saques' }), { status: 403 });
      }

      const { valor, chave_pix, banco, agencia, conta, tipo_conta, observacao } = body;
      if (!valor || Number(valor) <= 0) {
        return new Response(JSON.stringify({ error: 'Informe um valor válido' }), { status: 400 });
      }
      if (!chave_pix && (!banco || !agencia || !conta)) {
        return new Response(JSON.stringify({ error: 'Informe chave PIX ou dados bancários (banco, agência, conta)' }), { status: 400 });
      }

      // Impede duplicatas de saque pendente
      const { data: pendentes } = await sbFetch(`mp_saques?user_id=eq.${user.id}&status=eq.pendente&select=id`);
      if (pendentes?.length > 0) {
        return new Response(JSON.stringify({ error: 'Já existe um saque pendente em análise.' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }

      const row = {
        user_id:      user.id,
        nome_solicitante: perfil.nome,
        email_solicitante: perfil.email,
        role:         perfil.role,
        valor:        Number(valor),
        chave_pix:    chave_pix || null,
        banco:        banco || null,
        agencia:      agencia || null,
        conta:        conta || null,
        tipo_conta:   tipo_conta || 'corrente',
        observacao:   observacao || null,
        status:       'pendente',
        solicitado_em: new Date().toISOString(),
      };

      const { ok, data } = await sbFetch('mp_saques', {
        method: 'POST',
        body: JSON.stringify(row),
      });

      if (!ok) throw new Error(data?.message || 'Erro ao registrar solicitação');
      return new Response(JSON.stringify({ ok: true, saque: data[0] }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Listar saques ──────────────────────────────────────────────────────
    if (action === 'listar') {
      const STATUS_VALIDOS = ['pendente', 'pago', 'rejeitado', 'todos'];
      const filtroStatus = STATUS_VALIDOS.includes(body.status) ? body.status : 'pendente';
      let query = `mp_saques?order=solicitado_em.desc`;
      if (!isAdmin) {
        query += `&user_id=eq.${user.id}`;
      }
      if (filtroStatus !== 'todos') {
        query += `&status=eq.${filtroStatus}`;
      }
      const { data } = await sbFetch(query);
      return new Response(JSON.stringify(data || []), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Aprovar saque (admin) ──────────────────────────────────────────────
    if (action === 'aprovar') {
      if (!isAdmin) return new Response(JSON.stringify({ error: 'Acesso negado' }), { status: 403 });

      const { saqueId, comprovante_url, observacao_admin, antecipado } = body;
      if (!saqueId) return new Response(JSON.stringify({ error: 'saqueId obrigatório' }), { status: 400 });

      // Pagamentos somente na sexta-feira, exceto quando admin marca antecipado=true
      const hoje = new Date();
      const diaSemana = hoje.getUTCDay(); // 5 = sexta
      if (diaSemana !== 5 && !antecipado) {
        const diasParaSexta = (5 - diaSemana + 7) % 7 || 7;
        return new Response(JSON.stringify({
          error: `Pagamentos são processados toda sexta-feira. Próxima sexta em ${diasParaSexta} dia(s). Use antecipado=true para liberar agora.`,
          diasParaSexta,
        }), { status: 422, headers: { 'Content-Type': 'application/json' } });
      }

      const { ok } = await sbFetch(`mp_saques?id=eq.${saqueId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status:            'pago',
          aprovado_por:      user.id,
          aprovado_em:       new Date().toISOString(),
          comprovante_url:   comprovante_url || null,
          observacao_admin:  observacao_admin || null,
          antecipado:        antecipado ? true : false,
        }),
      });

      if (!ok) throw new Error('Erro ao atualizar saque');
      return new Response(JSON.stringify({ ok: true, antecipado: !!antecipado }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    // ── Rejeitar saque (admin) ─────────────────────────────────────────────
    if (action === 'rejeitar') {
      if (!isAdmin) return new Response(JSON.stringify({ error: 'Acesso negado' }), { status: 403 });

      const { saqueId, motivo } = body;
      if (!saqueId) return new Response(JSON.stringify({ error: 'saqueId obrigatório' }), { status: 400 });

      await sbFetch(`mp_saques?id=eq.${saqueId}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          status:           'rejeitado',
          aprovado_por:     user.id,
          aprovado_em:      new Date().toISOString(),
          observacao_admin: motivo || null,
        }),
      });

      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ error: `Action desconhecida: ${action}` }), { status: 400 });
  } catch (err) {
    console.error('[mp-saque]', err.message);
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
