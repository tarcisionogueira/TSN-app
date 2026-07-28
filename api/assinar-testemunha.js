export const config = { runtime: 'edge' };

import { enviarEmail } from './_email.js';

// Assinatura da TESTEMUNHA por link próprio (pedido do dono): a parte encaminha o link da sua
// testemunha; ela abre, confere o contrato, preenche nome/CPF e assina — sem precisar estar
// junto da parte. Grava na MESMA linha do contrato (nome/cpf/assinatura/carimbo da testemunha).
// Prova idônea igual à da parte: IP + carimbo do servidor + hash SHA-256 do conteúdo.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function handler(req) {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500, headers });

  let body;
  try { body = await req.json(); } catch { return new Response(JSON.stringify({ error: 'JSON inválido' }), { status: 400, headers }); }
  const { testemunha_token, nome, cpf, assinatura } = body || {};
  if (!testemunha_token || !assinatura || !nome) {
    return new Response(JSON.stringify({ error: 'Dados da testemunha incompletos' }), { status: 400, headers });
  }
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(String(testemunha_token))) {
    return new Response(JSON.stringify({ error: 'Link inválido' }), { status: 400, headers });
  }
  const cpfLimpo = String(cpf || '').replace(/\D/g, '');
  if (cpfLimpo.length !== 11) return new Response(JSON.stringify({ error: 'CPF da testemunha inválido' }), { status: 400, headers });

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  // Carrega o contrato pelo TOKEN DA TESTEMUNHA (service key — ignora RLS).
  const r = await sb(`contratos_link?testemunha_token=eq.${encodeURIComponent(testemunha_token)}&select=id,conteudo,titulo,criado_por,requer_testemunha,testemunha_em,expira_em`);
  const rows = await r.json().catch(() => []);
  const contrato = Array.isArray(rows) ? rows[0] : null;
  if (!contrato || !contrato.requer_testemunha) return new Response(JSON.stringify({ error: 'Contrato não encontrado' }), { status: 404, headers });
  if (contrato.testemunha_em) return new Response(JSON.stringify({ error: 'A testemunha deste contrato já assinou.' }), { status: 409, headers });
  if (contrato.expira_em && new Date(contrato.expira_em) < new Date()) {
    return new Response(JSON.stringify({ error: 'Este link expirou.' }), { status: 410, headers });
  }

  const testemunha_em = new Date().toISOString();
  const hash = await sha256((contrato.conteudo || '') + nome + cpfLimpo + assinatura + testemunha_token + testemunha_em);

  const patch = await sb(`contratos_link?testemunha_token=eq.${encodeURIComponent(testemunha_token)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      nome_testemunha: String(nome).slice(0, 160),
      cpf_testemunha: cpfLimpo,
      assinatura_testemunha: assinatura,
      testemunha_em,
    }),
  });
  if (!patch.ok) {
    const txt = await patch.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'Falha ao registrar assinatura da testemunha', detalhe: txt.slice(0, 200) }), { status: 500, headers });
  }

  // Auditoria (best-effort).
  sb('audit_logs', {
    method: 'POST', headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ acao: 'testemunha_assinou', ip, sucesso: true, detalhes: { contrato_id: contrato.id, hash } }),
  }).catch(() => {});

  // Notifica quem CRIOU o contrato + registra na linha do tempo (Cliente 360). Best-effort.
  try {
    const titulo = contrato.titulo || 'Contrato';
    if (contrato.criado_por) {
      const p = await sb(`perfis?id=eq.${encodeURIComponent(contrato.criado_por)}&select=email,nome`).then(x => x.json()).catch(() => []);
      const email = p?.[0]?.email || null;
      if (email) {
        const origin = req.headers.get('origin') || process.env.APP_ORIGIN || 'https://bidprobrasil.com.br';
        await enviarEmail({
          to: email,
          subject: `✍️ Testemunha assinou: ${titulo}`,
          html: `<p>A testemunha <strong>${String(nome).slice(0, 120)}</strong> assinou o contrato <strong>${titulo}</strong>.</p>
                 <p><a href="${origin}#/contratos" style="display:inline-block;padding:10px 18px;background:#0D63DB;color:#fff;border-radius:8px;text-decoration:none;font-weight:700">Ver contratos</a></p><p>BidPro Brasil</p>`,
          meta: { tipo: 'contrato' },
        }).catch(() => {});
      }
      sb('rpc/registrar_atividade', { method: 'POST', body: JSON.stringify({
        p_user_id: contrato.criado_por, p_evento: 'testemunha_assinou',
        p_detalhe: `Testemunha ${String(nome).slice(0, 80)} assinou "${titulo}"`,
        p_meta: { contrato_id: contrato.id },
      }) }).catch(() => {});
    }
  } catch { /* notificação best-effort */ }

  return new Response(JSON.stringify({ ok: true, testemunha_em, hash }), { status: 200, headers });
}
