/**
 * SESSÃO VENCIDA — uma regra só, porque ela já estava começando a virar quatro.
 *
 * O token do Supabase dura pouco. Num PWA aberto há horas (ou num app que ficou em segundo
 * plano, onde o timer de renovação automática não roda), o servidor passa a recusar TUDO, e
 * cada tela reagia à sua maneira:
 *   • `/analise` → "Não foi possível verificar os relatórios já gerados deste imóvel";
 *   • `/analises` → "Não foi possível carregar suas análises · JWT expired";
 *   • o perfil → o `role` cai para `explorador` (fail-closed, correto do ponto de vista de
 *     segurança) e o dono ADMIN vê a interface de cliente comum — sem uma palavra de por quê;
 *   • `apiCall` → 401 e um botão que não faz nada.
 * Relatado pelo dono em 10/09: "tive que fechar e reabrir o app pois meu acesso caiu de adm
 * para comum". Fechar e reabrir funciona porque a abertura força uma sessão nova — que é
 * exatamente o que este módulo passa a fazer sozinho.
 *
 * Regra: identificar a falha de sessão pelo que ela É (código do PostgREST / mensagem do
 * GoTrue), renovar UMA vez e repetir a leitura. Uma só, de propósito: renovação em cadeia
 * sobre falha em cadeia é laço infinito.
 */

/** A falha veio da SESSÃO (e não do dado)? Aceita erro do postgrest-js, do GoTrue ou um status. */
export function ehErroDeSessao(erro) {
  if (erro === 401) return true;
  if (!erro) return false;
  const alvo = `${erro.code ?? ''} ${erro.status ?? ''} ${erro.message ?? erro}`;
  // PGRST301 = JWT inválido/expirado no PostgREST. 401 cobre GoTrue e as rotas /api.
  return /\bPGRST301\b|\b401\b|jwt\s*(expired|invalid)|token.*(expired|invalid)|invalid.*(jwt|token)|session.*(expired|missing)/i.test(alvo);
}

/**
 * Tenta renovar a sessão. NUNCA lança e sempre diz o motivo quando não deu — sem o motivo,
 * "não renovou" fica indistinguível de "não havia o que renovar", e são coisas diferentes:
 * a primeira é problema nosso, a segunda pede que a pessoa entre de novo.
 */
export async function renovarSessao(supabase) {
  try {
    // `{ data, error }`: o supabase-js NÃO lança aqui. Ler só `data` fundiria os dois casos.
    const { data, error } = await supabase.auth.refreshSession();
    if (data?.session?.access_token) return { ok: true, motivo: null };
    return { ok: false, motivo: String(error?.message || 'sem sessao guardada').slice(0, 80) };
  } catch (e) {
    return { ok: false, motivo: String(e?.message || e).slice(0, 80) };
  }
}

/**
 * Roda `ler()` — que deve devolver `{ data, error }` no formato do postgrest-js — e, se o erro
 * for de sessão, renova e roda de novo. Devolve `{ data, error, renovou, motivoRenovacao }`.
 */
export async function lerComRenovacao(supabase, ler) {
  const r1 = await ler();
  if (!ehErroDeSessao(r1?.error)) return { ...r1, renovou: false, motivoRenovacao: null };
  const { ok, motivo } = await renovarSessao(supabase);
  if (!ok) return { ...r1, renovou: false, motivoRenovacao: motivo };
  const r2 = await ler();
  return { ...r2, renovou: true, motivoRenovacao: null };
}
