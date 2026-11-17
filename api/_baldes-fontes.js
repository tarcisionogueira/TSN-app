/**
 * Baldes do alerta diário de fontes (auditoria de captura, 17/11). O e-mail listava 127 "problemas"
 * de um tipo só, e mais de 60 eram leiloeiro que fez o leilão e esvaziou — o que quebrou de verdade
 * ficava enterrado. Cada problema cai em UM balde, pela AÇÃO que pede:
 *   agir      — quebrou do nosso lado (parser, API mudou, coleta parada, campo regrediu, QA)
 *   fora      — site do leiloeiro fora do ar ou bloqueando o robô: não há parser a consertar
 *   sem_lote  — acervo abaixo do normal que a função expiração-consciente NÃO acusa (leilão
 *               aconteceu) ou que já tem explicação gravada: informativo, não dispara e-mail
 * Regras puras, sem rede — testes em scripts/testes/baldes-fontes.mjs.
 */

// Motivo de ACESSO escrito pelos scrapers. "não parser" é o próprio scraper dizendo que é acesso.
export const RE_ACESSO = /(n[aã]o parser|HTTP (403|5\d\d)|challenge|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|CERT|SSL|Timeout of|firecrawl-5\d\d|dom-(403|5\d\d)|recusado \(HTTP 40[34]\))/i;

/** @param p {fonte,tipo,detalhe,balde?}  @param pendentes Set de fontes que fonte_regressao_pendente() ainda acusa (ou null se não deu para ler) */
export function baldeDoProblema(p, pendentes) {
  if (p.balde) return p.balde;
  const tipo = String(p.tipo || '');
  if (tipo === 'acervo abaixo do normal aprendido') {
    // Sem a lista (RPC falhou) não dá para provar que é expiração: fica em "agir" — falha fechada.
    if (!pendentes) return 'agir';
    return pendentes.has(p.fonte) ? 'agir' : 'sem_lote';
  }
  if (/^(falhou|degradado)/.test(tipo) && RE_ACESSO.test(String(p.detalhe || ''))) return 'fora';
  return 'agir';
}

export function separarEmBaldes(problemas, pendentes) {
  const b = { agir: [], fora: [], sem_lote: [] };
  for (const p of problemas) b[baldeDoProblema(p, pendentes)].push(p);
  return b;
}
