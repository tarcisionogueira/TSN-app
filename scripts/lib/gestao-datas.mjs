// Datas do cabeçalho de evento do back-office da Gestão de Leilões (scraper-gestao.mjs). Puro, testado em
// scripts/testes/gestao-encerramento.mjs. "Encerramento 04/Nov/2026" (cluster) e "Encerramento: 11/Dez/2026"
// (Vinco, com dois-pontos — sem o `:?` a abertura virava a data do leilão e o lote saía como vencido; 17/11).
export const RE_ENCERRAMENTO = /Encerramento:?\s*(\d{1,2}\/[A-Za-zç]{3}\/\d{4})/i;

// Card SEM categoria e sem "ESTADO: XX - CIDADE:" (17/11, Vinco evento 500: a mansão de R$ 1,5 mi em Santana de
// Parnaíba saía como "não imóvel" porque a leiloeira não preencheu a categoria). Só vale quando a categoria está
// AUSENTE — categoria preenchida (Veículos, Diversos) continua mandando. Título do lote + do leilão decidem.
const RE_TITULO_IMOVEL = /\b(resid[eê]ncia|casa|sobrado|apartamento|apto|cobertura|kitnet|terreno|lote\s+(?:urbano|de\s+terras?)|gleba|ch[aá]cara|s[ií]tio|fazenda|im[oó]vel|pr[eé]dio|galp[aã]o|sala\s+comercial|loja|mans[aã]o|edif[ií]cio)\b/i;
const RE_TITULO_NAO_IMOVEL = /\b(ve[ií]culo|motocicleta|moto|caminh[aã]o|carro|autom[oó]vel|sucata|m[aá]quina|trator|[ôo]nibus|mesa|m[oó]veis|equipamento)\b/i;
export function pareceImovelSemCategoria(textoLote, tituloLeilao = '') {
  const t = `${textoLote || ''} ${tituloLeilao || ''}`;
  return RE_TITULO_IMOVEL.test(t) && !RE_TITULO_NAO_IMOVEL.test(t);
}

// Tipo pelo título do lote (era local em scraper-gestao.mjs). 17/11: `residenc` não casava "residência" (com acento)
// e "mansão" não existia — o lote único do leilão 500 da Vinco saía "outros" e era descartado.
export function inferirTipo(txt = '') {
  const t = txt.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio|unidade aut/.test(t)) return 'apartamento';
  if (/casa|sobrado|resid[eê]nc|mans[aã]o/.test(t)) return 'casa';
  if (/terreno|lote de terreno|gleba|data de terra/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio|barrac/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}
