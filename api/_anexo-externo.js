// ANEXO QUE MORA NO LEILOEIRO (07/10) — regra única dos dois leitores de documento
// (`anexo-url.js` e `doc-url.js`), que a tinham pela metade e cada um do seu jeito.
//
// Nem todo `imovel_anexos` tem arquivo NOSSO. O coletor grava o edital e a matrícula do site do
// leiloeiro com `origem_url` preenchido e `storage_path` nulo — 25 mil linhas em 07/10. Os dois
// endpoints só sabiam assinar `storage_path` e respondiam 404 "Anexo sem arquivo" para um
// documento que EXISTE, com o endereço na própria linha: a limitação do leitor entregue ao
// cliente como ausência do documento (forma nº 1 do CLAUDE.md).
//
// `url` só entra quando NÃO há `storage_path`: para arquivo nosso ele guarda uma signed URL de 1h
// já vencida, e servi-la de volta é justamente o bug que o `doc-url.js` existe para não cometer.
export function linkExternoDoAnexo(anexo) {
  if (!anexo || anexo.storage_path) return null;
  const cand = [anexo.origem_url, anexo.url].find((u) => /^https?:\/\//i.test(String(u || '')));
  return cand || null;
}
