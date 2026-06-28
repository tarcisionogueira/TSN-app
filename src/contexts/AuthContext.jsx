import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

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
  if (!userId) return { role: 'explorador', ativo: true, inadimplenteDias: 0, cadastroIncompleto: false };
  const { data } = await supabase
    .from('perfis')
    .select('role, ativo, inadimplente_desde, cpf, lgpd_aceito')
    .eq('id', userId)
    .single();

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
    return { role: 'explorador', ativo: data?.ativo !== false, inadimplenteDias, cadastroIncompleto: (!data?.cpf || !data?.lgpd_aceito) };
  }

  const roleFinal = data?.role || 'explorador';
  const ehCliente = !ROLES_OPERACIONAIS.includes(roleFinal);
  return {
    // Sem perfil carregado → menor privilégio (explorador), nunca um role usável por engano
    role: roleFinal,
    ativo: data?.ativo !== false,
    inadimplenteDias,
    // Cliente sem CPF ou sem aceite LGPD (ex.: cadastro via Google) precisa completar
    cadastroIncompleto: ehCliente && (!data?.cpf || !data?.lgpd_aceito),
  };
}

function loadImpersonate() {
  try { return JSON.parse(sessionStorage.getItem(IMPERSONATE_KEY) || 'null'); }
  catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser]             = useState(null);
  const [role, setRole]             = useState('explorador');
  const [ativo, setAtivo]           = useState(true);
  const [inadimplenteDias, setInad] = useState(0);
  const [cadastroIncompleto, setCadastroIncompleto] = useState(false);
  const [loading, setLoading]       = useState(true);
  // Modo suporte: admin/analista visualizando a conta de um cliente
  const [impersonate, setImpersonate] = useState(loadImpersonate);
  // Simulação de role: admin testa a UI como outro tipo de usuário
  const [roleSimulado, setRoleSimulado] = useState(() => sessionStorage.getItem(SIM_ROLE_KEY) || null);

  useEffect(() => {
    // Verificar expiração de 24h na carga inicial
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null;
      if (u && isSessionExpired()) {
        await supabase.auth.signOut();
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        setLoading(false);
        return;
      }
      if (u) updateActivity();
      setUser(u);
      const p = await fetchPerfil(u?.id);
      setRole(p.role);
      setAtivo(p.ativo);
      setInad(p.inadimplenteDias);
      setCadastroIncompleto(p.cadastroIncompleto ?? false);
      setLoading(false);
    });

    // Atualiza atividade em cliques e teclas
    const onActivity = () => updateActivity();
    window.addEventListener('click', onActivity, { passive: true });
    window.addEventListener('keydown', onActivity, { passive: true });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      const p = await fetchPerfil(u?.id);
      setRole(p.role);
      setAtivo(p.ativo);
      setInad(p.inadimplenteDias);
      setCadastroIncompleto(p.cadastroIncompleto ?? false);
      // Vincula o cliente ao consultor que o indicou (link de afiliado),
      // inclusive no login Google onde o trigger não recebe o código.
      // Só tenta no sign-in real (não em token refresh, user_updated, etc.)
      if (u && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        // Log de uso — prova de acesso para proteção contra chargeback
        if (event === 'SIGNED_IN') {
          try {
            import('../utils/logUso').then(({ logUso }) => logUso(u.id, 'login'));
          } catch (_) {}
        }
        const ref = sessionStorage.getItem('tsn_ref_codigo');
        if (ref) {
          try { await supabase.rpc('vincular_indicacao', { p_codigo: ref }); } catch (_) {}
          sessionStorage.removeItem('tsn_ref_codigo');
        }
        // Vincula via link de convite (cliente)
        const convite = sessionStorage.getItem('tsn_convite_codigo');
        if (convite) {
          try { await supabase.rpc('usar_convite', { p_codigo: convite }); } catch (_) {}
          sessionStorage.removeItem('tsn_convite_codigo');
        }
        // Convite de equipe — funciona também no login Google (antes só por senha)
        const conviteEq = sessionStorage.getItem('tsn_convite_equipe');
        if (conviteEq) {
          try { await supabase.rpc('usar_convite_equipe', { p_token: conviteEq, p_user_id: u.id }); } catch (_) {}
          sessionStorage.removeItem('tsn_convite_equipe');
        }
        // Redirect pós-login social (Google): leva ao destino preservado antes do
        // redirect (plano/checkout, next ou produto). Cobre SIGNED_IN e
        // INITIAL_SESSION (o Supabase às vezes emite INITIAL_SESSION ao voltar do OAuth).
        const oauthDest = sessionStorage.getItem('tsn_oauth_redirect');
        if (oauthDest) {
          sessionStorage.removeItem('tsn_oauth_redirect');
          if (window.location.hash.replace(/^#/, '') !== oauthDest) {
            window.location.hash = oauthDest;
          }
        }
      }
      // Encerra o modo suporte ao sair da sessão
      if (event === 'SIGNED_IN') updateActivity();
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(IMPERSONATE_KEY);
        localStorage.removeItem(LAST_ACTIVITY_KEY);
        setImpersonate(null);
      }
    });

    // Realtime: detecta mudança de role/inadimplência pelo webhook sem precisar de refresh
    let perfilChannel = null;
    supabase.auth.getSession().then(({ data }) => {
      const uid = data.session?.user?.id;
      if (!uid) return;
      perfilChannel = supabase.channel(`perfil-role-${uid}`)
        .on('postgres_changes', {
          event: 'UPDATE', schema: 'public', table: 'perfis', filter: `id=eq.${uid}`,
        }, async () => {
          const p = await fetchPerfil(uid);
          setRole(p.role);
          setAtivo(p.ativo);
          setInad(p.inadimplenteDias);
          setCadastroIncompleto(p.cadastroIncompleto ?? false);
        })
        .subscribe();
    });

    return () => {
      subscription.unsubscribe();
      if (perfilChannel) supabase.removeChannel(perfilChannel);
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
    };
  }, []);

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
  const effectiveRole   = (role === 'admin' && roleSimulado) ? roleSimulado : (impersonate?.role || role);
  const podeImpersonar  = role === 'admin' || role === 'analista';

  return (
    <AuthContext.Provider value={{
      user, role, ativo, inadimplenteDias, loading, cadastroIncompleto, setCadastroIncompleto,
      isAdmin: role === 'admin',
      isLoggedIn: !!user,
      impersonate, iniciarSuporte, encerrarSuporte, podeImpersonar,
      effectiveUserId, effectiveRole,
      roleSimulado, simularRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
