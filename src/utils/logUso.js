import { supabase } from './supabase';

export async function logUso(userId, acao, detalhes = {}) {
  if (!userId) return;
  try {
    await supabase.from('uso_servico').insert({
      user_id: userId,
      acao,
      detalhes: Object.keys(detalhes).length > 0 ? detalhes : null,
    });
  } catch (_) {}
}
