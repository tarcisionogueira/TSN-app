/**
 * Parser puro — GLOBOLEILOES (globoleiloes.com.br). Fonte `dom`, custo Bright Data ZERO.
 *
 * ⚠️ REESCRITO 17/09 — o site migrou pra uma SPA Inertia.js (Laravel+Inertia+React) em algum
 * momento entre 07/09 (recon original, artigo <article> na home) e agora, e AINDA ganhou
 * Cloudflare no caminho (07/09 dizia "SEM Cloudflare"). Confirmado real (dump via IP
 * RESIDENCIAL — Cloudflare bloqueia datacenter/Bright Data Web Unlocker nos dois, mas passa
 * de casa, mesmo remédio de RJ/GESTAO/PECINI/HASTA):
 *
 *   - URL DE LOTE não mudou: `/leiloes/lote-<n>-<slug>/<id>` — o mesmo padrão de antes,
 *     confirmado nos 4 lotes reais vistos na página `/leiloes` (dump 17/09). O que quebrava
 *     não era a URL, era o Cloudflare impedindo QUALQUER html de chegar.
 *   - RÓTULOS do texto renderizado mudaram: antes "Valor de avaliação atualizado: R$ X" numa
 *     frase só; agora vem em DUAS linhas — "VALOR DE AVALIAÇÃO\nR$ X (avaliação de MÊS/ANO)."
 *     seguido de "Valor atualizado: R$ Y (MÊS/ANO), sujeito a nova atualização pelo índice do
 *     TJ/SP...". É o `Y` (valor atualizado) que a regra de 2ª praça referencia ("lance igual
 *     ou superior a 50% do valor da avaliação atualizado") — mesmo símbolo do badge "50% de
 *     desconto" já capturado por `descPct`.
 *   - TÍTULO/cidade/bairro/tipo/área vêm numa linha só, ANTES do texto de avaliação:
 *     "SP - Sorocaba - Altos de Ipanema | Apartamento - 49m²".
 *   - PDFs migraram pra CDN própria (`d1etsb4iun2r36.cloudfront.net`), nome do arquivo
 *     classifica o tipo: `matricula-*`, `penhora-*`/`debito-*` (ônus), `avaliacao-*` (laudo) e
 *     um sem prefixo óbvio contendo `-cond-` (= "condições", o equivalente ao edital).
 *     `anexosDeHtml` (dom-parse-util) só reconhece a palavra "edital" no nome — o PDF de
 *     condições daqui não bate nisso, por isso o pós-processamento abaixo promove o `-cond-`
 *     a edital quando nenhum "edital" literal foi achado.
 *   - Fotos: `<img>` reais em `d1etsb4iun2r36.cloudfront.net/.../images/intern_N-*.webp`;
 *     `fotoDeHtml` (RE_IMG_DESCARTA) já filtra os dois logos do topo (`positive_logo.webp`/
 *     `negative_logo.webp`) sem precisar de lista nova.
 *
 * NÃO PRECISA DE BRIGHT DATA NEM CÓDIGO NOVO NO MOTOR: o fetch já é `dom` (Puppeteer puro,
 * scripts/lib/motor/runner.mjs → criarMotorDom) — rodando do runner RESIDENCIAL (mesmo
 * scripts/runner-residencial.sh que já resolve RJ/GESTAO/PECINI/HASTA), o Cloudflare nem
 * aparece. Rodar `node scripts/scraper-globo.mjs` de lá deve bastar; da CI (datacenter)
 * continua bloqueado.
 */
import { inferirTipo, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import {
  plaus, textoDe, textoComLinhas, valorPorRotulo, cidadeUFDeSlug, cidadeUFBare,
  montarRowDom, anexosDeHtml,
} from './dom-parse-util.mjs';

export const TENANTS = {
  globo: { fonte: 'GLOBOLEILOES', leiloeiro: 'Globo Leilões', base: 'https://globoleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/leiloes\/lote-\d+-[a-z0-9-]+\/(\d+))\/?["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/leiloes\/lote-\d+-[a-z0-9-]+\/(\d+)/i) || [])[1] || null;

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const linhas = textoComLinhas(html).split('\n');

  // "SP - Sorocaba - Altos de Ipanema | Apartamento - 49m²" — UF/cidade/bairro/tipo/área
  // numa linha só, sempre antes do bloco de avaliação. Achado real (dump 17/09).
  const reLinhaTitulo = /^([A-Z]{2})\s*-\s*([^-]+?)\s*-\s*([^|]+)\|\s*([^-]+?)\s*-\s*(\d+(?:[.,]\d+)?)\s*m/;
  const linhaTitulo = linhas.find((l) => reLinhaTitulo.test(l.trim()));
  const mTit = linhaTitulo ? linhaTitulo.trim().match(reLinhaTitulo) : null;

  const slug = (String(url).match(/\/leiloes\/lote-\d+-([a-z0-9-]+)\/\d+/i) || [])[1] || '';
  const doSlug = cidadeUFDeSlug(slug);
  const cidade = mTit ? mTit[2].trim() : (doSlug.cidade || cidadeUFBare(txt).cidade);
  const estado = mTit ? mTit[1] : (doSlug.estado || cidadeUFBare(txt).estado);
  const tipo = mTit ? mTit[4].trim() : null;
  const areaM2 = mTit ? Number(mTit[5].replace(',', '.')) : 0;
  const titulo = linhaTitulo ? linhaTitulo.trim().slice(0, 180) : null;

  // Avaliação: o VALOR ATUALIZADO é o que a regra de 2ª praça referencia ("lance >= 50% do
  // valor da avaliação atualizado") — preferido sobre o valor original de quando foi avaliado.
  const avalOriginal = valorPorRotulo(txt, /VALOR\s+DE\s+AVALIA[ÇC][ÃA]O/i);
  const avalAtualizado = valorPorRotulo(txt, /Valor\s+atualizado/i);
  const avaliacao = avalAtualizado || avalOriginal;

  // Desconto anunciado (badge "50% de desconto" OU a regra "X% do valor da avaliação" no
  // corpo) — regra do PRÓPRIO leiloeiro pra 2ª praça, não invenção do parser.
  const descPct = Number((txt.match(/(\d{1,3})\s*%\s*(?:de\s+desconto|do\s+valor\s+da\s+avalia)/i) || [])[1] || 0);
  const minimo = (avaliacao && descPct > 0 && descPct < 100) ? Math.round(avaliacao * (1 - descPct / 100) * 100) / 100 : avaliacao;

  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : 'judicial';
  const mat = (txt.match(/matr[íi]cula\s*:?\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;

  const docs = anexosDeHtml(html, url);
  // O PDF de "condições" (equivalente ao edital) vem nomeado com "-cond-", não "edital" — o
  // classificador genérico de anexosDeHtml não reconhece isso. Promove só quando NENHUM
  // "edital" literal foi achado, pra não sobrescrever um caso onde o site usa o nome certo.
  if (!docs.link_edital) {
    const cond = docs.anexos.find((a) => /-cond-/i.test(a.url));
    if (cond) { cond.tipo = 'edital'; cond.nome = 'Edital'; docs.link_edital = cond.url; }
  }

  return {
    titulo, cidade, estado,
    valor_avaliacao: plaus(avaliacao), valor_minimo: plaus(minimo) || plaus(avaliacao),
    modalidade, area_m2: areaM2,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 4000)),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
