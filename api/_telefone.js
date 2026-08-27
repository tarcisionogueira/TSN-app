/**
 * REGRA DE TELEFONE — cópia do SERVIDOR, deliberada.
 *
 * Espelha `src/lib/telefone.js`, na mesma divisão de `api/_nome.js`: o front é
 * conveniência (máscara e aviso enquanto se digita), aqui é a garantia — quem posta
 * direto em `/api/live-inscrever` não passa por tela nenhuma.
 *
 * Por que a régua existe (18/08): não havia validação de TAMANHO em nenhum cadastro, e o
 * acervo mostrou o custo — perfis com 10 dígitos onde um deles ("3598423315") é claramente
 * um celular faltando um dígito. É o número pelo qual se liga para o cliente; dígito a
 * menos = cliente inalcançável, descoberto só na hora em que mais importa. Numa inscrição
 * de aula ao vivo o custo é o mesmo com outro nome: o lembrete do WhatsApp não chega.
 *
 * Campo VAZIO é decisão de quem chama — esta função só valida o que foi digitado, igual à
 * do front. Rota que exige telefone checa o vazio antes.
 *
 * Mudou a régua num lado, mude no outro.
 */

export const limparTelefone = (s) => String(s || '').replace(/\D/g, '');

/** @returns {string} mensagem de erro, ou '' quando válido (inclusive vazio). */
export function erroTelefone(s) {
  const d = limparTelefone(s);
  if (!d) return '';
  if (d.length < 10 || d.length > 11) return 'Telefone incompleto: informe DDD + número (10 ou 11 dígitos).';
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11) return 'DDD inválido.';
  if (d.length === 11 && d[2] !== '9') return 'Celular tem 9 após o DDD — confira o número.';
  if (/^(\d)\1+$/.test(d.slice(2))) return 'Telefone inválido.';
  return '';
}

/**
 * Forma canônica BRASILEIRA: só os dígitos DDD + número, sem o país. Existe por causa do
 * autopreenchimento ("+55 71 99650-2234"): sem tirar o 55, os 13 dígitos viram um número
 * de 11 que não é o da pessoa. Só tira quando o resto sobra com tamanho de telefone —
 * "5511987654" é o DDD 55 (Santa Maria/RS) e fica intacto.
 */
export function normalizarTelefoneBR(s) {
  const d = limparTelefone(s);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d.slice(2);
  return d;
}

/** "(71) 99650-2234" — formato de exibição. Fixo (10 dígitos) sai "(71) 3650-2234". */
export function formatarTelefone(s) {
  const d = normalizarTelefoneBR(s).slice(0, 11);
  if (d.length < 3) return d;
  const corpo = d.slice(2);
  const corte = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${corpo.slice(0, corte)}${corpo.length > corte ? '-' + corpo.slice(corte) : ''}`;
}
