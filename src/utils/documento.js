/**
 * O QUE É UM DOCUMENTO — definição ÚNICA, para as telas não divergirem entre si.
 *
 * Achado em 18/08: `ehDocArquivo` existia copiado em `ImovelDetalhe.jsx` e em
 * `Analise.jsx`, e a `Busca.jsx` — que não tinha cópia nenhuma — decidia o selo
 * "📄 Edital" só por `/^https?:\/\//`. Resultado medido no acervo vivo: 2.170 lotes
 * ativos exibiam o selo de edital e 337 o de matrícula SEM ter arquivo algum, nem no
 * link, nem nos anexos do leiloeiro, nem no nosso Storage. A ficha de detalhe estava
 * certa o tempo todo (lá o botão só vira "Edital" quando é ARQUIVO); quem prometia era
 * a lista, e o cliente só descobria depois de clicar. É a forma da casa — ausência
 * entregue como presença — e ela entrou justamente pela tela que não tinha a cópia.
 *
 * Por isso a regra mora aqui, uma vez só: `src/lib/senha.js` resolveu o mesmo problema
 * para a senha (regex copiada em cinco lugares, o conserto aplicado em um).
 */

// URL de verdade — o scraper da Caixa às vezes grava RÓTULO no campo de link
// ("Venda Direta Online", "Leilão SFI - Edital Único").
export const ehUrl = (v) => typeof v === 'string' && /^https?:\/\//i.test(v.trim());

/**
 * Documento REAL = ARQUIVO (PDF, com ou sem querystring) ou objeto no NOSSO Storage.
 * Uma PÁGINA (matricula.asp, detalhe-imovel.asp, /imoveis/…, /lote/123/) NÃO é
 * documento: `link_edital = url_lote` é o padrão de quase todos os leiloeiros
 * (SUPERBID, GRUPOLANCE, BIASI, SOLD, VIP, SODRE…), então tratar link como documento
 * promete um arquivo em ~14 mil lotes e entrega a página do anúncio.
 */
export const ehDocArquivo = (v) => ehUrl(v)
  && (/\.pdf(\?|#|$)/i.test(v.trim()) || /\/storage\/v1\/object\/(sign|public)\//i.test(v));

/**
 * Matrícula: além de ser arquivo, não pode ser o `matricula.asp` da Caixa — aquela
 * rota dá 404, e o PDF verdadeiro é montado por `caixaMatriculaUrl`.
 */
export const ehMatriculaValida = (v) => ehDocArquivo(v) && !/matricula\.asp/i.test(v);

/**
 * "Regras de venda" só é DOCUMENTO quando não é a própria página do anúncio no portal
 * (detalhe-imovel.asp da Caixa = mesmo destino do `url_lote`, já coberto por
 * "Ver no portal"). Senão o botão abre um site, não um arquivo.
 */
export const ehRegrasDoc = (v, urlLote) => ehUrl(v)
  && !/detalhe-imovel\.asp/i.test(v) && v.trim() !== (urlLote || '').trim();
