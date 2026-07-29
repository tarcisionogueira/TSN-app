import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';
import { ativarPushAutomatico } from '../utils/push';
import { salvarRef, lerRef, limparRef } from '../utils/ref';

const AuthContext = createContext(null);

const IMPERSONATE_KEY  = 'tsn_impersonate';
const SIM_ROLE_KEY     = 'tsn_sim_role';
const LAST_ACTIVITY_KEY = 'tsn_last_activity';
const SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24h

// Atualiza o timestamp de atividade a cada interação
function updateActivity() {
  localStorage.setItem(LAST_ACTIVITY_KEY, Date.now().toString());
}

function isSessionExpired() {
  const last = localStorage.getItem(LAST_ACTIVITY_KEY);
  if (!last) return false;
  return Date.now() - Number(last) > SESSION_TIMEOUT_MS;
}

async function fetchPerfil(userId) {
  if (!userId) return { role: 'explorador', ativo: true, inadimplenteDias: 0, cadastroIncompleto: false, planoLegado: false };
  const { data } = await supabase
    .from('perfis')
    .select('role, ativo, inadimplente_desde, cpf_hash, lgpd_aceito, nome, telefone, endereco_cidade, endereco_uf, plano_legado')
    .eq('id', userId)
    .single();

  // Cadastro-base obrigatório: nome, telefone/WhatsApp, cidade E estado, + aceite LGPD.
  // O CPF NÃO entra aqui — só é exigido na hora de PAGAR (checkout) e de SACAR. A cidade
  // é obrigatória porque alimenta o filtro por região e os alertas por e-mail.
  // Falta QUALQUER um → um popup pede para completar (um campo por vez) antes de usar o app.
  const cadastroFalta = !data?.nome || !String(data?.nome).trim()
    || !data?.telefone
    || !data?.endereco_cidade || !data?.endereco_uf
    || !data?.lgpd_aceito;

  let inadimplenteDias = 0;
  if (data?.inadimplente_desde) {
    const desde = new Date(data.inadimplente_desde);
    inadimplenteDias = Math.floor((Date.now() - desde.getTime()) / 86400000);
  }

  // Após 5 dias sem pagar, persiste o downgrade para explorador.
  // Roles operacionais (admin, analista, advogado, consultor) nunca são downgradeados.
  const ROLES_OPERACIONAIS = ['admin', 'analista', 'advogado', 'consultor'];
  if (inadimplenteDias > 5 && data?.role && data.role !== 'explorador' && !ROLES_OPERACIONAIS.includes(data.role)) {
    await supabase.from('perfis').update({
      role_anterior: data.role,
      role: 'explorador',
    }).eq('id', userId);
    return { role: 'explorador', ativo: data?.ativo !== false, inadimplenteDias, cadastroIncompleto: cadastroFalta, planoLegado: false };
  }

  // Normaliza o sufixo _anual: a modalidade anual é forma de PAGAMENTO, não um
  // papel distinto. O role efetivo é sempre o base (top2/assessorado/clube), para
  // que todas as listas de permissão funcionem sem precisar duplicar cada '_anual'.
  const roleFinal = (data?.role || 'explorador').replace(/_anual$/, '');
  const ehCliente = !ROLES_OPERACIONAIS.includes(roleFinal);
  return {
    // Sem perfil carregado → menor privilégio (explorador), nunca um role usável por engano
    role: roleFinal,
    ativo: data?.ativo !== false,
    inadimplenteDias,
    // Cliente sem nome/telefone/CPF/cidade/UF/LGPD precisa completar antes de usar o app.
    cadastroIncompleto: ehCliente && cadastroFalta,
    nome: data?.nome || '',
    // Grandfather de cota (assinantes antigos mantêm 15+15+5). Só o flag; a cota real
    // vem de limite_ia_efetivo no banco — aqui é só para o espelho de UI não bloquear antes.
    planoLegado: !!data?.plano_legado,
  };
}

function loadImpersonate() {
  try { return JSON.parse(sessionStorage.getItem(IMPERSONATE_KEY) || 'null'); }
  catch { return null; }
}

