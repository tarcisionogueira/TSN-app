export const config = { runtime: 'edge' };
import { getUser } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  }).then(r => r.json());
}

export default async function handler(req) {
  if (req.method !== 'GET') return new Response('Method not allowed', { status: 405 });

  const user = await getUser(req);
  if (!user) return new Response(JSON.stringify({ error: 'Não autorizado' }), { status: 401 });

  const userId = user.id;

  const [perfil, compras, chamados, alertas, filtrosSalvos, buscaHistorico] = await Promise.all([
    sb(`perfis?id=eq.${userId}&select=nome,email,cpf,telefone,role,created_at`),
    sb(`compras?user_id=eq.${userId}&select=produto,valor,created_at`),
    sb(`chamados?user_id=eq.${userId}&select=titulo,status,created_at`),
    sb(`alertas_email?user_id=eq.${userId}&select=filtros,ativo,created_at`),
    sb(`filtros_salvos?user_id=eq.${userId}&select=nome,filtros,criado_em`),
    sb(`busca_historico?user_id=eq.${userId}&select=estado,cidade,tipo_imovel,criado_em&limit=100`),
  ]);

  const exportData = {
    exportado_em: new Date().toISOString(),
    titular: perfil[0] || {},
    compras: compras || [],
    chamados_suporte: chamados || [],
    alertas_email: alertas || [],
    filtros_salvos: filtrosSalvos || [],
    historico_buscas: buscaHistorico || [],
  };

  return new Response(JSON.stringify(exportData, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="meus-dados-bidpro-${new Date().toISOString().slice(0,10)}.json"`,
    },
  });
}
