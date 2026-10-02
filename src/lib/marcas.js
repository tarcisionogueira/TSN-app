// APELIDOS DE MARCA → MARCA CANÔNICA, para a busca de veículos (02/10, dono: "ao consultar a marca não
// separar a abreviatura VW de Volkswagen; veja também outros casos").
//
// O banco grava em `veiculos_leilao.marca_busca` a marca canônica (tabela `marca_alias`, migração
// 20261002_marca_busca_canonica — fonte de verdade). Aqui fica o espelho das MARCAS (não dos modelos)
// para expandir o que a pessoa digita: "vw" → VOLKSWAGEN, "gm" → CHEVROLET, "mb" → MERCEDES-BENZ,
// "volk" → VOLKSWAGEN. Marca nova: incluir lá (insert) e aqui.
const ALIAS = {
  VOLKSWAGEN: ['vw', 'volks', 'volkswagem', 'v.w'],
  CHEVROLET: ['gm', 'gmc', 'chev', 'chevy', 'g.m'],
  'MERCEDES-BENZ': ['mercedes', 'mercedes benz', 'm.benz', 'm. benz', 'm benz', 'mbenz', 'mb'],
  MITSUBISHI: ['mmc'],
  KIA: ['kia motors'],
  CITROEN: ['citroën'],
  'CAOA CHERY': ['caoachery', 'caoa', 'chery'],
  'ROYAL ENFIELD': ['royal', 're'],
  'HARLEY-DAVIDSON': ['harley', 'harley davidson', 'h-d'],
  'LAND ROVER': ['land-rover', 'lr'],
  RENAULT: ['renalt'],
  SUZUKI: ['jta'],
  GWM: ['great wall', 'haval'],
  BRP: ['can-am'],
};

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

/**
 * Marcas canônicas que o termo digitado pode querer dizer. Casa por PREFIXO do nome canônico ou de
 * um apelido ("volk" → VOLKSWAGEN; "vw" → VOLKSWAGEN; "merc" → MERCEDES-BENZ). Apelido de 1–2 letras
 * só casa INTEIRO ("m" não vira MERCEDES-BENZ por causa do "mb").
 */
export function marcasDoTermo(termo) {
  const t = norm(termo);
  if (!t) return [];
  const achadas = new Set();
  for (const [canon, apelidos] of Object.entries(ALIAS)) {
    if (norm(canon).startsWith(t)) achadas.add(canon);
    for (const a of apelidos) {
      const na = norm(a);
      if (na.length <= 2 ? na === t : na.startsWith(t)) achadas.add(canon);
    }
  }
  return [...achadas];
}
