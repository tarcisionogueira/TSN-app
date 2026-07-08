// Fonte ÚNICA da NATUREZA do leilão (o campo `imoveis_leilao.modalidade`).
//
// REGRA (espelha a de _tipo.js): todo caminho de ingestão que aceita texto livre
// (webhook e feed de parceiros) DEVE passar a modalidade por aqui antes de gravar.
// A Busca filtra por IGUALDADE EXATA (`.in('modalidade', [...])`), então qualquer
// grafia fora do conjunto canônico ("Judicial", "JUDICIAL", "Leilão Extrajudicial",
// "extra-judicial") some do filtro assim que o usuário liga a modalidade.
//
// Conjunto canônico (o que existe no banco e tem label em src/pages/Busca.jsx):
//   venda_direta | licitacao_aberta | judicial | extrajudicial
//
// Eixos: `judicial`/`extrajudicial` = NATUREZA jurídica; `venda_direta`/
// `licitacao_aberta` = forma de venda. A Caixa (CEF) é SEMPRE extrajudicial
// (SFI/alienação fiduciária, Lei 9.514) — ver normalizarModalidadeCEF nos scrapers.
export function normalizarModalidade(m) {
  if (!m) return null; // desconhecido: não inventa natureza (fica visível, só não filtra)
  const s = String(m).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  if (s.includes('venda') && (s.includes('direta') || s.includes('online'))) return 'venda_direta';
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
