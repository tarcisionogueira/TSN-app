/**
 * Parser puro — FRANCOLEILOES (francoleiloes.com.br). Fonte `dom`, plataforma própria SPA
 * (recon 07/09 e 17/09). A HOME lista os lotes DIRETO, sem catálogo separado (padrão
 * `/lote/<leilao-slug>/<id>/`, confirmado: 48 candidatos batendo esse padrão numa só página) —
 * `<leilao-slug>` se repete entre lotes do mesmo leilão ("leilao-banco-inter" apareceu em pelo
 * menos 7 URLs diferentes na home), então o ID é o `<id>` numérico no final, não o slug.
 *
 * CLOUDFLARE POR SESSÃO, não por IP (17/09) — mesma assinatura já resolvida em JELEILOES e
 * ALBERTOMACEDOLEILOES: a 1ª navegação da sessão (a HOME) sempre passou limpo, com conteúdo
 * real (32 sinais de R$, 48 links de lote reais); só a 2ª+ navegação NA MESMA SESSÃO batia o
 * challenge "Performing security verification". Com `isolarSessao` (contexto novo por
 * página), a página de DETALHE também passou limpo — confirmado com dado real: apartamento em
 * São Paulo/SP, R$6.046.287,22, comissão 5%, endereço completo, matrícula, 6 PDFs. NÃO precisa
 * de Bright Data Scraping Browser nem IP residencial — o achado anterior ("bloqueado") media
 * a 2ª navegação da mesma sessão, não o site.
 *
 * DETALHE (recon 17/09, lote 9728 — Apartamento, São Paulo/SP):
 *   • <title>: "Cidade/UF - Bairro - Tipo com XXXm² <Categoria> em leilão | Franco Leilões";
 *     o MESMO texto aparece solto no corpo (heading), sem o sufixo de categoria/domínio — é
 *     esse trecho solto que vira `titulo`.
 *   • Preço: só "Lance Mínimo: R$ X,XX" (não achei rótulo "Avaliação" separado nesta amostra —
 *     modalidade "Praça Única"; avaliação = mínimo até um recon confirmar 2ª praça em outro
 *     lote — não inventar o que não foi visto).
 *   • Modalidade: NÃO tem rótulo "judicial"/"extrajudicial" no texto do lote — mas o
 *     `<leilao-slug>` da própria URL denuncia (confirmado 2 padrões reais na home:
 *     "leilao-banco-inter" e "leilao-judicial-tjmg") — judicial só quando o slug contém
 *     "judicial", senão extrajudicial (banco/financeira vendendo direto).
 *   • Matrícula: rótulo "Matrícula CNM: 113779" — tem um código entre "Matrícula" e o número
 *     (regex não pode exigir os dois grudados).
 *   • PDFs: `/preview/<uuid>.pdf` e `/download/<uuid>.pdf` são o MESMO documento em duas URLs
 *     (texto do link genérico, "Visualizar"/"Baixar" — não dá pra classificar edital vs.
 *     matrícula pelo texto nem pela URL, UUID opaco). Usa só `/download/` como canônico
 *     (dedup), guarda como anexo genérico — não inventa qual é edital.
 */
import { inferirTipo, extrairArea, proximaData, cidadeUF, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, montarRowDom, fotoDeHtml } from './dom-parse-util.mjs';

export const TENANTS = {
  francoleiloes: { fonte: 'FRANCOLEILOES', leiloeiro: 'Franco Leilões', base: 'https://www.francoleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const urls = new Map();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/lote\/[a-z0-9-]+\/(\d+))\/?["']/gi)) {
    try { urls.set(m[2], new URL(m[1], base).href); } catch { /* skip */ }
  }
  return urls;
}
export const idDaUrl = url => (String(url).match(/\/lote\/[a-z0-9-]+\/(\d+)/i) || [])[1] || null;

// PDFs — só /download/ (canônico); /preview/ é o MESMO documento, descartado de propósito.
function anexosFranco(html, base) {
  const anexos = []; const vistos = new Set();
  for (const m of String(html || '').matchAll(/href=["']([^"']*\/download\/[^"']+\.pdf[^"']*)["']/gi)) {
    let abs; try { abs = new URL(m[1], base).href; } catch { continue; }
    if (vistos.has(abs)) continue;
    vistos.add(abs);
    anexos.push({ tipo: 'outro', nome: 'Documento', url: abs });
  }
  return { anexos, link_edital: null, link_matricula: null, link_foto: fotoDeHtml(html, base) };
}

export function parseDetalhe(html, url) {
  const txt = textoDe(html);

  // Heading solto no corpo: "Cidade/UF - Bairro - Tipo com XXXm²" (o mesmo texto do <title>,
  // sem o sufixo "<Categoria> em leilão | Franco Leilões" que o <title> carrega).
  const mHeading = txt.match(/([A-ZÀ-Ÿ][A-Za-zÀ-ÿ'.\-]+(?:\s+[A-Za-zÀ-ÿ'.\-]+)*\/[A-Z]{2}\s*-\s*[^-]+-\s*[^-]+?com\s*\d+[\d,.]*\s*m[²2])/);
  const titulo = mHeading ? mHeading[1].trim().slice(0, 180) : null;

  const { cidade, estado } = cidadeUF(titulo || '', txt.slice(0, 1500));
  const area = extrairArea(titulo || '', txt.slice(0, 1500));

  const minimoTxt = (txt.match(/Lance\s*M[íi]nimo\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1];
  let minimo = plaus(num(minimoTxt || ''));
  // Sem rótulo de "Avaliação" separado nesta amostra — praça única, avaliação = mínimo.
  // Se um recon futuro achar 2ª praça (2 valores distintos), a diferença fica pra outro dia.
  let avaliacao = minimo;

  // Modalidade pelo SLUG da própria URL (confirmado: "leilao-banco-inter" vs.
  // "leilao-judicial-tjmg" — a página do lote não cita judicial/extrajudicial no corpo).
  const modalidade = /judicial/i.test(url) ? 'judicial' : 'extrajudicial';

  const mat = (txt.match(/matr[íi]cula[^\d]{0,25}([\d.]{3,})/i) || [])[1] || null;
  const docs = anexosFranco(html, url);

  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo,
    modalidade, area_m2: area,
    descricao: null,
    data_leilao: proximaData(txt.slice(0, 3000)),
    numero_matricula: mat, ...docs,
    encerrado: /\b(arrematado|vendido|deserto|cancelad[oa]|encerrad[oa]|suspens[oa])\b/i.test(txt.slice(0, 2000)),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
