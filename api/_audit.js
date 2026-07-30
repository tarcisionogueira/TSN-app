/**
 * Log de auditoria — registra ações sensíveis no Supabase.
 * Tabela: audit_logs (criada via migração SQL).
 * Fire-and-forget: nunca bloqueia a resposta principal.
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

/**
 * @param {object} params
 * @param {string} params.acao        - ex: 'pagamento_criado', 'contrato_gerado'
 * @param {string} [params.user_id]   - UUID do usuário autenticado
 * @param {string} [params.ip]        - IP da requisição
 * @param {object} [params.detalhes]  - dados extras (sem PII sensível)
 * @param {boolean} [params.sucesso]  - true/false
 */
export function auditLog({ acao, user_id, ip, detalhes, sucesso = true }) {
  if (!SUPABASE_URL || !SERVICE_KEY) return Promise.resolve();

  // RETORNA a promise: quem faz `await auditLog(...)` de fato espera o insert chegar
  // (antes retornava undefined e, em serverless, a função podia ser encerrada ANTES do
  // fetch completar → registro de auditoria perdido em silêncio). Quem não aguarda
  // mantém o comportamento fire-and-forget.
  return fetch(`${SUPABASE_URL}/rest/v1/audit_logs`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({ acao, user_id: user_id || null, ip: ip || null, detalhes: detalhes || null, sucesso }),
  }).catch((e) => { try { console.error('[audit] falha ao gravar:', e?.message || e); } catch { /* nunca trava */ } });
}
