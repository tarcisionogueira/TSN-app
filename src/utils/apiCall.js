import { supabase } from './supabase';

/**
 * Wrapper para fetch das APIs internas.
 * Injeta automaticamente o token de autenticação do usuário logado.
 */
export async function apiCall(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;

  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return fetch(path, { ...options, headers });
}
