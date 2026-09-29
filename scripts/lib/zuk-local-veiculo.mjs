// LOCAL DO VEÍCULO NO PORTALZUK (29/09). O regex antigo pegava o PRIMEIRO "Palavra/XX" do card —
// e no ZUK isso é a marca/modelo: "Honda/CB 300R" virava cidade "Honda" UF "CB", "VW/Fusca" virava
// "Carro"/"VW", e "placa... Ipojuca/PE" virava a cidade "Placa... Ipojuca". 123 veículos fora do
// IBGE no invariante `veiculo_cidade_fora_do_ibge`, sumindo do filtro de cidade.
// O título do ZUK SEMPRE traz o local entre hífens: "Motos - Honda em leilão - Rua X, 328 -
// Francisco Morato/SP - Tribunal de Justiça…". Esse é o primeiro recurso; o endereço do card é o
// segundo, e em qualquer um a UF precisa ser sigla de verdade.
const UFS = new Set(['AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO']);
const RE_TITULO = /(?:^|\s-\s)([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '-]{1,39}?)\s*\/\s*([A-Z]{2})(?=\s*(?:-|\||$))/g;
const RE_ENDERECO = /([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ '-]{1,39}?)\s*[,/]\s*([A-Z]{2})\b/g;

function primeiroValido(texto, re) {
  for (const m of String(texto || '').matchAll(re)) {
    if (UFS.has(m[2])) return { cidade: m[1].trim(), estado: m[2] };
  }
  return null;
}

export function localVeiculoZuk({ title, addr, textoCard } = {}) {
  return primeiroValido(title, RE_TITULO) || primeiroValido(addr, RE_ENDERECO) || primeiroValido(textoCard, RE_ENDERECO) || { cidade: null, estado: null };
}
