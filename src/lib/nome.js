/**
 * REGRA DE NOME — uma definição só, para o front inteiro.
 *
 * Por que existe (18/08): a validação de nome no cadastro era `if (!form.nome)` — qualquer
 * coisa não-vazia passava. O resultado aparece na lista de clientes do admin: de 53 perfis,
 * **2 tinham só um nome** ("daniel"), **6 estavam todos em minúsculo** e **8 todos em
 * maiúsculo** ("MOACIR EVERSON GONCALVES"). Um primeiro nome solto não identifica ninguém
 * na hora de emitir contrato, conferir CPF ou falar com o cliente.
 *
 * A régua é DELIBERADAMENTE baixa: não é barreira de entrada, é o mínimo para o cadastro
 * servir para alguma coisa — nome e sobrenome. Nada de exigir sobrenome composto, nada de
 * bloquear nome curto, nada de recusar acento, hífen ou apóstrofo.
 *
 * O servidor (`api/criar-conta-checkout.js`, `api/assinar-com-cadastro.js`) mantém a sua
 * própria checagem, e o banco NORMALIZA por gatilho: front é conveniência, servidor é
 * garantia, e a capitalização é arrumada onde ninguém consegue passar por fora.
 */

// Letras (com acento), espaço, hífen, apóstrofo e ponto (para "Ana C. Silva").
const CARACTERES_OK = /^[\p{L}\s'’.-]+$/u;

/** Espaços colapsados e aparados — a forma canônica antes de qualquer checagem. */
export const limparNome = (s) => String(s || '').replace(/\s+/g, ' ').trim();

/** Partes com 2+ letras. "Ana C. Silva" tem duas ("Ana", "Silva"); "daniel", uma. */
const partesSignificativas = (s) =>
  limparNome(s).split(' ').filter((p) => (p.match(/\p{L}/gu) || []).length >= 2);

export const MSG_NOME_INVALIDO = 'Digite seu nome e sobrenome (como no documento).';

/**
 * Válido = nome + sobrenome, sem número nem símbolo estranho. Só isso.
 * Devolve { ok, erro } para a tela poder explicar o que falta.
 */
export function validarNome(s) {
  const v = limparNome(s);
  if (!v) return { ok: false, erro: 'Preencha seu nome.' };
  if (v.length < 5) return { ok: false, erro: MSG_NOME_INVALIDO };
  if (v.length > 80) return { ok: false, erro: 'Nome muito longo (máximo 80 caracteres).' };
  if (/\d/.test(v)) return { ok: false, erro: 'O nome não deve conter números.' };
  if (!CARACTERES_OK.test(v)) return { ok: false, erro: 'O nome deve conter apenas letras.' };
  if (partesSignificativas(v).length < 2) return { ok: false, erro: MSG_NOME_INVALIDO };
  return { ok: true, erro: '' };
}

export const nomeValido = (s) => validarNome(s).ok;

// Partículas que ficam em minúsculo quando NÃO são a primeira palavra.
const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e', 'di', 'du', 'del', 'della', 'van', 'von', 'y', 'la', 'le']);

const capitalizarPedaco = (p) => (p ? p[0].toLocaleUpperCase('pt-BR') + p.slice(1) : p);

/**
 * Capitalização de exibição: "daniel" → "Daniel", "MOACIR EVERSON GONCALVES" → "Moacir
 * Everson Goncalves", "maria DAS dores" → "Maria das Dores".
 *
 * Preserva maiúscula INTERNA já digitada (McDonald, DiCaprio, D'Ávila) — quem escreveu
 * assim escreveu de propósito, e "corrigir" isso seria estragar o nome da pessoa.
 */
export function normalizarNome(s) {
  const v = limparNome(s);
  if (!v) return '';
  return v.split(' ').map((palavra, i) => {
    // Já tem maiúscula fora da primeira letra → respeita como está.
    if (/\p{Ll}\p{Lu}/u.test(palavra)) return palavra;
    const baixa = palavra.toLocaleLowerCase('pt-BR');
    if (i > 0 && PARTICULAS.has(baixa)) return baixa;
    // Capitaliza também depois de hífen e apóstrofo: "anna-maria" → "Anna-Maria".
    return baixa.split(/([-'’])/).map((parte, j) => (j % 2 ? parte : capitalizarPedaco(parte))).join('');
  }).join(' ');
}
