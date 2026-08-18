/**
 * REGRA DE NOME — cópia do SERVIDOR, deliberada.
 *
 * Espelha `src/lib/nome.js`. O front é conveniência; aqui é a garantia — quem chama
 * `/api/criar-conta-checkout` ou `/api/assinar-com-cadastro` direto não passa pela tela.
 * Mesma divisão já adotada para a senha (ver o cabeçalho de `src/lib/senha.js`).
 *
 * Mudou a régua num lado, mude no outro. O banco ainda NORMALIZA por gatilho
 * (`normalizar_nome`), então a capitalização é arrumada mesmo por caminhos que ninguém previu.
 */
const CARACTERES_OK = /^[\p{L}\s'’.-]+$/u;

export const limparNome = (s) => String(s || '').replace(/\s+/g, ' ').trim();

const partesSignificativas = (s) =>
  limparNome(s).split(' ').filter((p) => (p.match(/\p{L}/gu) || []).length >= 2);

export const MSG_NOME_INVALIDO = 'Digite seu nome e sobrenome (como no documento).';

/** @returns {string} mensagem de erro, ou '' quando válido. */
export function erroNome(s) {
  const v = limparNome(s);
  if (!v) return 'Preencha seu nome.';
  if (v.length < 5 || partesSignificativas(v).length < 2) return MSG_NOME_INVALIDO;
  if (v.length > 80) return 'Nome muito longo (máximo 80 caracteres).';
  if (/\d/.test(v)) return 'O nome não deve conter números.';
  if (!CARACTERES_OK.test(v)) return 'O nome deve conter apenas letras.';
  return '';
}

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'della', 'van', 'von', 'y', 'la', 'le']);
const cap = (p) => (p ? p[0].toLocaleUpperCase('pt-BR') + p.slice(1) : p);

export function normalizarNome(s) {
  const v = limparNome(s);
  if (!v) return '';
  return v.split(' ').map((palavra, i) => {
    if (/\p{Ll}\p{Lu}/u.test(palavra)) return palavra;   // McDonald, DiCaprio — respeita
    const baixa = palavra.toLocaleLowerCase('pt-BR');
    if (i > 0 && PARTICULAS.has(baixa)) return baixa;
    return baixa.split(/([-'’])/).map((parte, j) => (j % 2 ? parte : cap(parte))).join('');
  }).join(' ');
}
