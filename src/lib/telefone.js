/**
 * REGRA DE TELEFONE — uma definição só, na linha de src/lib/senha.js e src/lib/nome.js.
 *
 * Por que existe (18/08): não havia validação de TAMANHO em nenhum cadastro, e o acervo
 * mostrou o custo — 2 de 53 perfis com 10 dígitos onde um deles ("3598423315") é
 * claramente um celular faltando um dígito. É o número pelo qual se liga para o cliente;
 * dígito a menos = cliente inalcançável, descoberto só na hora em que mais importa.
 *
 * Régua deliberadamente baixa: DDD válido + 10 ou 11 dígitos. Fixo (10) continua aceito.
 * Campo VAZIO é decisão de quem chama (aqui ele é opcional em alguns fluxos) — esta
 * função só valida o que foi digitado.
 */

export const limparTelefone = (s) => String(s || '').replace(/\D/g, '');

/**
 * Forma canônica BRASILEIRA: só os dígitos DDD + número, sem o país.
 *
 * Existe por causa do autopreenchimento (27/08): `autocomplete="tel"` no celular devolve
 * "+55 71 99650-2234", e o teclado do Android às vezes também. Sem tirar o 55, os 13
 * dígitos passam por um corte em 11 e viram "(55) 71996-5022" — o número ERRADO, escrito
 * com cara de certo, que é a pior saída possível para o campo pelo qual se manda o link da
 * sala. Só tira quando o resto sobra com tamanho de telefone (10 ou 11): "5511987654321"
 * é São Paulo com país; "5511987654" é o DDD 55 (Santa Maria/RS) e fica intacto.
 */
export function normalizarTelefoneBR(s) {
  const d = limparTelefone(s);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) return d.slice(2);
  return d;
}

/**
 * Formato de exibição/digitação: "(71) 99650-2234". Corta em 11 dígitos, então o campo
 * que usa isto como máscara não chega a ter dígito SOBRANDO — a validação acima cuida do
 * que falta. O hífen é posicionado pelo TAMANHO (celular tem 5 antes do traço, fixo tem
 * 4): com posição fixa, um fixo de 10 dígitos sairia "(71) 36502-234", que é o número
 * certo escrito de um jeito que a pessoa não reconhece.
 */
export function formatarTelefone(s) {
  const d = normalizarTelefoneBR(s).slice(0, 11);
  if (d.length < 3) return d;
  const corpo = d.slice(2);
  const corte = d.length === 11 ? 5 : 4;
  return `(${d.slice(0, 2)}) ${corpo.slice(0, corte)}${corpo.length > corte ? '-' + corpo.slice(corte) : ''}`;
}

export function validarTelefone(s) {
  const d = limparTelefone(s);
  if (!d) return { ok: true, erro: '' }; // vazio: obrigatoriedade é decisão do formulário
  if (d.length < 10 || d.length > 11) {
    return { ok: false, erro: 'Telefone incompleto: informe DDD + número (10 ou 11 dígitos).' };
  }
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11) return { ok: false, erro: 'DDD inválido.' };
  if (d.length === 11 && d[2] !== '9') {
    return { ok: false, erro: 'Celular tem 9 após o DDD — confira o número.' };
  }
  if (/^(\d)\1+$/.test(d.slice(2))) return { ok: false, erro: 'Telefone inválido.' };
  return { ok: true, erro: '' };
}
