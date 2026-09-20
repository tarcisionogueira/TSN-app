// Extrai do CABEÇALHO da matrícula (texto do PDF) o cartório/serventia de Registro
// de Imóveis, o ofício, a comarca e o número da matrícula. Heurístico e tolerante:
// devolve só os campos que casarem, ou null. Compartilhado entre o cron de
// backfill (scripts/enriquecer-cartorio-matricula.mjs) e o enriquecimento on-view
// (api/enriquecer-lote.js), para uma única lógica de extração.

const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim().replace(/[.,;\-\s]+$/, '');

export function extrairRegistroMatricula(txt) {
  if (!txt) return null;
  const t = String(txt).replace(/\s+/g, ' ').slice(0, 6000);
  const f = {};
  // Cartório / Serventia de Registro de Imóveis (com ofício/circunscrição).
  let m = t.match(/(\d+[ºªo°]?\s*(?:of[íi]cio|circunscri[çc][ãa]o|servi[çc]o registral|cart[óo]rio)[^.\n;]{0,70}?registr(?:o|al) de im[óo]veis[^.\n;]{0,40})/i)
       || t.match(/((?:oficial|of[íi]cio|cart[óo]rio|serventia|servi[çc]o)[^.\n;]{0,25}registr(?:o|al) de im[óo]veis[^.\n;]{0,50})/i)
       || t.match(/(registr(?:o|al) de im[óo]veis[^.\n;]{0,55})/i);
  if (m) {
    // Corta o que vier depois do cabeçalho do cartório (nº da matrícula, livro…).
    const c = limpar(m[1]).split(/\bmatr[íi]cula\b|\blivro\b|\bficha\b|\bregistro geral\b|\bn[º°]\s*\d/i)[0];
    f.cartorio = limpar(c).slice(0, 90);
  }
  // Comarca / município do registro.
  m = t.match(/comarca\s+de\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'’.\- ]{2,45}?)(?=\s*[-–,\/;]|\s+estado|\s+e\s+o?\s|\.|$)/i)
   || t.match(/munic[íi]pio\s+de\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'’.\- ]{2,45}?)(?=\s*[-–,\/;]|\s+estado|\.|$)/i);
  if (m) f.comarca = limpar(m[1]);
  // Número do ofício.
  m = t.match(/(\d+)\s*[ºªo°]\s*of[íi]cio/i);
  if (m) f.oficio = `${m[1]}º Ofício`;
  // Número da matrícula.
  m = t.match(/matr[íi]cula[\s:º°n.\-]*([\d.]{2,12}\d|\d{2,8})/i);
  if (m) { const num = m[1].replace(/\.+$/, ''); if (/\d/.test(num)) f.matricula = num; }
  return Object.keys(f).length ? f : null;
}

// Extrai do CORPO da matrícula (descrição do imóvel) o ENDEREÇO para geocodificar:
// logradouro (rua/av/estrada…), bairro (ou "Fazenda X" em FSA) e loteamento/
// condomínio. Serve para lotes SEM endereço na ficha (ex.: LJUD), que hoje caem no
// centroide da cidade. Heurístico e tolerante; devolve só o que casar, ou null.
export function extrairEnderecoMatricula(txt) {
  if (!txt) return null;
  const t = String(txt).replace(/\s+/g, ' ').slice(0, 6000);
  const f = {};
  const tipos = 'rua|avenida|av\\.?|travessa|estrada|rodovia|pra[çc]a|alameda|ladeira|beco|via|largo';
  // 20/09: "situad[oa] (na|no|à) <tipo>" falhava em matrícula com ruído entre as duas palavras
  // (achado real: "situado RIA Alameda das Guaraunas" — "ria" é erro de digitação/OCR por "na",
  // e quebrava o casamento antigo, que exigia a preposição EXATA). Agora aceita uma palavra
  // curta qualquer entre "situad[oa]"/"localizad[oa]" e o tipo de logradouro — quem ancora o
  // casamento é o TIPO (rua/alameda/...), não a preposição, que pode vir corrompida.
  let m = t.match(new RegExp(`\\b(?:na|no|à|situad[oa]s?\\s+(?:\\S+\\s+)?|localizad[oa]s?\\s+(?:\\S+\\s+)?)((?:${tipos})\\s+[A-Za-zÀ-ú0-9'’.ºª\\- ]{2,55}?)(?=\\s*[,;.]|\\s+n[º°o]\\b|\\s+medindo|\\s+bairro|\\s+fazenda|\\s+lote\\b|\\s+quadra\\b|\\s+nesta|\\s+s/?n\\b|$)`, 'i'));
  if (m) f.logradouro = limpar(m[1]);
  m = t.match(/\bbairro\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'’.\- ]{2,40}?)(?=\s*[,;.]|\s+medindo|\s+lote\b|\s+quadra\b|\s+munic|\s+cidade|$)/i)
    || t.match(/\b(fazenda\s+[A-Za-zÀ-ú][A-Za-zÀ-ú'’.\- ]{2,30}?)(?=\s*[,;.]|\s+nesta|$)/i);
  if (m) f.bairro = limpar(m[1]);
  // "loteamento denominado 'X'" também não casava (a palavra "denominado" entre o gatilho e o
  // nome quebrava o casamento antigo) — achado no mesmo texto real. Aceita "denominado" opcional
  // e aspas (retas ou curvas) em volta do nome.
  m = t.match(/\b(?:loteamento|condom[íi]nio|residencial|conjunto(?:\s+habitacional)?)\s+(?:denominado\s+)?["“']?([A-Za-zÀ-ú0-9][A-Za-zÀ-ú0-9'’.\- ]{2,45}?)["”']?(?=\s*[,;.]|\s+localizad|\s+situad|\s+nesta|\s+no\s+distrito|\s+munic|\s+lote\b|\s+quadra\b|$)/i);
  if (m) f.loteamento = limpar(m[1]);
  // MUNICÍPIO do imóvel (20/09) — distinto da COMARCA do registro (`extrairRegistroMatricula`
  // acima): "no distrito e Município de Santana de Parnaíba, Comarca de Barueri" tem os dois na
  // mesma frase e são CIDADES DIFERENTES — a comarca é o fórum judicial, não necessariamente o
  // município do imóvel. Achado real: o card gravava `cidade: "São Paulo"` (genérico da fonte)
  // enquanto a própria matrícula, já no nosso banco, dizia Santana de Parnaíba — a busca de
  // mercado procurava anúncio na cidade errada e nunca achava nada.
  m = t.match(/\bmunic[íi]pio\s+de\s+([A-Za-zÀ-ú][A-Za-zÀ-ú'’.\- ]{2,40}?)(?=\s*[,;.]|\s+comarca|\s+deste\s+estado|\s+estado\s+de|$)/i);
  if (m) f.municipio = limpar(m[1]);
  return Object.keys(f).length ? f : null;
}
