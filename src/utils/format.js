// Helpers de formatação compartilhados entre as telas de imóvel (Busca, Detalhe).
// Mantidos idênticos aos originais definidos em Busca.jsx para evitar divergência.

export const MODAL_LABEL = {
  primeiro_leilao: '1ª Praça',
  segundo_leilao: '2ª Praça',
  venda_direta: 'Venda Direta',
  licitacao_aberta: 'Licitação Aberta',
  judicial: 'Judicial',
  extrajudicial: 'Extrajudicial',
};

export function fmtData(d, modalidade) {
  if (!d) return modalidade === 'venda_direta' ? 'Venda Direta' : 'Sem data';
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

export const fmtBRL = (v) =>
  v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
