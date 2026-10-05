// LOTE MANUAL — leitura dos anexos (05/10, Alphaville Burle Marx). Funções puras, testadas em
// scripts/testes/lote-no-edital.mjs com o texto REAL do edital do Bradesco.
//
// 1. MATRÍCULA ESCANEADA COM CARIMBO DIGITAL: a "camada de texto" do PDF era só o carimbo do ONR
//    ("Valide este documento clicando no link…") repetido — 410 caracteres — e a tela dizia "lido —
//    texto integral vai para a análise documental". Texto que é só carimbo NÃO é texto (forma nº 10).
// 2. EDITAL COM VÁRIOS IMÓVEIS: o do Bradesco lista ~20 lotes; a IA recebia o documento inteiro sem
//    saber qual era o nosso e devolvia vazio. O lote é LOCALIZADO no texto pelos dados da matrícula
//    (rua, loteamento, áreas) e só o trecho dele vai para a extração.

const sem = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Linhas de carimbo/assinatura digital, que se repetem em toda página de documento assinado.
const RE_CARIMBO = /valide (?:este|aqui)[^\n]*|este documento|assinado digitalmente[^\n]*|https?:\/\/\S+|assinador-web\S*|c[oó]digo de valida[cç][aã]o[^\n]*/gi;

export function textoUtil(texto) {
  return String(texto || '').replace(RE_CARIMBO, ' ').replace(/\s+/g, ' ').trim();
}
// Abaixo disto, o PDF não tem texto de verdade: é imagem (escaneado) com, no máximo, o carimbo.
export const ehTextoSoCarimbo = (texto) => textoUtil(texto).length < 400;

export function ehEditalMultiLote(texto) {
  const t = String(texto || '');
  return (t.match(/lance\s+m[ií]nimo/gi) || []).length >= 3 || (t.match(/\b1[ºo°]\s*leil[aã]o/gi) || []).length >= 3;
}

const PARADAS = new Set(('lote lotes terreno urbano quadra parte residencial loteamento comercializado comercializada denominacao '
  + 'situado situada cidade avenida alameda rua bairro estado imovel casa area areas matricula numero sendo como para com '
  + 'sob esta este municipio comarca registro predio edificacao construcao construida unidade identificacao curta').split(' '));

function tokensDoAlvo(alvo) {
  const palavras = new Set();
  for (const campo of [alvo?.endereco, alvo?.nome, alvo?.nomeCondominio]) {
    for (const w of sem(campo).split(/[^a-z0-9]+/)) if (w.length >= 4 && !PARADAS.has(w) && !/^\d+$/.test(w)) palavras.add(w);
  }
  // Áreas no formato do edital ("440,18m²"): sinal forte, quase único no documento.
  const areas = [alvo?.areaM2, alvo?.areaTerrenoM2].map(Number).filter((n) => n > 0)
    .map((n) => n.toFixed(2).replace('.', ','));
  return { palavras: [...palavras], areas: [...new Set(areas)] };
}

// Trecho do edital onde o imóvel-alvo aparece: janela de maior pontuação (palavras distintas do
// endereço/loteamento + áreas com peso 3), estendida para a frente para pegar o "Lance Mínimo" que
// vem DEPOIS da descrição. `null` quando nada casa — melhor não extrair do que extrair o lote errado.
export function trechoDoLote(texto, alvo, { janela = 1500, passo = 250 } = {}) {
  const t = String(texto || '').normalize('NFC'); // NFC: `sem()` preserva o comprimento → índices batem
  const tn = sem(t);
  const { palavras, areas } = tokensDoAlvo(alvo);
  if (!palavras.length && !areas.length) return null;
  let melhor = { pontos: 0, ini: -1 };
  for (let ini = 0; ini < Math.max(1, tn.length - janela / 2); ini += passo) {
    const pedaco = tn.slice(ini, ini + janela);
    const pontos = palavras.filter((w) => pedaco.includes(w)).length + 3 * areas.filter((a) => pedaco.includes(a)).length;
    if (pontos > melhor.pontos) melhor = { pontos, ini };
  }
  // Exige mais que uma palavra solta (o nome da cidade aparece em vários lotes do mesmo município).
  if (melhor.pontos < 3) return null;
  // ÂNCORA = o sinal mais forte dentro da janela (a área; senão a 1ª palavra que casou). O trecho
  // termina na linha do PRIMEIRO lance depois dela (+ a da 2ª praça, se vier colada): estender às
  // cegas trazia o lance do lote SEGUINTE, e a IA teria dois preços para escolher.
  const pedaco = tn.slice(melhor.ini, melhor.ini + janela);
  const posAncora = [...areas, ...palavras].map((w) => pedaco.indexOf(w)).find((i) => i >= 0);
  const ancora = melhor.ini + (posAncora ?? 0);
  // Começo: logo DEPOIS do lance do lote anterior (é a fronteira natural entre itens); sem ele, 700 antes.
  const RE_PRECO = /(?:lance\s+m[ií]nimo|valor\s+m[ií]nimo|[12][ºo°]\s*(?:leil[aã]o|pra[cç]a))[^\n]*/gi;
  const antes = t.slice(Math.max(0, ancora - 2000), ancora);
  const precosAntes = [...antes.matchAll(RE_PRECO)];
  const ultimo = precosAntes[precosAntes.length - 1];
  const ini = ultimo ? Math.max(0, ancora - 2000) + ultimo.index + ultimo[0].length : Math.max(0, ancora - 700);
  const resto = t.slice(ancora);
  const lance = resto.match(/(?:lance\s+m[ií]nimo|valor\s+m[ií]nimo|1[ºo°]\s*(?:leil[aã]o|pra[cç]a))[^\n]*(?:\n[^\n]*2[ºo°]\s*(?:leil[aã]o|pra[cç]a)[^\n]*)?/i);
  const fim = lance ? ancora + lance.index + lance[0].length : ancora + janela + 600;
  return t.slice(ini, fim);
}
