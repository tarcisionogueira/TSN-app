/**
 * REGRA DE SENHA — uma definição só, para o front inteiro.
 *
 * Por que existe (18/08): o mesmo regex estava copiado em Login.jsx, Checkout.jsx (três vezes)
 * e RedefinirSenha.jsx, e a lista de requisitos exibida ao usuário estava copiada em outros
 * três lugares. Em 15/08 o Login ganhou a trava que IMPEDE o envio com senha fraca; o Checkout
 * ficou com o checklist informando e o botão liberado — a pessoa via o que faltava, clicava
 * assim mesmo e tomava o erro. Cópia que não recebe o conserto é a que sangra, e aqui sangrava
 * justamente no funil PAGANTE.
 *
 * O servidor (`api/criar-conta-checkout.js`, `api/assinar-com-cadastro.js`) mantém a sua própria
 * checagem de propósito: o front é conveniência, o servidor é a garantia. O que não pode haver
 * é DUAS regras de front divergindo entre si.
 */
export const SENHA_FORTE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

export const senhaForte = (s) => SENHA_FORTE.test(String(s || ''));

/** Itens do checklist ao vivo — a MESMA lista que a validação aplica. */
export const requisitosSenha = (s) => {
  const v = String(s || '');
  return [
    { ok: v.length >= 8, txt: 'Mínimo 8 caracteres' },
    { ok: /[A-Z]/.test(v), txt: 'Uma letra maiúscula' },
    { ok: /[a-z]/.test(v), txt: 'Uma letra minúscula' },
    { ok: /\d/.test(v), txt: 'Um número' },
    { ok: /[^A-Za-z0-9]/.test(v), txt: 'Um caractere especial (ex.: ! @ # $)' },
  ];
};

export const MSG_SENHA_FRACA =
  'A senha deve ter ao menos 8 caracteres, com letra maiúscula, minúscula, número e caractere especial.';
