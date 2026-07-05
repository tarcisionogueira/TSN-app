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
  if (!d) {
    // Venda direta é compra contínua (não tem data). Nos leilões/licitações da
    // Caixa a data existe, mas no EDITAL (não vem no CSV em massa) — então rotulamos
    // com clareza em vez de "Sem data".
    if (modalidade === 'venda_direta') return 'Venda Direta';
    if (modalidade === 'licitacao_aberta') return 'Prazo no edital';
    return 'A confirmar no edital';
  }
  const dt = new Date(d);
  if (isNaN(dt)) return d;
  return dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

// Menção curta explicando POR QUE não há data — facilita o entendimento (o usuário
// via "Prazo no edital"/"Venda Direta" sem saber o motivo).
export function explicacaoData(modalidade) {
  if (modalidade === 'venda_direta')
    return 'Venda direta é compra contínua — não tem data de leilão. Fica disponível enquanto estiver listada no acervo da Caixa.';
  if (modalidade === 'licitacao_aberta')
    return 'Nesta licitação a data/prazo para envio das propostas consta no edital (a lista em massa da Caixa não traz esse campo).';
  return 'A data do leilão será confirmada no edital do lote.';
}

export const fmtBRL = (v) =>
  v ? 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '—';
