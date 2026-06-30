export const config = { runtime: 'edge' };

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

function sbFetch(path, opts = {}) {
  return fetch(`${SB_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(opts.headers || {}) },
  });
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json', ...CORS } });

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const token = url.searchParams.get('token');
  if (!token) return json({ error: 'Token obrigatório' }, 400);
  // Formato estrito do token (evita injeção no filtro PostgREST via ?token=).
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(token)) return json({ error: 'Token inválido' }, 400);
  const tokenEnc = encodeURIComponent(token);

  // GET — verifica se token é válido e retorna dados já preenchidos
  if (req.method === 'GET') {
    const r = await sbFetch(`leiloeiros_parceiros?token=eq.${tokenEnc}&select=id,nome,nome_fantasia,cnpj,cpf,email,telefone,cep,logradouro,numero,complemento,bairro,municipio,uf,status&limit=1`);
    if (!r.ok) return json({ error: 'Erro interno' }, 500);
    const [parc] = await r.json();
    if (!parc) return json({ error: 'Link inválido ou expirado' }, 404);
    if (parc.status === 'suspenso') return json({ error: 'Acesso suspenso' }, 403);
    return json({ ok: true, parceiro: parc });
  }

  // POST — salva dados do cadastro
  if (req.method === 'POST') {
    let body;
    try { body = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

    const r = await sbFetch(`leiloeiros_parceiros?token=eq.${tokenEnc}&select=id,status&limit=1`);
    if (!r.ok) return json({ error: 'Erro interno' }, 500);
    const [parc] = await r.json();
    if (!parc) return json({ error: 'Link inválido' }, 404);
    if (parc.status === 'suspenso') return json({ error: 'Acesso suspenso' }, 403);

    const campos = {
      nome: String(body.nome || '').slice(0, 200),
      nome_fantasia: String(body.nome_fantasia || '').slice(0, 200),
      cnpj: String(body.cnpj || '').replace(/\D/g, '').slice(0, 14) || null,
      cpf: String(body.cpf || '').replace(/\D/g, '').slice(0, 11) || null,
      email: String(body.email || '').slice(0, 200),
      telefone: String(body.telefone || '').slice(0, 30),
      cep: String(body.cep || '').replace(/\D/g, '').slice(0, 8) || null,
      logradouro: String(body.logradouro || '').slice(0, 200),
      numero: String(body.numero || '').slice(0, 20),
      complemento: String(body.complemento || '').slice(0, 100),
      bairro: String(body.bairro || '').slice(0, 100),
      municipio: String(body.municipio || '').slice(0, 100),
      uf: String(body.uf || '').slice(0, 2).toUpperCase() || null,
      status: 'ativo',
      atualizado_em: new Date().toISOString(),
    };

    if (!campos.nome || !campos.email) return json({ error: 'Nome e email são obrigatórios' }, 400);

    const ur = await sbFetch(`leiloeiros_parceiros?id=eq.${parc.id}`, {
      method: 'PATCH',
      body: JSON.stringify(campos),
    });
    if (!ur.ok) return json({ error: 'Erro ao salvar cadastro' }, 500);
    const [atualizado] = await ur.json();
    return json({ ok: true, token: atualizado.token, nome: atualizado.nome });
  }

  return json({ error: 'Método não permitido' }, 405);
}
