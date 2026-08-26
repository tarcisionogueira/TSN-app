/**
 * CORES DA MARCA — a fonte única.
 *
 * Criado em 26/08 por decisão do dono: *"deve sempre seguir as cores do sistema/marca em
 * todas as telas"*. Até aqui, cada curso e cada eBook escolhia a própria cor no cadastro,
 * e o resultado era um catálogo em que dois produtos da mesma casa não pareciam da mesma
 * casa — quem cadastrava decidia a identidade visual sem querer.
 *
 * O campo de cor saiu do formulário. A coluna `cor` continua no banco, deliberadamente:
 * apagá-la quebraria as telas que a leem hoje, e o valor antigo passa a ser ignorado em
 * favor destes tokens. Se um dia a marca ganhar cores por categoria, é aqui que elas
 * entram — num lugar só.
 *
 * NÃO é uma refatoração do sistema inteiro: o azul da marca aparece como literal em ~710
 * pontos do código, e trocar todos de uma vez, na semana de um lançamento, seria arriscar
 * a plataforma inteira para arrumar o que ninguém está vendo. Estes tokens cobrem as telas
 * de produto, curso e evento — as que o cadastro afetava — e servem de porta de entrada
 * para o resto, aos poucos.
 */

/** Azul principal. É o mesmo `#0D63DB` que a plataforma já usa em botão e destaque. */
export const AZUL = '#0D63DB';

/** Navy da landing e das páginas de campanha (hero escuro). */
export const NAVY = '#0B1B33';

/** Latão: o acento quente, usado com parcimônia sobre o navy. */
export const LATAO = '#D8A94A';

/** Verde de sucesso/preço — reservado a estado, nunca a decoração. */
export const VERDE = '#047857';

/**
 * A cor de um produto (curso ou eBook).
 *
 * Recebe o produto só para manter as chamadas legíveis nas telas; o argumento é ignorado
 * de propósito. Assim, quando a regra mudar (por categoria, por exemplo), muda-se esta
 * função e nenhuma tela precisa ser tocada.
 */
export function corDoProduto(_produto) {
  return AZUL;
}

/** Fundo suave da mesma cor, para faixas e cartões. `pct` em hexadecimal de opacidade. */
export function corSuave(hex = AZUL, sufixo = '15') {
  return `${hex}${sufixo}`;
}
