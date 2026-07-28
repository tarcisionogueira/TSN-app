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
  const rota = String(path).split('?')[0].slice(0, 120);
  if (!res.ok) {
    try { registrarEvento('api_erro', { alvo: rota, detalhe: `HTTP ${res.status}` }); } catch { /* ignora */ }
  } else if (/gerar-analise|gerar-documental|gerar-laudo|indice-mercado/.test(rota)) {
    // RESULTADO das ações-chave: um 200 pode vir "vazio" (mercadoVazio) ou com erro no corpo — o
    // dono quer o clique E o DESFECHO. Espia o corpo por CLONE (não consome o retorno do chamador),
    // só nessas rotas (baixa frequência) para não pesar. Best-effort.
    try {
      const b = await res.clone().json();
      if (b && (b.error || b.mercadoVazio || b.motivo === 'sem_amostras')) {
        registrarEvento('api_vazio', { alvo: rota, detalhe: String(b.error || (b.mercadoVazio ? 'relatório sem estimativa' : b.motivo)).slice(0, 120) });
      }
    } catch { /* peek best-effort */ }
  }
  return res;
}
