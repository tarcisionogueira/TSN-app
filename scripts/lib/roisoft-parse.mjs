/**
 * Parser puro — plataforma ROISOFT ("Roisoft - Softwares Web", rodapé www.roisoft.com.br). 8 leiloeiros da triagem de
 * 26/10 (leiloeiro_triagem.plataforma = 'ROISOFT'). O banco (pg_net, IP da AWS) leva 403 em todos; o runner do GitHub
 * abre com fetch puro (medido pelo recon grátis em 26/10) — o coletor roda no GitHub, sem PC do dono.
 *
 * ESTRUTURA (medida em 26/10):
 *   • CATÁLOGO de imóveis: POST `/lotes/listar-imoveis-dados` (formulário: pagina=N, LET_ID=2 …) → JSON
 *     { total, dados: <html dos lotes>, parametrosBusca: { porPagina: 20 } }. Dois moldes de `dados`: tabela
 *     (`<tr rel="…" data-rowid="191542">`, Leilões Brasil) e cards (`js_lote" data-rowid="7367"`, Caiapó).
 *   • LOTE: GET `/imoveis/lote/<rowid>` — og:description = título ("M-2803 - ARAGUACU/TO - MISTO - …"), og:image,
 *     "Descrição Detalhada", valores em "Valor 1º L: R$ … / Valor 2º L: R$ …" (Leilões Brasil) ou "Lance Mínimo: R$ …"
 *     (Caiapó), praça "1º Leilão 26/10/2026 - 09h00" e "Encerramento: 29/10/2026 14:10", status em `#pregao-detalhe`.
 *   • norteleiloes.com.br saiu do molde (front Next.js novo, sem o endpoint) — fora até ser medido de novo.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, montarRowDom, cidadeUFBare, RE_IMG_DESCARTA } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';
import MUNICIPIOS from '../../api/_municipios.js';
import { normCidade } from './inferir-uf.mjs';

const t = (fonte, leiloeiro, dominio) => ({ fonte, leiloeiro, base: `https://www.${dominio}`, catalogo: '/lotes/listar-imoveis-dados' });
// `fonte` única (conferida contra imoveis_leilao e o código em 26/10).
export const TENANTS = {
  caiapo: t('CAIAPO', 'Caiapó Leilões', 'caiapoleiloes.com.br'),
  eduardo: t('LEILOEIROEDUARDO', 'Leiloeiro Eduardo', 'leiloeiroeduardo.com.br'),
  leiloesbrasil: t('LEILOESBRASIL', 'Leilões Brasil', 'leiloesbrasil.com.br'),
  lira: t('LIRALEILOES', 'Lira Leilões', 'liraleiloes.com.br'),
  teleselima: t('TELESELIMA', 'Teles & Lima Leilões', 'teleselimaleiloes.com.br'),
  triade: t('TRIADELEILOES', 'Tríade Leilões', 'triadeleiloes.com.br'),
  ubaldo: t('UBALDOLEILOES', 'Ubaldo Leilões', 'ubaldoleiloes.com.br'),
};

/** JSON do catálogo → { total, porPagina, dados }; null se não for o JSON da plataforma. */
export function lerCatalogo(texto) {
  let j; try { j = JSON.parse(texto); } catch { return null; } // padrao-ok: corpo que não é JSON = não é o endpoint; o transporte registra o motivo
  if (!j || typeof j.dados !== 'string') return null;
  return { total: Number(j.total) || 0, porPagina: Number(j.parametrosBusca?.porPagina) || 20, dados: j.dados };
}

