/**
 * Parser puro — família "leilao/index" (07/09). Recon via GitHub Actions confirmou a MESMA
 * plataforma em RIGOLONLEILOES e GIORDANOLEILOES: fingerprint idêntico — bucket S3
 * `906de634c48fb7d34136160b4c353ae4`, mesmos paths `/leilao/index/veiculos|imoveis
 * |equipamentos|semoventes|judicial`, mesmo padrão de URL de lote
 * `/leilao/index/leilao_id/<id>/lote/<id2>` (`/imoveis` puro dá HTTP 400 "Erro no Sistema" —
 * página de erro da própria aplicação, não bloqueio). THAISTEIXEIRA usa o MESMO bucket S3
 * (confirmado) mas `/leilao/index/imoveis` renderizou vazio no recon (só chrome do site) —
 * entra na configuração pela evidência de plataforma, mas pode enumerar zero até um recon
 * mais fundo explicar o motivo (ver HANDOFF 07/09 · PARTE 6/7).
 *
 * DETALHE (Rigolon, lote 211554) é RÓTULO SOLTO, não tabela:
 *   "Barracões - Terreno c/ 80.795,95m² - Ribeirão Preto/SP
 *    Avaliação: R$ 54.634.772,50
 *    Lance mínimo: R$ 27.317.386,25"
 * Sem slug na URL (só IDs numéricos) — título/tipo/área/cidade/UF vêm todos da 1ª linha do
 * texto renderizado, por isso o parser precisa de `textoComLinhas` (preserva quebra de linha;
 * `textoDe` colapsaria tudo num espaço só e destruiria essa estrutura).
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { valorPorRotulo, textoDe, textoComLinhas, anexosDeHtml, montarRowDom } from './dom-parse-util.mjs';

export const TENANTS = {
  rigolon: { fonte: 'RIGOLONLEILOES', leiloeiro: 'Rigolon Leilões', base: 'https://rigolonleiloes.com.br' },
  giordano: { fonte: 'GIORDANOLEILOES', leiloeiro: 'Giordano Leilões', base: 'https://giordanoleiloes.com.br' },
  // Mesma plataforma por fingerprint (bucket S3), catálogo ainda não confirmado renderizando
  // lotes — ver observação acima. Fica dentro pra herdar a coleta automaticamente se/quando
  // resolver; "fonteVazia" é tratado pelo runner como estado válido, não como erro.
  thaisteixeira: { fonte: 'THAISTEIXEIRA', leiloeiro: 'Thaís Teixeira Leilões', base: 'https://thaisteixeiraleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/leilao\/index\/leilao_id\/\d+\/lote\/(\d+))["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

// "Tipo do bem - descrição curta com área - Cidade/UF" — a 1ª linha do texto renderizado que
// bater nesse formato. Varre só as primeiras linhas (o resto é edital/matrícula/menu).
function primeiraLinhaInfo(linhas) {
  for (const l of linhas.slice(0, 6)) {
    const m = l.match(/^(.+?)\s-\s(.+?)\s-\s([A-ZÀ-Ÿ][A-Za-zÀ-ÿ '.-]+?)\/([A-Z]{2})$/);
    if (m) return { tipoBem: m[1].trim(), descCurta: m[2].trim(), cidade: m[3].trim(), estado: m[4] };
  }
  return null;
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const linhas = textoComLinhas(html).split('\n');
  const info = primeiraLinhaInfo(linhas);

  let avaliacao = valorPorRotulo(txt, /Avalia[çc][ãa]o/i);
  let minimo = valorPorRotulo(txt, /Lance\s*m[íi]nimo/i);
  if (!minimo) minimo = avaliacao;
  if (!avaliacao) avaliacao = minimo;

  const titulo = info
    ? `${info.tipoBem} - ${info.descCurta} - ${info.cidade}/${info.estado}`.slice(0, 180)
    : null;
  const area = extrairArea(info?.descCurta || '', txt.slice(0, 500));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : /judicial/i.test(txt) ? 'judicial' : 'extrajudicial';
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosDeHtml(html, url);

  return {
    titulo, cidade: info?.cidade || null, estado: info?.estado || null,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: info?.descCurta ? info.descCurta.slice(0, 500) : null,
    data_leilao: proximaData(txt.slice(0, 3000)),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
