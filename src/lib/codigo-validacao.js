// Código de validação de documento assinado (12/11, pedido do dono: "um código ligando todas as páginas
// à página de assinatura"). 16 caracteres de um alfabeto de 32 (sem I, O, 0, 1, que se confundem) =
// 80 bits aleatórios, gerados NO BANCO (public.gerar_codigo_validacao). Impresso em grupos
// (ABCD-EFGH-JKLM-NPQR) no rodapé de cada página; a busca aceita com ou sem hífen/minúsculas.
// Mesmo formato do CHECK em contratos_link.codigo_validacao. Usado pelo client e pela api.

export const ALFABETO_CODIGO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const FORMATO = /^[A-HJ-NP-Z2-9]{16}$/;

/** Normaliza o que a pessoa digitou/escaneou; null se não for um código válido. */
export function normalizarCodigo(entrada) {
  const c = String(entrada ?? '').toUpperCase().replace(/[\s-]/g, '');
  return FORMATO.test(c) ? c : null;
}

export const formatarCodigo = (c) => (normalizarCodigo(c) || '').replace(/(.{4})(?=.)/g, '$1-');

/** CPF/CNPJ só com começo e fim (LGPD) para a página pública de validação. */
export function mascararDocumento(d) {
  const x = String(d ?? '').replace(/\D/g, '');
  if (x.length === 11) return `${x.slice(0, 3)}.***.***-${x.slice(9)}`;
  if (x.length === 14) return `${x.slice(0, 2)}.***.***/****-${x.slice(12)}`;
  return null;
}
