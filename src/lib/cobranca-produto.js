// Link avulso é de uso único e feito para uma pessoa (dono, 08/11): pagou um produto de plano, o plano ativa na conta dela.
// Produto sem plano (taxa de registro, cobrança livre) só recebe a baixa. Fonte única para a tela, a API e o cron.
export function efeitoDoProduto(produtoKey) {
  const k = String(produtoKey || '');
  if (/^assessorado/.test(k)) return { tipo: 'assessoria' };
  if (/^[a-z0-9_]+_anual$/.test(k)) return { tipo: 'plano', planoKey: k };
  return null;
}
