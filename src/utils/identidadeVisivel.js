/**
 * Identidade que a TELA DE CLIENTE deve mostrar — a do cliente visto, nunca a de quem olha.
 *
 * POR QUE EXISTE (31/08). No modo suporte, `/perfil → Meus dados` mostrava o e-mail do ADMIN
 * no campo do cliente. Medido: a conta de Leonardo Oliveira exibia nome e telefone corretos
 * (`16992265426`, os dele) ao lado de `tarcisioaraujo@reimob.com.br`, que é do admin. Uma
 * ficha com dois donos, e nada na tela dizia qual campo era de quem.
 *
 * A CAUSA é uma assimetria de origem, e ela vale para toda tela de cliente:
 *   - nome, telefone, CPF, endereço vêm de `perfis`, lidos por `effectiveUserId` → seguem o
 *     modo suporte e ficam CERTOS;
 *   - o e-mail não existe em `perfis` (não há coluna `email` — foi o que o erro
 *     `column perfis.email does not exist` de 29/08 já tinha ensinado). Só existe em
 *     `auth.users`, e a tela o lia de `user`, que é a SESSÃO — o admin.
 *
 * Ou seja: o campo que não tinha de onde vir pelo caminho certo caiu no caminho errado, e o
 * caminho errado responde sempre, com um valor plausível. `Contratos.jsx:106` já registrava a
 * mesma limitação ("o objeto de suporte não carrega o e-mail do usuário visto") e contornou
 * localmente; aqui ela é resolvida na origem.
 *
 * REGRA: em modo suporte, e-mail desconhecido vira MARCADOR, nunca o de quem está olhando.
 * Um campo vazio faz perguntar; um campo com o e-mail errado, não — e é sobre esse e-mail que
 * o suporte vai falar com o cliente.
 */

/** Marcador exibido quando o e-mail do cliente não veio na carga do modo suporte. */
export const EMAIL_NAO_CARREGADO = '(e-mail não carregado no modo suporte)';

/**
 * @param {object|null} impersonate objeto do modo suporte ({ id, nome, role, email? })
 * @param {object|null} user        sessão autenticada do Supabase (quem está OLHANDO)
 * @returns {string} e-mail a exibir num campo de "dados do cliente"
 */
export function emailVisivel(impersonate, user) {
  // Fora do modo suporte, quem olha É o dono da ficha.
  if (!impersonate) return user?.email || '';
  // Dentro dele, só o e-mail do cliente serve. `trim` porque string em branco vinda do
  // sessionStorage é ausência, não valor — e sem isto ela passaria como e-mail válido.
  const doCliente = String(impersonate.email || '').trim();
  return doCliente || EMAIL_NAO_CARREGADO;
}
