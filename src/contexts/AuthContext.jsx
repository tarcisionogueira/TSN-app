import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

const AuthContext = createContext(null);

const IMPERSONATE_KEY = 'tsn_impersonate';

async function fetchRole(userId) {
  if (!userId) return 'aluno';
  const { data } = await supabase
    .from('perfis')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role || 'aluno';
}

function loadImpersonate() {
  try { return JSON.parse(sessionStorage.getItem(IMPERSONATE_KEY) || 'null'); }
  catch { return null; }
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [role, setRole]       = useState('aluno');
  const [loading, setLoading] = useState(true);
  // Modo suporte: admin/analista visualizando a conta de um cliente
  const [impersonate, setImpersonate] = useState(loadImpersonate);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data }) => {
      const u = data.session?.user ?? null;
      setUser(u);
      setRole(await fetchRole(u?.id));
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      const u = session?.user ?? null;
      setUser(u);
      setRole(await fetchRole(u?.id));
      // Vincula o cliente ao consultor que o indicou (link de afiliado),
      // inclusive no login Google onde o trigger não recebe o código.
      // Só tenta no sign-in real (não em token refresh, user_updated, etc.)
      if (u && (event === 'SIGNED_IN' || event === 'INITIAL_SESSION')) {
        const ref = sessionStorage.getItem('tsn_ref_codigo');
        if (ref) {
          try { await supabase.rpc('vincular_indicacao', { p_codigo: ref }); } catch (_) {}
          sessionStorage.removeItem('tsn_ref_codigo');
        }
      }
      // Encerra o modo suporte ao sair da sessão
      if (event === 'SIGNED_OUT') {
        sessionStorage.removeItem(IMPERSONATE_KEY);
        setImpersonate(null);
      }
    });

    return () => subscription.unsubscribe();
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

  // Identidade/role efetivos: durante o suporte, refletem o cliente visualizado
  const effectiveUserId = impersonate?.id || user?.id || null;
  const effectiveRole   = impersonate?.role || role;
  const podeImpersonar  = role === 'admin' || role === 'analista';

  return (
    <AuthContext.Provider value={{
      user, role, loading,
      isAdmin: role === 'admin',
      isLoggedIn: !!user,
      impersonate, iniciarSuporte, encerrarSuporte, podeImpersonar,
      effectiveUserId, effectiveRole,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
