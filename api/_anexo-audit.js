/**
 * Auditoria dos anexos do arremate — quem incluiu/substituiu/excluiu/validou, quando.
 * Usado por upload-anexo, anexo-excluir e validar-anexos. Best-effort: registrar o
 * log NUNCA pode quebrar o fluxo principal (upload/exclusão seguem mesmo se falhar).
 *
 * Insere via service key (fora do RLS). A leitura é governada por RLS (equipe vê
 * tudo; o dono vê o histórico do próprio imóvel-âncora).
 */
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

// Nome + role do ator, a partir de perfis (para o log ficar auto-contido).
export async function atorInfo(userId) {
  if (!userId || !SB || !KEY) return { nome: null, role: null };
  try {
    const r = await fetch(`${SB}/rest/v1/perfis?id=eq.${userId}&select=nome,role&limit=1`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
    });
    const [p] = await r.json().catch(() => []);
    return { nome: p?.nome || null, role: p?.role || null };
  } catch { return { nome: null, role: null }; }
}

// Registra uma ação de auditoria. `row` = { imovel_id, anexo_id, anexo_nome,
// anexo_tipo, acao, ator_id, ator_nome, ator_role, detalhe }.
export async function logAnexoAudit(row) {
  if (!SB || !KEY || !row?.acao) return;
  try {
    await fetch(`${SB}/rest/v1/anexo_auditoria`, {
      method: 'POST',
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row),
    });
  } catch { /* best-effort: o log nunca derruba o fluxo */ }
}
