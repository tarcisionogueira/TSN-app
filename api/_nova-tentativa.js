// Repete uma vez a leitura que estourou o statement_timeout (57014). A tentativa cancelada deixa as páginas do acervo
// em memória, então a segunda costuma passar. Só para chamada idempotente: o timeout desfaz a transação inteira.
export async function repetirSeTimeout(chamar, ehTimeout, esperaMs = 2000) {
  const primeira = await chamar();
  if (!(await ehTimeout(primeira))) return primeira;
  await new Promise((resolve) => setTimeout(resolve, esperaMs));
  return chamar();
}
