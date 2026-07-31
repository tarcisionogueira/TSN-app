/**
 * Regra "1 assessoria por arrematação" (dono, 30/07) — fonte ÚNICA compartilhada.
 * Usada pelo gate de UI (assessoria-status) E pelos endpoints de pagamento (mp/asaas),
 * para que a regra não fique só na tela: sem isto, um POST direto a /api/mp ou /api/asaas
 * criava a cobrança de uma 2ª assessoria em duplicidade (bug bounty — gate só decorativo).
 *
 * Retorna { podeContratar: bool, motivo }. Motivos:
 *   'ok' | 'nova_arrematacao' | 'assessoria_em_andamento' | 'clube_incluido' | 'requer_pro'
 */
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
  });
}

export async function podeContratarAssessoria({ userId, email, role }) {
  if (/^clube/.test(role || '')) return { podeContratar: false, motivo: 'clube_incluido' };
  if (['admin', 'analista', 'advogado', 'suporte'].includes(role)) return { podeContratar: true, motivo: 'ok' };
  if (!/^(top2|assessorado)/.test(role || '')) return { podeContratar: false, motivo: 'requer_pro' };

  // Contrato de assessoria VIVO (aguardando/assinado). Casa por criado_por OU assinante_email
  // (quando a EQUIPE emite, criado_por é o staff).
  const emailFiltro = email ? `,assinante_email.eq.${encodeURIComponent(String(email).toLowerCase())}` : '';
  const rc = await sb(`contratos_link?or=(criado_por.eq.${encodeURIComponent(userId)}${emailFiltro})&plano_key=eq.assessorado&status=in.(aguardando,aguardando_assinatura,assinado)&select=id,criado_em&order=criado_em.desc&limit=1`);
  const [contrato] = rc.ok ? await rc.json().catch(() => []) : [];

  if (!contrato) {
    // Sem contrato mas já é assessorado com caso arrematado sem posse → em andamento.
    if (/^assessorado/.test(role || '')) {
      const rcaso = await sb(`casos?cliente_id=eq.${encodeURIComponent(userId)}&arrematado_em=not.is.null&posse_em=is.null&select=id&limit=1`);
      const emAndamento = rcaso.ok ? await rcaso.json().catch(() => []) : [];
      if ((emAndamento?.length || 0) > 0) return { podeContratar: false, motivo: 'assessoria_em_andamento' };
    }
    return { podeContratar: true, motivo: 'ok' };
  }

  // Arremate SINALIZADO após o contrato? (portfólio auto-declarado OU caso da equipe)
  const desde = encodeURIComponent(contrato.criado_em);
  const [ra, rk] = await Promise.all([
    sb(`arrematados?user_id=eq.${encodeURIComponent(userId)}&created_at=gt.${desde}&select=id&limit=1`),
    sb(`casos?cliente_id=eq.${encodeURIComponent(userId)}&arrematado_em=gt.${desde}&select=id&limit=1`),
  ]);
  const arrDepois  = ra.ok ? await ra.json().catch(() => []) : [];
  const casoDepois = rk.ok ? await rk.json().catch(() => []) : [];
  const arrematou = (arrDepois?.length || 0) > 0 || (casoDepois?.length || 0) > 0;

  return arrematou
    ? { podeContratar: true, motivo: 'nova_arrematacao' }
    : { podeContratar: false, motivo: 'assessoria_em_andamento' };
}
