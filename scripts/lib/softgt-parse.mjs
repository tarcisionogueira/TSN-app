/**
 * Parser puro — plataforma SoftGT ("SoftGT Informatica", meta author) — FLEX LEILÕES e LUIZ CARVALHO
 * LEILÕES (22/10, triagem #292). Site PHP com HTML pronto do servidor (sem Cloudflare; grátis).
 *
 * ESTRUTURA (medida pelo banco em 22/10, não suposta):
 *   • catálogo: Flex `/imoveis/` (cards com cidade/UF, tipo|área, praça, lance) · Luiz `/` (home lista os
 *     leilões). Os dois linkam o LEILÃO: Flex `lotes/<leilão>`, Luiz `leiloes/<leilão>`.
 *   • leilão: lista os lotes por `tela_lance(<leilão>, <ordem>)` (Flex) ou `detalhe-lote/<leilão>/<ordem>` (Luiz),
 *     e traz o EDITAL em PDF (`arquivos/<…>.pdf`, âncora "Edital").
 *   • lote: `/detalhe-lote/<leilão>/<ordem>/` — título no <h2>, fotos em `arquivos/*.jpg`, e o texto:
 *       Flex: "Data do Leilão: 22/10/2026", "Lance Inicial: R$ 21.000,00", "Avaliação R$ 42..000,00" (sic),
 *             "objeto da matrícula n.36.761", 1º/2º Hasta com datas e "Lance Mínimo".
 *       Luiz: "Lance Inicial: R$ - 3.657.541,28", "AVALIAÇÃO : R$ 7.315.082,55", "MATRÍCULA : 111620",
 *             "ENDEREÇO DO BEM: … - Aparecida De Goiânia/GO", "DESCRIÇÃO DO BEM: …".
 */
import { inferirTipo, extrairArea, proximaData, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, montarRowDom, cidadeUFBare, RE_IMG_DESCARTA } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const TENANTS = {
  flex: { fonte: 'FLEXLEILOES', leiloeiro: 'Flex Leilões', base: 'https://www.flexleiloes.com.br', catalogo: '/imoveis/' },
  luiz: { fonte: 'LUIZCARVALHO', leiloeiro: 'Luiz Carvalho Leilões', base: 'https://www.luizleiloes.com.br', catalogo: '/' },
  // 26/10 (3ª leva das Juntas, triagem `junta_2410`): home → leilões → detalhe-lote lidos pelo banco e passados no motor
  // em seco. FORA com a home sem leilão hoje: araujoleiloes (MT), dalcanaleleiloes e lelialenz (PR).
  vz: { fonte: 'VZLEILOES', leiloeiro: 'VZ Leilões', base: 'https://vzleiloes.com.br', catalogo: '/' }, // 5 leilões, GO/DF/MG
  // rmmleiloes.com.br (PR) fica FORA: o único leilão (8 terrenos, TRT Umuarama) é HOJE, 26/10, e nenhum lote sai com
  // cidade/UF ("situado na cidade de Mariluz-PR" fica no corpo, que o parser não lê) — entra com uma linha no próximo.
  // pbcastro.com.br (PR) fica FORA: 21 leilões de 1 lote cada, mas o detalhe deste tenant sai sem data de praça em todos,
  // com cidade em 2 de 11 e com moto/carro (Honda CG 160, Kia Sportage, Fiat Uno) passando como imóvel — pede ajuste do
  // parser antes de entrar.
};

/** Catálogo → leilões (nível 2 do motor). */
export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href=["']?\/?((?:lotes|leiloes)\/(\d+))\/?(?=["'\s>])/gi)) {
    try { out.set(m[2], new URL(`/${m[1]}`, base).href); } catch { /* url inválida: ignora */ }
  }
  return out;
}

