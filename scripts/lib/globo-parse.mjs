/**
 * Parser puro — GLOBOLEILOES (globoleiloes.com.br). Fonte `dom`. ⚠️ NÃO INTEGRADO (07/09) —
 * mantido só como registro do que já foi descartado, pra não repetir a investigação.
 *
 * Recon original (antes deste parser) viu 27 <article> com URL de lote real
 * (`/leiloes/lote-<n>-<slug>/<id>`) e um detalhe real (lote 2623, Guaratinguetá/SP —
 * "Lote 1 - SP - Guaratinguetá..." · badge "50% de desconto" = regra da 2ª praça, não evento
 * pontual · PDFs reais em CloudFront). Parser escrito em cima disso, validado localmente.
 *
 * **Toda rodada real (3 independentes: embutida na sequência de 9 fontes, isolada via
 * dispatch, e duas rodadas de dump dedicado) deu 0 lotes — o site MUDOU DE PLATAFORMA entre
 * o recon e agora.** Dump confirmou: HTML real e completo (396KB, domínio certo pelo
 * Facebook Pixel, sem bloqueio/captcha) mas **zero** ocorrência de "/leiloes/lote-" no
 * documento inteiro; varredura de TODOS os 44 hrefs internos não achou nenhum com "lote" no
 * path — são só bundles `/build/assets/*.js` do Vite, incluindo `inertia-vendor-*.js`. **O
 * site virou uma SPA Inertia.js (Laravel+Inertia+React)**: os lotes não existem mais como
 * `<a href>` no HTML — Inertia entrega os dados como JSON embutido num `data-page="{...}"` no
 * div raiz, e o React monta os links no cliente a partir daí. Recon/parser NOVOS, mirando o
 * payload JSON (não mais regex de href), são necessários — não é ajuste de regex, é reconstruir
 * do zero. Fora do cron de produção até isso ser feito.
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, textoComLinhas, montarRowDom } from './dom-parse-util.mjs';

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

function anexosGlobo(html, urlBase) {
  const anexos = []; let link_edital = null, link_matricula = null;
  for (const m of String(html || '').matchAll(/<a\b[^>]*href=["']([^"']+\.pdf[^"']*)["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    let abs; try { abs = new URL(m[1], urlBase).href; } catch { continue; }
    if (anexos.some((a) => a.url === abs)) continue;
    const texto = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const tipo = /matr[íi]cula/i.test(texto) ? 'matricula' : /edital/i.test(texto) ? 'edital' : 'outro';
    anexos.push({ tipo, nome: tipo === 'edital' ? 'Edital' : tipo === 'matricula' ? 'Matrícula / Laudo do bem' : 'Documento', url: abs });
    if (tipo === 'edital' && !link_edital) link_edital = abs;
    if (tipo === 'matricula' && !link_matricula) link_matricula = abs;
  }
  return { anexos, link_edital, link_matricula };
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);
  const linhas = textoComLinhas(html).split('\n');

  const avaliacao = plaus(num((txt.match(/Valor\s+de\s+avalia[çc][ãa]o\s+atualizado\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  // Desconto anunciado (badge "50% de desconto" OU a regra "X% do valor da avaliação" no
  // corpo) — regra do PRÓPRIO leiloeiro pra 2ª praça, não invenção do parser.
  const descPct = Number((txt.match(/(\d{1,3})\s*%\s*(?:de\s+desconto|do\s+valor\s+da\s+avalia)/i) || [])[1] || 0);
  const minimo = (avaliacao && descPct > 0 && descPct < 100) ? Math.round(avaliacao * (1 - descPct / 100) * 100) / 100 : avaliacao;

  const linhaLote = linhas.find((l) => /^Lote\s+\d+\s*-/i.test(l)) || '';
  const titulo = linhaLote ? linhaLote.replace(/\s*\|\s*/g, ' — ').slice(0, 180) : null;

  const cUf = txt.match(/\b([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+(?:\s[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+){0,2})\/([A-Z]{2})\b(?=[^]{0,60}Cart[óo]rio|[^]{0,10}$)/) || txt.match(/\b([A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+(?:\s[A-ZÀ-Ÿ][A-Za-zÀ-ÿ]+){0,2})\/([A-Z]{2})\b/);
  const cidade = cUf ? cUf[1] : null;
  const estado = cUf ? cUf[2] : null;

  const area = extrairArea(titulo || '', txt.slice(0, 2000));
  const modalidade = /extrajudicial/i.test(txt) ? 'extrajudicial' : /judicial|processo\s*n/i.test(txt) ? 'judicial' : 'judicial';
  const mat = (txt.match(/matr[íi]cula\s*:?\s*(?:n[º°.]?\s*)?([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosGlobo(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 4000)),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
