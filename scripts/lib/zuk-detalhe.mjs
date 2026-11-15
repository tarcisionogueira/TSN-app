/**
 * ZUK — "card" a partir da PÁGINA DO LOTE (15/11, pedido do dono: coletar os lotes do mapa que a lista não traz).
 *
 * A listagem do ZUK embute o mapa com o acervo inteiro (`{"il":<leilão>,"ilo":<lote>}` — 1.124 em 15/11), mas a lista
 * de cards do "Carregar mais" para antes (429): 64 lotes do mapa NUNCA tinham sido coletados, e os que caem fora da
 * lista num dia ficam sem releitura. `/imovel/<il>-<ilo>` abre o lote sem o resto do slug. Esta função devolve o MESMO
 * formato que o coletor lê de cada `.card-property` ({ href, title, tipo, ocup, img, valores }), para o lote seguir
 * exatamente o mesmo caminho (mapeamento, fração ideal, datas, editais, gravação).
 *
 * Entrada: o que a página mostra — `canonical` (URL completa: /imovel/<uf>/<cidade>/<bairro>/<rua>/<il>-<ilo>, de onde
 * o mapeamento tira UF e cidade), `tituloPagina` ("Leilão de Apartamento Duplex - Mossunguê - Curitiba/PR cod: 239033
 * | Zuk"), `ogImage` e `texto` = innerText JÁ SEM a vitrine de outros lotes (cortarOutrosLotes). Valores só de rótulos
 * do PRÓPRIO lote (praças, lance inicial, avaliação, "Em leilão pelo valor de"): R$ solto no texto pode ser taxa,
 * comissão ou parcela. Sem valor nenhum → null (o mapeamento também descarta card sem valor).
 */
const BRL = 'R\\$\\s*([\\d.]+,\\d{2})';
const ROTULOS = [
  new RegExp(`[12]\\s*[ºo°]\\s*Leil[aã]o[^R]{0,60}${BRL}`, 'gi'),
  new RegExp(`Leil[aã]o\\s+[ÚU]nico[^R]{0,60}${BRL}`, 'gi'),
  new RegExp(`Lance\\s+(?:inicial|m[íi]nimo)[^R]{0,60}${BRL}`, 'gi'),
  new RegExp(`Em\\s+leil[aã]o\\s+pelo\\s+valor\\s+de\\s*${BRL}`, 'gi'),
  new RegExp(`(?:Valor\\s+de\\s+)?Avalia[çc][ãa]o[^R]{0,40}${BRL}`, 'gi'),
];

export function cardDoDetalheZuk({ canonical, tituloPagina, ogImage, texto } = {}) {
  const href = String(canonical || '').split('?')[0];
  if (!/\/imovel\/[a-z]{2}\/[^/]+\/.+\/\d+-\d+\/?$/i.test(href)) return null;   // sem URL canônica não há UF/cidade
  const t = String(texto || '').replace(/\s+/g, ' ');
  const valores = [];
  for (const re of ROTULOS) for (const m of t.matchAll(re)) valores.push(`R$ ${m[1]}`);
  if (!valores.length) return null;
  const base = String(tituloPagina || '').replace(/\s*\|\s*Zuk\s*$/i, '').replace(/\s*cod:\s*\d+\s*$/i, '')
    .replace(/^Leil[aã]o\s+de\s+/i, '').trim();
  const tipo = (base.split(/\s+-\s+/)[0] || '').trim();
  // O card judicial do ZUK não diz "judicial": diz o comitente ("Tribunal de Justiça do Estado de São Paulo"). O
  // mapeamento decide a modalidade pelo `title` — o comitente vai junto quando a página o mostra.
  const comitente = (t.match(/Tribunal\s+de\s+Justi[çc]a[^.|]{0,60}|\d+\s*ª?\s*Vara\s+[^.|]{0,60}/i) || [])[0];
  const ocup = (t.match(/Im[óo]vel\s+(?:des)?ocupado/i) || [])[0] || '';
  return {
    href,
    title: comitente ? `${base} - ${comitente.trim()}` : base,
    tipo,
    addr: '',
    ocup,
    img: ogImage || null,
    valores,
  };
}
