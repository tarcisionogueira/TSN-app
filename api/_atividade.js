// LOG DE ATIVIDADE (Cliente 360) — best-effort, nunca bloqueia a ação principal.
// Antes vivia triplicado (gerar-analise.js/gerar-documental.js/gerar-laudo-viabilidade.js);
// extraído aqui (18/09) para virar o ponto único de escrita em `atividade_log`, na hora de
// cobrir também os eventos de NEGÓCIO (pagamento, saque, KYC, contrato) que só tinham clique
// de UI (eventos_atividade) e nenhum registro de "o que de fato mudou".
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

const sb = (path, opts = {}) => fetch(`${SB_URL}/rest/v1/${path}`, {
  ...opts,
  headers: {
    apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
    'Content-Type': 'application/json', ...(opts.headers || {}),
  },
  signal: AbortSignal.timeout(4000),
});

/**
 * @param {string} userId  dono do evento (aparece no Cliente 360 dele)
 * @param {string} evento  chave curta, ex.: 'pagamento_aprovado', 'saque_solicitado'
 * @param {string} [detalhe]
 * @param {object} [meta]
 * @param {string} [atorId] quem EXECUTOU a ação, quando difere do dono (ex.: admin aprovando saque de outro)
 */
export async function logAtividade(userId, evento, detalhe, meta, atorId) {
  try {
    if (!userId || !evento || !SB_URL || !SB_KEY) return;
    await sb('rpc/registrar_atividade', {
      method: 'POST',
      body: JSON.stringify({
        p_user_id: userId, p_evento: evento, p_detalhe: detalhe || null,
        p_meta: meta || {}, p_ator_id: atorId || null,
      }),
    });
  } catch { /* log é best-effort */ }
}