/** HTML dos lotes (uma ou várias páginas concatenadas) → Map rowid → url do lote. */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/\bdata-rowid=["'](\d+)["']/g)) out.set(m[1], `${base}/imoveis/lote/${m[1]}`);
  return out;
}
export const idDaUrl = (url) => (String(url).match(/\/lote\/(\d+)/) || [])[1] || null;

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>|<\/p>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
const dataBr = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };
const ehMun = (c, uf) => !!c && !!uf && Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`);

// "ARAGUACU/TO", "PARANATINGA/MT", "ARAGUACU - TO" — cidade sem acento no título da plataforma; só vale no IBGE.
function cidadeUf(...textos) {
  for (const s of textos) {
    for (const x of String(s || '').matchAll(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' ]{1,40}?)\s*(?:\/|\s-\s)\s*([A-Z]{2})\b/g)) {
      const pal = x[1].trim().split(/\s+/);
      for (let k = 0; k < pal.length; k++) { const c = pal.slice(k).join(' '); if (ehMun(c, x[2])) return { cidade: titleCase(c), estado: x[2] }; }
    }
  }
  const b = cidadeUFBare(textos.join(' '));
  return ehMun(b.cidade, b.estado) ? b : { cidade: null, estado: null };
}

export const RE_ENCERRADO = /vendid|arrematad|encerrad|cancelad|suspens|retirad|sustad|n[ãa]o vendid|sem licitante|condicional/i;

export function parseDetalhe(html, url) {
  const h = String(html || '');
  if (!/Detalhe do lote|lot-info-auction/i.test(h)) return null;
  const og = (p) => decodificarEntidades((h.match(new RegExp(`<meta\\s+(?:name|property)=["']og:${p}["']\\s+content=["']([^"']*)["']`, 'i')) || [])[1] || '').trim();
  const txt = decodificarEntidades(textoDe(h)).replace(/\s+/g, ' ');
  const tituloOg = og('description').replace(/^(?:M-?\s*)?[\w.-]*\d[\w.-]*\s+-\s+/, '').trim();
  const descDet = limpo((h.match(/Descri[çc][ãa]o Detalhada:\s*<\/b>\s*<div[^>]*conteudo-html[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
  const descCurta = limpo((h.match(/id=["']lot-info-auction-description["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]).replace(/^Descri[çc][ãa]o:\s*/i, '');
  const descricao = (descDet || descCurta || '').slice(0, 4000) || null;
  const v1 = plaus(num((txt.match(/Valor\s*1[ºo°]\s*L\.?\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const v2 = plaus(num((txt.match(/Valor\s*2[ºo°]\s*L\.?\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const lanceMin = plaus(num((h.match(/class=["']lance-minimo["'][^>]*>\s*([\d.]+,\d{2})/i) || [])[1]));
  const avalTexto = plaus(num((String(descricao || '').match(/AVALIA[ÇC][ÃA]O(?:\s+JUDICIAL)?\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const minimo = Math.min(...[v2, v1, lanceMin].filter(Boolean)) || 0;
  const avaliacao = avalTexto || v1 || lanceMin || minimo;
  const d1 = dataBr((txt.match(/1[ºo°]\s*Leil[ãa]o\s*\|?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]);
  const d2 = dataBr((txt.match(/2[ºo°]\s*Leil[ãa]o\s*\|?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]);
  const enc = dataBr((txt.match(/Encerramento:\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]);
  const status = limpo((h.match(/id=["']pregao-detalhe["'][^>]*>([\s\S]*?)<\//i) || [])[1]);
  const endereco = limpo((h.match(/class=["']endereco[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]) || null;
  let { cidade, estado } = cidadeUf(og('description'), endereco, descricao);
  // "…situado na Rua Frei Caetano… desta cidade" sem nome (Leilões Brasil 191493, leilão da prefeitura): a cidade é a
  // do LEILÃO, no breadcrumb "17/11/2026 - 51 Imóveis… | Pref Hidrolândia-GO". Só com o "desta cidade/deste município"
  // no texto — leilão de várias cidades não empresta a sua ao lote — e conferida no IBGE.
  if (!cidade && /\b(?:dest[ae]|nest[ae])\s+(?:cidade|munic[íi]pio)\b/i.test(descricao || '')) {
    const bc = limpo((h.match(/<li class=["']breadcrumb-item["']>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1]);
    for (const x of bc.matchAll(/([A-Za-zÀ-ÿ'][A-Za-zÀ-ÿ' ]{2,40}?)\s*[-/]\s*([A-Z]{2})\b/g)) {
      const pal = x[1].trim().split(/\s+/);
      for (let k = 0; k < pal.length && !cidade; k++) { const c = pal.slice(k).join(' '); if (ehMun(c, x[2])) { cidade = titleCase(c); estado = x[2]; } }
      if (cidade) break;
    }
  }
  const foto = og('image');
  const anexos = [];
  // Edital do leilão: link direto `/principal/<idLeilao>.pdf` no bloco "Downloads".
  for (const m of h.matchAll(/<a\b[^>]*href=["']([^"']*\/principal\/\d+\.pdf[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const u = new URL(decodificarEntidades(m[1]), url).href;
    if (!anexos.some((a) => a.url === u)) anexos.push({ tipo: 'edital', nome: limpo(m[2]) || 'Edital', url: u });
  }
  // `<a … class="pr-2 download-leilao-arquivo" rel="70" title="Recibo de inscrição">…<u>Edital Leilão</u></a>` — a ordem dos
  // atributos varia entre tenants: lê a tag inteira e o texto do link.
  for (const m of h.matchAll(/<a\b([^>]*download-leilao-arquivo[^>]*)>([\s\S]*?)<\/a>/gi)) {
    const rel = (m[1].match(/\brel=["'](\d+)["']/) || [])[1];
    if (!rel) continue;
    const nome = limpo(m[2]) || decodificarEntidades((m[1].match(/\btitle=["']([^"']*)["']/) || [])[1] || '').trim() || 'Documento';
    const u = new URL(`/lotes/download-leilao-arquivo/cod/${rel}`, url).href;
    if (!anexos.some((a) => a.url === u)) anexos.push({ tipo: /edital/i.test(nome) ? 'edital' : /matr[íi]cula/i.test(nome) ? 'matricula' : 'outro', nome, url: u });
  }
  const tituloBruto = tituloOg || og('title') || descCurta || '';
  const processo = (txt.match(/\b(\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4})\b/) || [])[1] || null;
  const mat = (`${tituloBruto} ${descricao || ''}`.match(/matr[íi]cula\s*(?:n[º°.o]*\s*)?:?\s*(?:M-?\s*)?([\d.]{3,})/i) || og('description').match(/^M-?\s*([\d.]{3,})\s+-/i) || [])[1]?.replace(/\.$/, '') || null;
  return {
    titulo: tituloBruto.slice(0, 180) || null, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo || avaliacao,
    modalidade: processo || /judicial|vara|ju[íi]zo|penhor/i.test(`${descricao || ''}`) && !/extrajudicial/i.test(`${descricao || ''}`) ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(tituloBruto, descricao || ''),
    descricao, data_leilao: d1 || enc, data_leilao_2: d2 || null,
    numero_matricula: mat, numero_processo: processo, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_matricula: anexos.find((a) => a.tipo === 'matricula')?.url || null,
    link_foto: foto && !RE_IMG_DESCARTA.test(foto) ? foto : null,
    endereco,
    // "Não arrematado" = a praça passou sem venda; a 2ª pode vir — quem tira do ar é a data, não o status.
    encerrado: !!status && RE_ENCERRADO.test(status) && !/^n[ãa]o\s+arrematad/i.test(status),
    status,
  };
}

export const montarRow = (url, det, tenant) => ({ ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo), numero_processo: det.numero_processo || null, endereco: det.endereco || null });
export { checarQualidade };
