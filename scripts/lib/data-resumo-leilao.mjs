// Data do leilão no RESUMO publicado pelo leiloeiro (11/11, caso Cravo 12733).
// A plataforma SOLEON abre a og:description com "Leilão: 21/01/2027 às 15:00, LOTE 01: ...".
// É o campo do próprio leiloeiro, e por isso vence a varredura genérica do corpo da página.
// "Leilão: 21/01/2027 às 15:00, ..." → "2027-01-21T15:00:00-03:00"; sem hora → "2027-01-21"; senão null.
export function dataDoResumoSoleon(descricao) {
  const m = String(descricao || '').match(/^\s*Leil[ãa]o:\s*(\d{2})\/(\d{2})\/(\d{4})(?:\s*(?:[àa]s)?\s*(\d{1,2})[:h](\d{2}))?/i);
  if (!m) return null;
  const [, d, mes, a, hh, mm] = m;
  if (Number(mes) < 1 || Number(mes) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return hh ? `${a}-${mes}-${d}T${hh.padStart(2, '0')}:${mm}:00-03:00` : `${a}-${mes}-${d}`;
}
