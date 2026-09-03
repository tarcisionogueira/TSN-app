export const config = { runtime: 'edge' };
import { getUser, getUserRoleById, unauthorized, forbidden } from './_auth.js';
import { hashCpf } from './_cpf.js';

// Fase B — Monitoramento 360º do cliente (só admin/analista).
//   GET /api/admin-usuario-360?q=termo         → busca por nome/e-mail/telefone/CPF
//                                                (q vazio = lista geral, mais recentes)
//   GET /api/admin-usuario-360?user_id=uuid    → retrato 360º do usuário
//   GET /api/admin-usuario-360?email_de=uuid   → só o e-mail (lookup leve, ver abaixo)
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
  // OPTIONS ANTES da autenticação: o preflight do CORS não carrega credencial, então
  // autenticar primeiro devolvia 401 no preflight e derrubava a chamada real em qualquer
  // origem diferente da do app. Hoje o app é mesma-origem e por isso não doía — é uma
  // armadilha armada para o dia em que alguém chamar de outro domínio.
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const user = await getUser(req);
  if (!user) return unauthorized();
  const role = await getUserRoleById(user.id);
  if (role !== 'admin' && role !== 'analista') return forbidden();
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
  const emailDe = params.get('email_de');

  // MODO SUPORTE PRECISA DO E-MAIL, MAS NÃO DO RETRATO INTEIRO (03/09). `?user_id=` chama
  // `admin_usuario_360` — pesado (atividade, navegação, aceites, até 2 mil linhas por seção).
  // O e-mail sozinho não justifica esse custo: só a Tela de Perfil, quando o `impersonate`
  // chegou sem e-mail (entrada por um fluxo que não o carregava — atribuir arremate, abrir
  // ficha do caso), pede este lookup mínimo. GoTrue admin API direto (mesmo padrão de
  // api/saldo-disponivel-aviso-cron.js), sem passar pela RPC pesada.
  if (emailDe) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(emailDe)) {
      return new Response(JSON.stringify({ error: 'email_de inválido' }), { status: 400, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
    try {
      const r = await fetch(`${SB}/auth/v1/admin/users/${emailDe}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
      if (!r.ok) return new Response(JSON.stringify({ email: null }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
      const u = await r.json();
      return new Response(JSON.stringify({ email: u?.email || null }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
    } catch (e) {
      console.error('[admin-usuario-360] email_de falhou:', e?.message || e);
      return new Response(JSON.stringify({ email: null }), { status: 200, headers: { 'Content-Type': 'application/json', ...CORS } });
    }
  }

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
      // ─── POR QUE ISTO EXISTE (11/08) ─────────────────────────────────────────────
      // Cada bloco abaixo fazia `(await rpc(...)) || []`. O `rpc()` devolve null em QUALQUER
      // falha (HTTP não-ok, rede, timeout) — então uma leitura quebrada virava lista VAZIA e a
      // tela dizia "nenhuma atividade", "nenhum aceite". No caso de `aceites` isso é grave: é
      // a trilha anti-chargeback (plano, IP, versão dos termos). "Não consegui ler" apresentado
      // como "o cliente nunca aceitou" é uma conclusão jurídica errada tirada de um erro de rede.
      // Agora cada seção que falha entra em `_falhas` e a tela/dossiê dizem que não puderam ler.
      data._falhas = [];
      const secao = async (nome, fn) => {
        const v = await fn();
        if (v == null) { data._falhas.push(nome); return null; }
        return v;
      };

      // ─── SABER QUANDO A LISTA FOI CORTADA (11/08) ────────────────────────────────
      // `atividade_navegacao` travava em 300 e `atividade_usuario` em 500 — tetos INTERNOS
      // que o chamador não conhecia. O dossiê pedia 2.000 de cada e recebia o teto, sem
      // nenhum sinal: o usuário mais ativo tem 4.511 eventos e o documento dizia
      // "histórico completo" com 300 deles. Os tetos subiram para 5.000 no banco; aqui
      // pedimos SEMPRE n+1 e, se vier um a mais, sabemos que há continuação e dizemos.
      data._truncado = [];
      const listaLimitada = async (nome, limite, fn) => {
        const v = await secao(nome, () => fn(limite + 1));
        if (!Array.isArray(v)) return v == null ? [] : v;
        if (v.length > limite) { data._truncado.push(nome); return v.slice(0, limite); }
        return v;
      };

      const LIM_ATIVIDADE = full ? 2000 : 100;
      data.atividade = await listaLimitada('atividade', LIM_ATIVIDADE,
        (n) => rpc('atividade_usuario', { p_user_id: uid, p_limite: n }));
      // Anexa a NAVEGAÇÃO/cliques (clickstream de eventos_atividade): telas vistas, cliques e
      // falhas/relatórios vazios de API — o "tudo o que o usuário fez" p/ caçar bug/quebra. Era
      // COLETADO (tracker.js → /api/track) mas NUNCA exibido: o painel "Navegação e cliques" do
      // Cliente 360 lia dados.navegacao, que ninguém preenchia. Vale p/ cliente/parceiro/equipe.
      const LIM_NAVEGACAO = full ? 2000 : 200;
      data.navegacao = await listaLimitada('navegacao', LIM_NAVEGACAO,
        (n) => rpc('atividade_navegacao', { p_user_id: uid, p_limite: n }));
      // TERMOS ACEITOS (trilho jurídico do 360): compra de plano/produto (aceites_plano, com
      // IP/versão — prova anti-chargeback) + LGPD do cadastro. A adesão de parceiro já vem na
      // RPC ('parceria'). Antes só a Auditoria da aba Usuários mostrava isso — o 360 não.
      const ler = async (url) => {
        try {
          const r = await fetch(`${SB}${url}`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
          if (!r.ok) return null;
          return await r.json();
        } catch { return null; }
      };
      data.aceites = (await secao('aceites', () => ler(`/rest/v1/aceites_plano?user_id=eq.${encodeURIComponent(uid)}&order=aceito_em.desc&limit=100&select=plano_key,valor,termos_versao,ip,gateway,aceito_em,preco_contratado,aceite_hash`))) || [];
      const lgpd = await secao('lgpd', () => ler(`/rest/v1/perfis?id=eq.${encodeURIComponent(uid)}&select=lgpd_aceito,lgpd_data`));
      data.lgpd = lgpd?.[0] || null;
      // `completo` é DERIVADO — a tela não precisa saber a regra, e um bloco novo que falhe
      // entra no cálculo sozinho por estar em `_falhas`.
      data._completo = data._falhas.length === 0;
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
