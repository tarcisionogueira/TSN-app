export const config = { runtime: 'edge' };

import { hashCpf } from './_cpf.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

const PLANOS_COM_CONTEUDO = ['top2', 'assessorado', 'clube', 'analista', 'advogado', 'admin'];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// Rate limiting: registra tentativa e bloqueia se exceder limite por IP
async function checkRateLimit(ip) {
  if (!ip) return false; // sem IP, permite (ambiente dev)
  const window = new Date(Date.now() - 60_000).toISOString(); // últimos 60s
  // Registra a tentativa PRIMEIRO e AGUARDA. No Edge, trabalho não-aguardado antes de
  // devolver o Response não tem execução garantida — o insert era fire-and-forget e a
  // linha quase nunca era gravada, então o teto de 6/min/IP ficava furável (enumeração
  // de CPF/e-mail). Aguardar garante o registro; inserir ANTES de contar também reduz a
  // corrida read-then-write. A tabela vive no banco → o limite é cross-instância (não
  // depende de instância quente nem de Upstash).
  await sb('verificar_cpf_rate', {
    method: 'POST',
    body: JSON.stringify({ ip }),
    headers: { Prefer: 'return=minimal' },
  }).catch(() => {});
  const res = await sb(
    `verificar_cpf_rate?ip=eq.${encodeURIComponent(ip)}&criado_em=gte.${window}&select=id`
  ).catch(() => null);
  if (!res?.ok) return false; // infra de rate-limit indisponível → fail-open (não bloqueia tráfego legítimo)
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) && rows.length > 6; // > 6 (inclui a tentativa atual) = bloqueado
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

  // IP CONFIÁVEL para o rate-limit: x-real-ip/x-vercel-forwarded-for são setados pela
  // Vercel e não são falsificáveis. Antes usava o 1º item do x-forwarded-for, que o
  // cliente injeta a cada request → o limite de enumeração de CPF/e-mail era furável.
  const ip = req.headers.get('x-real-ip')
    || req.headers.get('x-vercel-forwarded-for')
    || (req.headers.get('x-forwarded-for')?.split(',').map((s) => s.trim()).filter(Boolean).pop())
    || '';
  const bloqueado = await checkRateLimit(ip);
  if (bloqueado) {
    return new Response(JSON.stringify({ error: 'Muitas tentativas. Aguarde 1 minuto.' }), { status: 429, headers });
  }

  const { cpf, email, produto } = await req.json();

  // ── Verificação de email único ──
  // perfis não armazena e-mail; usa a função email_existe (SECURITY DEFINER)
  // que checa o Auth sem expor qual usuário.
  if (email && !cpf) {
    const r = await sb('rpc/email_existe', { method: 'POST', body: JSON.stringify({ p_email: email }) });
    const existe = await r.json().catch(() => false);
    return new Response(JSON.stringify({ temConta: existe === true, campo: 'email' }), { status: 200, headers });
  }

  if (!cpf) return new Response(JSON.stringify({ temConta: false }), { status: 200, headers });

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length < 11) return new Response(JSON.stringify({ temConta: false }), { status: 200, headers });

  // ── Busca perfil pelo CPF ──
  // Preferência: pelo hash determinístico (não expõe o CPF cru na query).
  // Fallback: pelo texto claro, para perfis ainda não migrados (backfill em curso).
  let perfis = [];
  const cpfHash = await hashCpf(cpfLimpo).catch(() => null);
  if (cpfHash) {
    const rh = await sb(`perfis?cpf_hash=eq.${cpfHash}&select=id,role`);
    perfis = await rh.json().catch(() => []);
  }
  if (!Array.isArray(perfis) || !perfis.length) {
    const r = await sb(`perfis?cpf=eq.${cpfLimpo}&select=id,role`);
    perfis = await r.json().catch(() => []);
  }
  if (!Array.isArray(perfis) || !perfis.length) {
    return new Response(JSON.stringify({ temConta: false }), { status: 200, headers });
  }

  const { id: userId, role } = perfis[0];

  // Sem produto específico — só informa que tem conta (nunca expõe userId)
  if (!produto) {
    return new Response(JSON.stringify({ temConta: true, temAcesso: false, ehBeneficio: false }), { status: 200, headers });
  }

  // ── Verifica se é produto de plano (assinatura) ──
  if (produto.tipo === 'plano') {
    const hierarquia = ['explorador', 'top2', 'assessorado', 'clube'];
    const nivelAtual = hierarquia.indexOf(role);
    const nivelDesejado = hierarquia.indexOf(produto.planoKey);
    const temAcesso = nivelAtual >= nivelDesejado && nivelDesejado >= 0;
    return new Response(JSON.stringify({ temConta: true, temAcesso, ehBeneficio: true }), { status: 200, headers });
  }

  // ── Verifica curso ou ebook ──
  if (produto.tipo === 'curso' || produto.tipo === 'ebook') {
    const tabela = produto.tipo === 'curso' ? 'cursos_admin' : 'ebooks_admin';
    const rp = await sb(`${tabela}?id=eq.${encodeURIComponent(produto.id)}&select=preco`);
    const [prod] = await rp.json();
    const preco = Number(prod?.preco || 0);
    const ehBeneficio = preco === 0;

    if (ehBeneficio) {
      const temAcesso = PLANOS_COM_CONTEUDO.includes(role);
      return new Response(JSON.stringify({ temConta: true, temAcesso, ehBeneficio: true }), { status: 200, headers });
    } else {
      const rc = await sb(`compras_produtos?user_id=eq.${encodeURIComponent(userId)}&produto_tipo=eq.${encodeURIComponent(produto.tipo)}&produto_id=eq.${encodeURIComponent(produto.id)}&status=eq.ativo&select=id`);
      const compras = await rc.json();
      const jaComprou = Array.isArray(compras) && compras.length > 0;
      return new Response(
        JSON.stringify({ temConta: true, temAcesso: jaComprou, ehBeneficio: false, produtoPago: true }),
        { status: 200, headers }
      );
    }
  }

  return new Response(JSON.stringify({ temConta: true, temAcesso: false, ehBeneficio: false }), { status: 200, headers });
}
