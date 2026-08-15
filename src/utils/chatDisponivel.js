/**
 * QUEM TEM CHAT DE SUPORTE — uma resposta só, para as duas pontas.
 *
 * POR QUE NASCEU (15/08, minutos depois de eu mesmo criar o problema). O botão do chat morava
 * DENTRO do `ChatSuporte`, então ele herdava de graça a condição do componente: equipe e modo
 * suporte não veem o widget, porque o componente inteiro devolve `null` para eles — quem atende
 * responde pela tela Atendimento. Ao mover o acesso para o menu do Header, separei o GATILHO da
 * coisa que ele aciona, e as duas pontas passaram a ter opiniões diferentes: o Header mostrava
 * "Assistente" para qualquer usuário logado, o `ChatSuporte` não desenhava nada para o admin. O
 * dono clicou e não aconteceu absolutamente nada — sem erro, sem aviso, sem pista.
 *
 * É a família de sempre neste projeto, aplicada à interface: a tela afirmando uma coisa que o
 * sistema não faz. E o modo de evitar que volte é o mesmo de sempre — não sincronizar as duas
 * cópias, e sim não ter duas. Quem quiser oferecer o chat em outro lugar pergunta aqui.
 *
 * Regra: o chat é do CLIENTE. Equipe (admin, analista, consultor, advogado) responde pelo
 * Atendimento, e no MODO SUPORTE quem está na tela é o admin dentro da conta de outra pessoa —
 * abrir o chat ali seria conversar consigo mesmo em nome do cliente.
 *
 * ⚠️ `role` aqui é o EFETIVO (o que o `AuthContext` expõe). Isso é proposital: o admin que
 * simula "explorador" PRECISA ver o chat, porque é parte do que ele foi conferir.
 */
export const STAFF_ROLES = ['admin', 'analista', 'consultor', 'advogado'];

export function chatDisponivelPara({ isLoggedIn, role, impersonate }) {
  if (!isLoggedIn) return false;
  if (impersonate) return false;
  return !STAFF_ROLES.includes(role);
}
