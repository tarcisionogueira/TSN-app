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
