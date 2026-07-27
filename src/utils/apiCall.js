import { supabase } from './supabase';
import { registrarEvento } from './tracker.js';

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

  const res = await fetch(path, { ...options, headers });
  // Diagnóstico (Cliente 360): registra falhas de API sem alterar o retorno.
  if (!res.ok) {
    try { registrarEvento('api_erro', { alvo: String(path).split('?')[0].slice(0, 120), detalhe: `HTTP ${res.status}` }); } catch { /* ignora */ }
  }
  return res;
}
