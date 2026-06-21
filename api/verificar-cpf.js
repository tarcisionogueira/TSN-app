export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

const PLANOS_COM_CURSOS = ['top1', 'top2', 'assessorado', 'clube', 'analista', 'advogado', 'admin'];

export default async function handler(req) {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });
  if (!SUPABASE_SERVICE_KEY) return new Response(JSON.stringify({ error: 'Configuração interna ausente' }), { status: 500 });

  const { cpf, email, produto } = await req.json();

  // Verificação de email único
  if (email && !cpf) {
    const re = await fetch(
      `${SUPABASE_URL}/rest/v1/perfis?email=eq.${encodeURIComponent(email)}&select=id`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const rows = await re.json();
    const existe = Array.isArray(rows) && rows.length > 0;
    return new Response(JSON.stringify({ temConta: existe, campo: 'email' }),
      { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
  }

  if (!cpf) return new Response(JSON.stringify({ temConta: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const cpfLimpo = cpf.replace(/\D/g, '');
  if (cpfLimpo.length < 11) return new Response(JSON.stringify({ temConta: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/perfis?cpf=eq.${cpfLimpo}&select=id,role,plano`,
    { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } }
  );
  const perfis = await r.json();
  if (!perfis?.length) return new Response(JSON.stringify({ temConta: false }), { status: 200, headers: { 'Content-Type': 'application/json' } });

  const perfil = perfis[0];
  const role = perfil.role || 'explorador';

  // Verifica se já tem acesso ao produto desejado
  let temAcesso = false;
  if (produto?.tipo === 'plano') {
    // Para upgrade de plano, tem acesso se já está neste plano ou superior
    const hierarquia = ['explorador', 'top1', 'top2', 'assessorado', 'clube'];
    const nivelAtual = hierarquia.indexOf(role);
    const nivelDesejado = hierarquia.indexOf(produto.planoKey);
    temAcesso = nivelAtual >= nivelDesejado && nivelDesejado >= 0;
  } else if (produto?.tipo === 'curso' || produto?.tipo === 'ebook') {
    // Cursos e ebooks incluídos nos planos pagos
    temAcesso = PLANOS_COM_CURSOS.includes(role);
  }

  return new Response(
    JSON.stringify({ temConta: true, role, temAcesso, userId: perfil.id }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } }
  );
}
