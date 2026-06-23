export const config = { runtime: 'edge' };
import { getUser, getUserRole, unauthorized, forbidden } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SVC = process.env.SUPABASE_SERVICE_KEY;

const PLANOS_COM_CONTEUDO = ['top1', 'top2', 'assessorado', 'clube', 'analista', 'advogado', 'admin'];

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SVC, Authorization: `Bearer ${SVC}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

export default async function handler(req) {

  const user = await getUser(req);
  if (!user) return unauthorized();
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SVC) return new Response(JSON.stringify({ error: 'Configuração ausente' }), { status: 500 });

  const { cpf, email, produto } = await req.json();
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': process.env.APP_BASE_URL || 'https://bidprobrasil.com.br' };

  // ── Verificação de email único ──
  if (email && !cpf) {
    const r = await sb(`perfis?email=eq.${encodeURIComponent(email)}&select=id`);
    const rows = await r.json();
    return new Response(JSON.stringify({ temConta: Array.isArray(rows) && rows.length > 0, campo: 'email' }), { status: 200, headers });
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

  // Sem produto específico — só informa que tem conta
  if (!produto) {
    return new Response(JSON.stringify({ temConta: true, role, temAcesso: false, ehBeneficio: false }), { status: 200, headers });
  }

  // ── Verifica se é produto de plano (assinatura) ──
  if (produto.tipo === 'plano') {
    const hierarquia = ['explorador', 'top1', 'top2', 'assessorado', 'clube'];
    const nivelAtual = hierarquia.indexOf(role);
    const nivelDesejado = hierarquia.indexOf(produto.planoKey);
    const temAcesso = nivelAtual >= nivelDesejado && nivelDesejado >= 0;
    return new Response(JSON.stringify({ temConta: true, role, temAcesso, ehBeneficio: true, userId }), { status: 200, headers });
  }

  // ── Verifica curso ou ebook ──
  if (produto.tipo === 'curso' || produto.tipo === 'ebook') {
    const tabela = produto.tipo === 'curso' ? 'cursos_admin' : 'ebooks_admin';

    // Busca o produto para saber o preço
    const rp = await sb(`${tabela}?id=eq.${produto.id}&select=preco`);
    const [prod] = await rp.json();
    const preco = Number(prod?.preco || 0);
    const ehBeneficio = preco === 0; // preço 0 = incluído na assinatura

    if (ehBeneficio) {
      // Produto gratuito/incluído — tem acesso se tiver plano pago
      const temAcesso = PLANOS_COM_CONTEUDO.includes(role);
      return new Response(JSON.stringify({ temConta: true, role, temAcesso, ehBeneficio: true, userId }), { status: 200, headers });
    } else {
      // Produto pago avulso — verifica se já comprou individualmente
      const rc = await sb(`compras_produtos?user_id=eq.${userId}&produto_tipo=eq.${produto.tipo}&produto_id=eq.${produto.id}&status=eq.ativo&select=id`);
      const compras = await rc.json();
      const jaComprou = Array.isArray(compras) && compras.length > 0;
      return new Response(
        JSON.stringify({ temConta: true, role, temAcesso: jaComprou, ehBeneficio: false, produtoPago: true, userId }),
        { status: 200, headers }
      );
    }
  }

  return new Response(JSON.stringify({ temConta: true, role, temAcesso: false, ehBeneficio: false, userId }), { status: 200, headers });
}