// Cache do perfil (role/nome/etc.) em localStorage → na volta do usuário, a tela aparece
// INSTANTÂNEA com o último perfil conhecido enquanto o valor fresco é revalidado em 2º plano
// (stale-while-revalidate). Antes, o app ficava em tela branca esperando a query do perfil.
const PERFIL_CACHE_KEY = 'tsn_perfil_cache';
function loadPerfilCache(uid) {
  try { const c = JSON.parse(localStorage.getItem(PERFIL_CACHE_KEY) || 'null'); return (c && c.uid === uid) ? c.p : null; }
  catch { return null; }
}
function savePerfilCache(uid, p) {
  if (!uid) return;
  try { localStorage.setItem(PERFIL_CACHE_KEY, JSON.stringify({ uid, p })); } catch { /* ok */ }
}

export function AuthProvider({ children }) {
  const [user, setUser]             = useState(null);
  const [role, setRole]             = useState('explorador');
  const [ativo, setAtivo]           = useState(true);
  const [inadimplenteDias, setInad] = useState(0);
  const [cadastroIncompleto, setCadastroIncompleto] = useState(false);
  const [nome, setNome]             = useState(''); // nome do usuário (p/ cabeçalho de relatórios)
  const [planoLegado, setPlanoLegado] = useState(false); // assinante antigo (cota 15+15+5)
  const [loading, setLoading]       = useState(true);
  // Modo suporte: admin/analista visualizando a conta de um cliente
  const [impersonate, setImpersonate] = useState(loadImpersonate);
  // Simulação de role: admin testa a UI como outro tipo de usuário
  const [roleSimulado, setRoleSimulado] = useState(() => sessionStorage.getItem(SIM_ROLE_KEY) || null);

  useEffect(() => {
    // Captura GLOBAL da indicação do parceiro (?ref=), venha ANTES ou DEPOIS do # (HashRouter).
    // Antes cada página capturava por conta própria e a Landing/início NÃO capturava — então o
    // link GERAL do parceiro (que aponta p/ o início, para o visitante navegar e assinar) perdia
    // a indicação. Aqui persiste 1x, cedo, para QUALQUER ponto de entrada; o bloco SIGNED_IN
    // abaixo consome via vincular_upline no cadastro. O código é FIXO do parceiro → o MESMO link
    // vincula quantas pessoas clicarem (todas atribuídas a quem indicou).
    try {
      const pegaRef = (qs) => { try { return new URLSearchParams(qs).get('ref'); } catch { return null; } };
      const h = window.location.hash || '';
      const iq = h.indexOf('?');
      const ref = pegaRef(window.location.search) || (iq >= 0 ? pegaRef(h.slice(iq)) : null);
      if (ref) salvarRef(ref); // localStorage + janela de 30 dias (sobrevive a fechar a aba)
    } catch { /* ignore */ }
    // Verificar expiração de 24h na carga inicial
    const aplicarPerfil = (p) => {
      setRole(p.role); setAtivo(p.ativo); setInad(p.inadimplenteDias);
      setCadastroIncompleto(p.cadastroIncompleto ?? false); setNome(p.nome || '');
      setPlanoLegado(p.planoLegado ?? false);
    };
    // Link de recuperação de senha abre uma sessão de RECOVERY. Não aplicar a expiração de
    // 24h nesse contexto — senão o signOut derrubava a sessão de recovery e o RedefinirSenha
    // mostrava "link inválido/expirado" (atingindo justamente quem não acessava há tempos).
    const ehRecovery = typeof window !== 'undefined' && (
      /type=recovery/.test(window.location.href) || /redefinir-senha|recuperar|reset/i.test(window.location.hash)
    );
    supabase.auth.getSession().then(({ data }) => {
      const u = data.session?.user ?? null;
      if (u && isSessionExpired() && !ehRecovery) {
        supabase.auth.signOut();
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        localStorage.removeItem(PERFIL_CACHE_KEY);
        setLoading(false);
        return;
      }
      if (u) updateActivity();
      setUser(u);
      if (!u) { setLoading(false); return; }
      // Hidrata do cache NA HORA (se houver) e já libera a UI — sem esperar a rede.
      const cached = loadPerfilCache(u.id);
      if (cached) { aplicarPerfil(cached); setLoading(false); }
      // Revalida em 2º plano; só o 1º acesso (sem cache) espera a query.
      fetchPerfil(u.id).then((p) => { aplicarPerfil(p); savePerfilCache(u.id, p); setLoading(false); })
        .catch(() => setLoading(false));
    });

    // Atualiza atividade em cliques e teclas
    const onActivity = () => updateActivity();
    window.addEventListener('click', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      // Recuperação de senha conta como atividade → não deixa a expiração de 24h derrubar
      // a sessão de recovery recém-criada pelo link do e-mail.
      if (event === 'PASSWORD_RECOVERY') updateActivity();
      // Limpeza do modo suporte no logout (não usa supabase → pode ser síncrono).
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(IMPERSONATE_KEY);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        localStorage.removeItem(PERFIL_CACHE_KEY);
        setImpersonate(null);
      }
      // IMPORTANTE: NÃO chamar funções async do supabase DENTRO do callback do
      // onAuthStateChange. Ele roda sob o lock interno do auth e a query de perfil
      // vinha com o contexto de sessão ainda não propagado, retornando role='explorador'
      // até o usuário dar refresh (o sistema "não reconhecia o role" no login). Deferindo
      // para FORA do lock (setTimeout 0), a query usa a sessão já estabelecida e o role
      // é reconhecido de primeira, sem precisar recarregar a tela.
      setTimeout(async () => {
        const p = await fetchPerfil(u?.id);
        setRole(p.role);
        setAtivo(p.ativo);
        setInad(p.inadimplenteDias);
        setCadastroIncompleto(p.cadastroIncompleto ?? false);
      setNome(p.nome || '');
        setPlanoLegado(p.planoLegado ?? false);
        if (u) savePerfilCache(u.id, p);
        // Vincula o cliente ao consultor que o indicou (link de afiliado), inclusive no
        // login Google onde o trigger não recebe o código. Só no sign-in real.
        if (u && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
          // Log de uso — prova de acesso para proteção contra chargeback
          if (event === 'SIGNED_IN') {
            // O try/catch NÃO pega a rejeição do import() dinâmico: em chunk stale
            // pós-deploy o módulo vem undefined e o destructure quebrava (erro-cliente
            // "Cannot destructure property 'logUso' of 'undefined'" na /analise).
            // Optional chaining + .catch tornam o log de acesso à prova de falha.
            import('../utils/logUso').then(m => m?.logUso?.(u.id, 'login')).catch(() => {});
            // Boas-vindas UNIVERSAL: dispara 1x por conta (idempotente no servidor por
            // perfis.boas_vindas_em). Só no SIGNED_IN (login novo, inclui o 1º acesso após
            // qualquer cadastro: grátis, pago, normal, Google, convite) — não no
            // INITIAL_SESSION (reabertura). Best-effort, não bloqueia o login.
            fetch('/api/boas-vindas', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } }).catch(() => {});
          }
          // Push automático (só 1x por navegador).
          try { ativarPushAutomatico(() => session); } catch (_) {}
          // Coleta client-side (IP residencial do STAFF) — dispara no LOGIN, independente da
          // ROTA. Antes só rodava num useEffect do MainLayout, que NÃO monta em /admin (onde o
          // staff trabalha) → nunca disparava. Aqui roda em SIGNED_IN (login novo) e
          // INITIAL_SESSION (reabertura do app/PWA com sessão). Só staff; o gate 2x/semana +
          // a trava de sessão em coletaCliente cuidam da frequência. import() dinâmico p/ não
          // rodar para cliente comum nem inflar o chunk principal.
          if (['admin', 'analista', 'advogado'].includes(p.role)) {
            import('../utils/coletaCliente').then(m => m?.dispararColetaClienteStaff?.()).catch(() => {});
            // Coleta OPORTUNISTA das fontes PAGAS (SOLEON/GESTAO/RJ/PECINI, Bright Data): dispara o
            // scraper na NUVEM ao abrir o app, mas o servidor só dispara se já passou o espaçamento
            // (~20h, gate atômico) — quem acessa todo dia mantém as pagas frescas sem PC ligado e
            // sem gastar BD a cada abertura. Rede de 7 dias = cron semanal dessas fontes na CI.
            fetch('/api/coleta-oportunista', { method: 'POST', headers: { Authorization: `Bearer ${session?.access_token || ''}` } }).catch(() => {});
          }
          const ref = lerRef(); // localStorage c/ janela de 30 dias (+ compat sessionStorage antigo)
          if (ref) {
            // vincular_upline: QUALQUER usuário pode ser o indicador (antes só consultor);
            // aceita o id do link (?ref=<id>) ou um código de indicação. Grava indicado_por.
            try { await supabase.rpc('vincular_upline', { p_ref: ref }); } catch (_) {}
            limparRef();
          }
          // Sem link de parceiro → upline PADRÃO é o dono (pedido do dono: "todos que entraram e
          // não são pelo link dos parceiros são para o meu usuário"). Idempotente — só preenche se
          // indicado_por ainda for NULL, então nunca sobrepõe a indicação de parceiro gravada acima.
          try { await supabase.rpc('vincular_owner_default'); } catch (_) {}
          const convite = sessionStorage.getItem('tsn_convite_codigo');
          if (convite) {
            try { await supabase.rpc('usar_convite', { p_codigo: convite }); } catch (_) {}
            sessionStorage.removeItem('tsn_convite_codigo');
          }
          const conviteEq = sessionStorage.getItem('tsn_convite_equipe');
          if (conviteEq) {
            try { await supabase.rpc('usar_convite_equipe', { p_token: conviteEq, p_user_id: u.id }); } catch (_) {}
            sessionStorage.removeItem('tsn_convite_equipe');
          }
          // Redirect pós-login social (Google) ao destino preservado antes do OAuth.
          const oauthDest = sessionStorage.getItem('tsn_oauth_redirect');
          if (oauthDest) {
            sessionStorage.removeItem('tsn_oauth_redirect');
            if (window.location.hash.replace(/^#/, '') !== oauthDest) window.location.hash = oauthDest;
          }
          updateActivity();
        }
      }, 0);
    });

    // Reavalia o perfil (role/inadimplência/cadastro) quando a aba volta ao foco.
    // Antes mantínhamos 1 conexão Realtime por usuário (supabase.channel por uid),
    // o que estoura o teto de 200 conexões simultâneas do plano Free em escala.
    // O refetch no foco entrega o mesmo efeito (mudanças do webhook refletem ao
    // voltar à aba) sem custo de conexão persistente.
    const refetchPerfil = async () => {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user?.id;
      if (!uid) return;
      const p = await fetchPerfil(uid);
      setRole(p.role);
      setAtivo(p.ativo);
      setInad(p.inadimplenteDias);
      setCadastroIncompleto(p.cadastroIncompleto ?? false);
      setNome(p.nome || '');
      setPlanoLegado(p.planoLegado ?? false);
      savePerfilCache(uid, p);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') refetchPerfil(); };
    window.addEventListener('focus', refetchPerfil);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      subscription.unsubscribe();
      window.removeEventListener('focus', refetchPerfil);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []);

  // Reavaliação manual do perfil (usado logo após um pagamento: o role já foi
  // ativado no servidor de forma síncrona, mas o contexto ainda tem o valor antigo
  // até um foco/reload — chamar isto libera o acesso na hora, sem re-login).
  const refreshPerfil = async () => {
    const { data } = await supabase.auth.getSession();
    const uid = data.session?.user?.id;
    if (!uid) return;
    const p = await fetchPerfil(uid);
    setRole(p.role);
    setAtivo(p.ativo);
    setInad(p.inadimplenteDias);
    setCadastroIncompleto(p.cadastroIncompleto ?? false);
    setNome(p.nome || '');
    setPlanoLegado(p.planoLegado ?? false);
  };

  // Inicia o modo suporte. Os dados continuam protegidos por RLS: admin/analista
  // só conseguem ler o que as policies de equipe permitem.
  const iniciarSuporte = (alvo) => {
    sessionStorage.setItem(IMPERSONATE_KEY, JSON.stringify(alvo));
    setImpersonate(alvo);
  };
  const encerrarSuporte = () => {
    sessionStorage.removeItem(IMPERSONATE_KEY);
    setImpersonate(null);
  };

  const simularRole = (r) => {
    if (r) { sessionStorage.setItem(SIM_ROLE_KEY, r); setRoleSimulado(r); }
    else   { sessionStorage.removeItem(SIM_ROLE_KEY); setRoleSimulado(null); }
  };

  // Identidade/role efetivos: simulação > suporte > real
  const effectiveUserId = impersonate?.id || user?.id || null;
  const effectiveRole   = (((role === 'admin' && roleSimulado) ? roleSimulado : (impersonate?.role || role)) || 'explorador').replace(/_anual$/, '');
  const podeImpersonar  = role === 'admin' || role === 'analista';

  return (
    <AuthContext.Provider value={{
      user, role, nome, ativo, inadimplenteDias, loading, cadastroIncompleto, setCadastroIncompleto, planoLegado,
      isAdmin: role === 'admin',
      isLoggedIn: !!user,
      impersonate, iniciarSuporte, encerrarSuporte, podeImpersonar,
      effectiveUserId, effectiveRole,
      roleSimulado, simularRole, refreshPerfil,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
