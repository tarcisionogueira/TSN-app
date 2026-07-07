// Fonte ÚNICA da classificação de tipologia do imóvel.
//
// REGRA ABSOLUTA: todo caminho de ingestão (scrapers Caixa/leiloeiros, webhook e
// feed de parceiros, scripts de coleta) DEVE passar o tipo por aqui antes de
// gravar em `imoveis_leilao.tipo`. O filtro da Busca casa por IGUALDADE EXATA
// (`.in('tipo', [...selecionados, 'imovel'])`), então qualquer string fora do
// conjunto canônico — ou com caixa/acionamento diferente ("Fazenda", "Galpão
// Industrial", "APTO") — some da busca assim que o usuário liga um filtro de tipo.
//
// Conjunto canônico (todos têm botão de filtro OU caem no balde de segurança
// 'imovel', que é SEMPRE incluído na busca):
//   apartamento | casa | terreno | comercial | rural | imovel
//
// 'comercial' abrange deliberadamente indústria/galpão/barracão/armazém (ativos
// comerciais para o investidor). 'imovel' é o balde genérico de segurança:
// nunca some da busca porque o filtro sempre o inclui. Assim NENHUM lote fica
// invisível — atende "não pode haver falhas" para tipologias atípicas.
export function normalizarTipo(t) {
  if (!t) return 'imovel';
  // minúsculas + sem acento/cedilha → "Indústria"→"industria", "Galpão"→"galpao".
  const s = String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Rural/agro PRIMEIRO: "galpão em fazenda", "sítio com casa" devem cair em rural.
  if (s.includes('rural') || s.includes('fazenda') || s.includes('sitio') ||
      s.includes('chacara') || s.includes('agricol') || s.includes('agropecu') ||
      s.includes('pecuari') || s.includes('haras') || s.includes('lavoura')) return 'rural';

  if (s.includes('apart') || s.includes('apto') || s.includes('flat') ||
      s.includes('kitnet') || s.includes('kitinete') || s.includes('studio') ||
      s.includes('cobertura')) return 'apartamento';

  if (s.includes('casa') || s.includes('sobrado') || s.includes('resid')) return 'casa';

  if (s.includes('terreno') || s.includes('lote') || s.includes('gleba') ||
      s.includes('data de terra') || s.includes('area de terra')) return 'terreno';

  // Comercial + industrial/logístico (findable sob o botão "Comercial").
  if (s.includes('comerc') || s.includes('sala') || s.includes('loja') ||
      s.includes('galp') || s.includes('barrac') || s.includes('industr') ||
      s.includes('armazem') || s.includes('deposito') || s.includes('predio') ||
      s.includes('escritorio') || s.includes('conjunto') || s.includes('ponto') ||
      s.includes('hotel') || s.includes('pousada') || s.includes('motel')) return 'comercial';

  return 'imovel';
}

export default normalizarTipo;
