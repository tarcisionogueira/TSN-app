// Fonte ÚNICA da NATUREZA do leilão (o campo `imoveis_leilao.modalidade`).
//
// REGRA (espelha a de _tipo.js): todo caminho de ingestão que aceita texto livre
// (webhook e feed de parceiros) DEVE passar a modalidade por aqui antes de gravar.
// A Busca filtra por IGUALDADE EXATA (`.in('modalidade', [...])`), então qualquer
// grafia fora do conjunto canônico ("Judicial", "JUDICIAL", "Leilão Extrajudicial",
// "extra-judicial") some do filtro assim que o usuário liga a modalidade.
//
// Conjunto canônico (o que existe no banco e tem label em src/pages/Busca.jsx):
//   venda_direta | venda_online | primeiro_leilao | segundo_leilao | praca_unica |
//   licitacao_aberta | judicial | extrajudicial
//
// Eixos: `judicial`/`extrajudicial` = NATUREZA jurídica; `venda_direta`/`venda_online`/
// `licitacao_aberta` = forma de venda. A Caixa (CEF) é SEMPRE extrajudicial
// (SFI/alienação fiduciária, Lei 9.514) — ver normalizarModalidadeCEF nos scrapers.
//
// venda_direta ≠ venda_online (pedido do dono, 03/09): a classificação segue o rótulo
// EXATO do leiloeiro — venda direta é compra contínua sem prazo, venda online tem prazo/
// contador de encerramento publicado pelo próprio leiloeiro. Empilhar as duas escondia
// isso do cliente (achado com print: lote CEF anunciado como "Venda Online" aparecia como
// "Venda Direta" na ficha). As duas seguem tratadas como "sem praça" (sem edital de leilão)
// para fins de documento exigido — só o RÓTULO de exibição diverge.
export function normalizarModalidade(m) {
  if (!m) return null; // desconhecido: não inventa natureza (fica visível, só não filtra)
  const s = String(m).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (s.includes('venda') && s.includes('online')) return 'venda_online';
  if (s.includes('venda') && s.includes('direta')) return 'venda_direta';
  if (s.includes('licitac')) return 'licitacao_aberta';
  // "extrajudicial"/"extra-judicial"/"leilão extrajudicial" — checa ANTES de 'judicial'
  // (senão o substring 'judicial' de "extrajudicial" classificaria errado).
  if (s.includes('extrajud') || s.includes('extra jud') || s.includes('extra-jud')) return 'extrajudicial';
  if (s.includes('judicial')) return 'judicial';
  // Leilão/praça/hasta genérico de leiloeiro privado → extrajudicial (default seguro,
  // mesmo critério dos scrapers de leiloeiros e da Caixa).
  if (s.includes('leil') || s.includes('praca') || s.includes('hasta')) return 'extrajudicial';
  return null;
}

export default normalizarModalidade;
