export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

const PLANOS_COM_CONTEUDO = ['top1', 'top2', 'assessorado', 'clube', 'analista', 'advogado', 'admin'];

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
  const res = await sb(
    `verificar_cpf_rate?ip=eq.${encodeURIComponent(ip)}&criado_em=gte.${window}&select=id`
  ).catch(() => null);
  if (!res?.ok) return false; // tabela não existe ainda, permite
  const rows = await res.json().catch(() => []);
  if (Array.isArray(rows) && rows.length >= 10) return true; // bloqueado

  // Registra nova tentativa (fire-and-forget)
  sb('verificar_cpf_rate', {
    method: 'POST',
    body: JSON.stringify({ ip }),
    headers: { Prefer: 'return=minimal' },
  }).catch(() => {});

  return false;
}

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };

  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || '';
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
  const r = await sb(`perfis?cpf=eq.${cpfLimpo}&select=id,role`);
  const perfis = await r.json();
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
    const hierarquia = ['explorador', 'top1', 'top2', 'assessorado', 'clube'];
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
