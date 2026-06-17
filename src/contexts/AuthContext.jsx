import React, { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '../utils/supabase';

const AuthContext = createContext(null);

async function fetchRole(userId) {
  if (!userId) return 'aluno';
  const { data } = await supabase
    .from('perfis')
    .select('role')
    .eq('id', userId)
    .single();
  return data?.role || 'aluno';
}

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [role, setRole]       = useState('aluno');
  const [loading, setLoading] = useState(true);

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
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, role, loading, isAdmin: role === 'admin', isLoggedIn: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