/** Leilão → lotes (`tela_lance(L, O)` ou link direto `detalhe-lote/L/O`). */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  const h = String(html || '');
  for (const m of [...h.matchAll(/tela_lance\(\s*(\d+)\s*,\s*(\d+)\s*\)/g), ...h.matchAll(/detalhe-lote\/(\d+)\/(\d+)/g)]) {
    out.set(`${m[1]}_${m[2]}`, new URL(`/detalhe-lote/${m[1]}/${m[2]}/`, base).href);
  }
  return out;
}
export const idDaUrl = (url) => { const m = String(url).match(/detalhe-lote\/(\d+)\/(\d+)/); return m ? `${m[1]}_${m[2]}` : null; };

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
// "R$ - 3.657.541,28" (Luiz) e "R$ 42..000,00" (Flex, digitação do leiloeiro): o `num` tira os pontos.
const valor = (txt, rot) => plaus(num((txt.match(new RegExp(rot.source + String.raw`[^R\d]{0,40}R\$\s*-?\s*([\d.]+,\d{2})`, 'i')) || [])[1]));
const dataBr = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/\s*(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

function cidadeUf(...textos) {
  for (const t of textos) {
    const ms = [...String(t || '').matchAll(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' .]{1,40}?)\s*\/\s*([A-Z]{2})\b/g)];
    const m = ms[ms.length - 1];
    if (m) return { cidade: titleCase(m[1].replace(/^.*\s-\s/, '').replace(/^.*\s(?:em|no|na|,)\s+/i, '').replace(/^.*,\s*/, '').trim()), estado: m[2] };
  }
  return { cidade: null, estado: null };
}

export function parseDetalhe(html, url) {
  const h = String(html || '');
  // Os caminhos do site (`arquivos/…`) são relativos à RAIZ (`<base href>` na Luiz) — contra a URL do lote
  // virariam /detalhe-lote/2982/1/arquivos/… (404).
  const raiz = `${new URL(url).origin}/`;
  const txt = decodificarEntidades(textoDe(h));
  // Flex: o título do lote é o <h2 class="texto-titulo3">; antes dele vem o menu ("Leilões Finalizados") e depois
  // um carrossel com os <h2> de OUTROS lotes (medido no 2940/1). Luiz: o <h2> perto de "LOTE 001".
  const proprio = limpo((h.match(/<h2[^>]*class=["'][^"']*texto-titulo3[^"']*["'][^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
  const titulos = [...h.matchAll(/<h2[^>]*>([\s\S]*?)<\/h2>/gi)].map((m) => limpo(m[1]))
    .filter((t) => t && !/^LOTE\s+\d/i.test(t) && !/^(?:Leil[õo]es\b|Acesso R[áa]pido|Localiza[çc][ãa]o|Informativo|Contato)/i.test(t));
  const titulo = (proprio || titulos[0] || '').replace(/^[\s\-–]+/, '').replace(/\s*CEP\s*:?\s*[\d.\-]+\s*$/i, '').slice(0, 180) || null;
  const endereco = (txt.match(/ENDERE[ÇC]O DO BEM\s*:\s*(.{5,200}?)(?:CEP|DESCRI[ÇC][ÃA]O|$)/i) || [])[1] || '';
  const { cidade, estado } = cidadeUf(titulo, endereco).cidade ? cidadeUf(titulo, endereco) : cidadeUFBare(`${titulo || ''} ${endereco}`);

  const avaliacao = valor(txt, /Avalia[çc][ãa]o\s*:?/);
  const minimo = valor(txt, /Lance\s+Inicial\s*:?/) || valor(txt, /Lance\s+M[íi]nimo[^:R]{0,60}:?/) || valor(txt, /Valor\s+M[íi]nimo\s+de\s+Venda\s*:?/);
  // 2ª praça: o "Lance Mínimo" depois de "2° Hasta"/"2º Leilão".
  const seg = txt.match(/2\s*[°º]\s*(?:Hasta|Leil[ãa]o|Pra[çc]a)[\s\S]{0,300}?Encerramento\s+em\s*:?\s*(\d{2}\/\d{2}\/\s*\d{4})/i);
  const data = dataBr((txt.match(/Data do Leil[ãa]o\s*:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]) || proximaData(txt.slice(0, 6000));
  const descricao = ((txt.match(/DESCRI[ÇC][ÃA]O DO BEM\s*:\s*([\s\S]{20,2500}?)(?:Valor M[íi]nimo de Venda|Em caso de diverg|LOTE \d{3}\b|$)/i) || [])[1] || '').trim() || null;
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const status = limpo((h.match(/id=["']status["'][^>]*>([\s\S]{0,120}?)<\/span>/i) || [])[1] || '');

  // Documentos: PDF/DOC em `arquivos/`; a âncora "Edital" diz o que é (o nome do arquivo é número).
  const anexos = [];
  for (const m of h.matchAll(/<a\b[^>]*href=["']([^"']+\.(?:pdf|docx?))["'][^>]*>([\s\S]{0,80}?)<\/a>/gi)) {
    let u; try { u = new URL(m[1], raiz).href; } catch { continue; }
    if (anexos.some((a) => a.url === u)) continue;
    const rot = limpo(m[2]);
    const tipo = /edital/i.test(rot) ? 'edital' : /matr[íi]cula/i.test(rot) ? 'matricula' : /laudo|avalia/i.test(rot) ? 'laudo' : 'outro';
    anexos.push({ tipo, nome: rot || 'Documento', url: u });
  }
  const fotos = [...new Set([...h.matchAll(/(?:src|href)=["']?([^"'\s>]*arquivos\/[^"'\s>]+\.(?:jpe?g|png|webp))/gi)].map((m) => m[1]))]
    .filter((s) => !RE_IMG_DESCARTA.test(s)).map((s) => { try { return new URL(s, raiz).href; } catch { return null; } }).filter(Boolean);

  return {
    titulo: titulo ? titleCase(titulo).replace(/\/([a-z]{2})\b/g, (_, uf) => `/${uf.toUpperCase()}`) : null, cidade, estado,
    valor_avaliacao: avaliacao || minimo, valor_minimo: minimo || avaliacao,
    modalidade: /extrajudicial/i.test(txt) ? 'extrajudicial' : /processo|vara|hasta|penhor/i.test(txt) ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(titulo || '', `${descricao || ''} ${txt.slice(0, 1500)}`),
    descricao, data_leilao: data, data_leilao_2: seg ? dataBr(seg[1]) : null,
    numero_matricula: mat, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: fotos[0] || null,
    encerrado: /arrematad|vendid|encerrad|cancelad|suspens|retirad/i.test(status),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
