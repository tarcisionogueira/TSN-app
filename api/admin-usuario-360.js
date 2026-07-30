export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { hashCpf } from './_cpf.js';

// Fase B — Monitoramento 360º do cliente (só admin/analista).
//   GET /api/admin-usuario-360?q=termo       → busca por nome/e-mail/telefone/CPF
//                                              (q vazio = lista geral, mais recentes)
//   GET /api/admin-usuario-360?user_id=uuid  → retrato 360º do usuário
// Usa as funções SECURITY DEFINER admin_busca_usuarios/admin_usuario_360 via
// service_role — não afrouxa RLS das tabelas de análise.
const CORS = { 'Access-Control-Allow-Origin': process.env.APP_ORIGIN || 'https://bidprobrasil.com.br' };
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

async function rpc(fn, args) {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export default async function handler(req) {
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (!SB || !KEY) return new Response(JSON.stringify({ error: 'Supabase não configurado' }), { status: 500, headers: { 'Content-Type': 'application/json', ...CORS } });

  const params = new URL(req.url).searchParams;

  // POST → marcar os erros de um usuário como resolvidos (limpa a tag "erro" da lista).
  if (req.method === 'POST') {
    let body = {}; try { body = await req.json(); } catch { /* corpo vazio */ }
    const alvo = body?.user_id || params.get('user_id');
    if (body?.acao !== 'resolver_erros' || !alvo) {
      return new Response(JSON.stringify({ error: 'Ação inválida' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
    const n = await rpc('admin_resolver_erros_usuario', { p_user_id: alvo });
    return new Response(JSON.stringify(n == null ? { error: 'Falha ao resolver' } : { ok: true, resolvidos: n }), {
      status: n == null ? 502 : 200, headers: { 'Content-Type': 'application/json', ...CORS },
    });
  }

  const q = (params.get('q') || '').trim();
  const uid = params.get('user_id');
  const perfil = (params.get('perfil') || '').trim() || null;   // filtro por perfil_investidor
  const acesso = (params.get('acesso') || '').trim() || null;   // acessando | nao_acessando
  const janela = Math.min(365, Math.max(1, parseInt(params.get('janela') || '14', 10) || 14));
  const stats = params.get('stats');                             // ?stats=1 → estatísticas

  let data;
  if (stats) {
    data = await rpc('admin_360_estatisticas', {});
  } else if (uid) {
    data = await rpc('admin_usuario_360', { uid });
    // Anexa o LOG DE ATIVIDADE (movimentos: relatórios ok/erro com motivo, arremate, etc.) —
    // é o que dá diagnóstico do que o usuário (ou o admin) fez, com validade de 90 dias.
    // full=1 (dossiê): limites altos p/ exportar TODO o histórico retido (atividade ~90d,
    // navegação ~30d) — a tela normal segue com 100/200 p/ não pesar.
    const full = params.get('full') === '1';
    if (data && typeof data === 'object') {
      try { data.atividade = (await rpc('atividade_usuario', { p_user_id: uid, p_limite: full ? 2000 : 100 })) || []; } catch { data.atividade = []; }
      // Anexa a NAVEGAÇÃO/cliques (clickstream de eventos_atividade): telas vistas, cliques e
      // falhas/relatórios vazios de API — o "tudo o que o usuário fez" p/ caçar bug/quebra. Era
      // COLETADO (tracker.js → /api/track) mas NUNCA exibido: o painel "Navegação e cliques" do
      // Cliente 360 lia dados.navegacao, que ninguém preenchia. Vale p/ cliente/parceiro/equipe.
      try { data.navegacao = (await rpc('atividade_navegacao', { p_user_id: uid, p_limite: full ? 2000 : 200 })) || []; } catch { data.navegacao = []; }
    }
  } else {
    // Termo vazio → lista geral. Se o termo tem 11 dígitos, calcula o hash do CPF
    // (HMAC no backend) p/ casar cpf_hash; sempre passa o termo (nome/email/telefone).
    // p_perfil filtra por perfil de investidor (locacao/revenda/uso_proprio).
    const dig = q.replace(/\D/g, '');
    const cpfHash = dig.length === 11 ? await hashCpf(dig).catch(() => null) : null;
    data = await rpc('admin_busca_usuarios', { termo: q, p_cpf_hash: cpfHash, p_perfil: perfil, p_acesso: acesso, p_janela: janela });
  }

  // Distingue FALHA (RPC null → 502) de resultado VAZIO (lista []). Sem isso, uma falha
  // do backend virava "Nenhum usuário encontrado" na tela (bug de navegabilidade).
  if (data == null) {
    return new Response(JSON.stringify({ error: 'Falha ao consultar' }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS } });
  }
  return new Response(JSON.stringify(data), {
    status: 200, headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
