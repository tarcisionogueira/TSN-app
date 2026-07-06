export const config = { runtime: 'edge' };

// Finalização da assinatura eletrônica de contrato (link público).
// Feito no servidor para ter prova jurídica idônea (Lei 14.063/2020):
//  - IP capturado no servidor (x-forwarded-for), não confiável se vindo do cliente
//  - carimbo de tempo do servidor
//  - hash SHA-256 que INCLUI o conteúdo do contrato (detecta adulteração)
//  - gravação via service key (o cliente não altera a tabela direto)

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
  const { token, tipo_pessoa, dados, assinatura, docs_identidade, testemunha } = body || {};
  if (!token || !assinatura || !dados) {
    return new Response(JSON.stringify({ error: 'Dados de assinatura incompletos' }), { status: 400, headers });
  }

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;

  // Carrega o contrato pelo token (service key — ignora RLS)
  const r = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}&select=id,conteudo,status,expira_em`);
  const rows = await r.json().catch(() => []);
  const contrato = Array.isArray(rows) ? rows[0] : null;
  if (!contrato) return new Response(JSON.stringify({ error: 'Contrato não encontrado' }), { status: 404, headers });
  if (!['aguardando', 'aguardando_assinatura'].includes(contrato.status)) {
    return new Response(JSON.stringify({ error: 'Este contrato não está mais disponível para assinatura' }), { status: 409, headers });
  }
  if (contrato.expira_em && new Date(contrato.expira_em) < new Date()) {
    return new Response(JSON.stringify({ error: 'Link de assinatura expirado' }), { status: 410, headers });
  }

  const assinado_em = new Date().toISOString();
  // Hash inclui o CONTEÚDO do contrato → vincula a assinatura ao texto assinado
  const hash = await sha256((contrato.conteudo || '') + JSON.stringify(dados) + assinatura + token + assinado_em);

  const patch = await sb(`contratos_link?token=eq.${encodeURIComponent(token)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({
      status: 'assinado',
      tipo_pessoa: tipo_pessoa || null,
      dados_signatario: dados,
      assinatura,
      assinado_em,
      assinante_ip: ip,
      assinatura_hash: hash,
      docs_identidade: docs_identidade || null,
      // Testemunha (quando o contrato exige assinatura de testemunha)
      ...(testemunha && testemunha.assinatura ? {
        nome_testemunha: String(testemunha.nome || '').slice(0, 160),
        cpf_testemunha: String(testemunha.cpf || '').replace(/\D/g, '').slice(0, 11),
        assinatura_testemunha: testemunha.assinatura,
        testemunha_em: assinado_em,
      } : {}),
    }),
  });
  if (!patch.ok) {
    const txt = await patch.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'Falha ao registrar assinatura', detalhe: txt.slice(0, 200) }), { status: 500, headers });
  }

  // Trilha de auditoria (best-effort)
  sb('audit_logs', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ acao: 'contrato_assinado', ip, sucesso: true, detalhes: { contrato_id: contrato.id, token, hash } }),
  }).catch(() => {});

  return new Response(JSON.stringify({ ok: true, assinado_em, hash }), { status: 200, headers });
}
