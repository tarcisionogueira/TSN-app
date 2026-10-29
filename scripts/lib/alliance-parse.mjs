/**
 * Parser puro — ALLIANCE LEILÕES (allianceleiloes.com.br, São Paulo/SP). Medição da junta `medicao_2810`: 223 menções a
 * imóvel na home — mas eram CARDS ANTIGOS. Recon 28/10:
 *
 *   • home: ~120 cards de leilão; o botão do card leva `onClick="window.location.href='leiloes/<id>-<slug>'"`, o título
 *     ("Apartamento - São Vicente"), as praças ("1ª Praça - Fechamento | 05/11/2026") e o rótulo de status. O RÓTULO
 *     NÃO VALE: "Futuro" aparece em leilão de 2021. Dos 120, só 7 tinham data futura; 113 sem data ou vencidos. Vira
 *     evento só o card com data ≥ hoje, ou a VENDA DIRETA sem data (o lote dela ainda mostra "ENVIE SEU LANCE").
 *   • evento `leiloes/<id>-<slug>`: links `lotes/<id>-<nº>-<slug>` (1 a 5 por leilão).
 *   • lote: `<h2>` = título do leilão, `<h3>` = "Lote 01 - <endereço>"; praças numa tabela ("1ª Praça:" | "05/11/2026 às
 *     12:00" | "R$ 611.055,45", ou "Praça Única:"); `<dt>Avaliação:</dt><dd>R$ …</dd>`; "Leilão Judicial|Extrajudicial";
 *     status no botão `btn btn-block <classe>` ("Andamento", "Futuro", "Encerrado"…); fotos em
 *     `arquivos/leiloes/lotes/imagens/`. O edital não tem PDF na página do lote (só o processo, num bloco recolhido).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { normCidade } from './inferir-uf.mjs';
import MUNICIPIOS from '../../api/_municipios.js';

export const TENANTS = {
  alliance: { fonte: 'ALLIANCELEIL', leiloeiro: 'Alliance Leilões', base: 'https://www.allianceleiloes.com.br' },
};

export const idDaUrl = (url) => (String(url).match(/\/lotes\/(\d+-\d+)/) || [])[1] || null;
const dataBR = (d) => { const m = String(d || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? new Date(`${m[3]}-${m[2]}-${m[1]}T23:59:59-03:00`) : null; };

/** Home → leilões que ainda valem: card com alguma praça ≥ hoje, ou venda direta sem data. */
export function extrairUrlsDeEvento(html, base, { agora = new Date() } = {}) {
  const out = new Map();
  for (const card of String(html || '').split(/<div class="col-lg-4 col-md-6 mb-3">/).slice(1)) {
    const m = card.match(/window\.location\.href='(leiloes\/(\d+)-[a-z0-9-]+)'/i);
    if (!m) continue;
    const titulo = (card.match(/font-weight-bold small">([^<]+)/) || [])[1] || '';
    const datas = [...card.matchAll(/Fechamento\s*\|\s*(\d{2}\/\d{2}\/\d{4})/g)].map((x) => dataBR(x[1])).filter(Boolean);
    const vale = datas.length ? datas.some((d) => d >= agora) : /venda\s+direta/i.test(titulo);
    if (vale) out.set(m[2], `${base}/${m[1]}`);
  }
  return out;
}

/** Página de leilão → Map "<id>-<nº>" → url do lote. */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/["'\/](lotes\/(\d+-\d+)-[a-z0-9-]+)["']/gi)) out.set(m[2], `${base}/${m[1]}`);
  return out;
}

const limpar = (s) => decodificarEntidades(String(s || '').replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Cidade: "neste Município e Comarca de São Vicente", "Comarca de Itatiba", "cidade de Mairinque", "Município de X/UF".
// Valida no IBGE (SP por padrão — o leiloeiro é paulista —, ou a UF escrita junto). O título do leilão traz quase
// sempre o BAIRRO paulistano ("Apartamento - Tatuapé"): quando ele não é município, e o texto fala da Capital, é São Paulo.
export function cidadeDoLote(titulo, descricao) {
  const existe = (uf, c) => Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(c)}`);
  const t = String(descricao || '');
  for (const m of t.matchAll(/(?:Munic[íi]pio|Comarca|[Cc]idade)(?:\s+e\s+Comarca)?\s+de\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)(?:\s*[\/-]\s*([A-Z]{2})\b|(?=[,.;:)]|\s+(?:deste|desta|neste|do|da|Estado|SP|e\s|com\s|onde\s)))/g)) {
    const uf = m[2] || 'SP', nome = m[1].trim();
    for (let k = Math.min(4, nome.split(' ').length); k >= 1; k--) {
      const cand = nome.split(' ').slice(0, k).join(' ');
      if (existe(uf, cand)) return { cidade: titleCase(cand.toLowerCase()), estado: uf };
    }
  }
  // "Nº Matrícula: 82.116 / R.I. Cotia", "Registro de Imóveis de Itatiba": a cidade do cartório.
  for (const m of t.matchAll(/(?:\bR\.\s?I\.|Registro\s+de\s+Im[óo]veis)\s+(?:d[aeo]\s+)?([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)(?=[,.;:)\/]|\s+(?:Inscri|sob|n[º°o]|SP\b|-)|$)/g)) {
    const nome = m[1].trim();
    for (let k = Math.min(4, nome.split(' ').length); k >= 1; k--) {
      const cand = nome.split(' ').slice(0, k).join(' ');
      if (existe('SP', cand)) return { cidade: titleCase(cand.toLowerCase()), estado: 'SP' };
    }
  }
  // "no 46º SUBDISTRITO VILA FORMOSA", "7º Subdistrito-Consolação": subdistrito numerado é a divisão de registro da
  // CAPITAL paulista (os bairros dos títulos — Tatuapé, Aclimação, Ipiranga — não são município e não se acham no IBGE).
  if (/\b\d{1,2}\s*[º°o]\s*Subdistrito\b/i.test(t)) return { cidade: 'São Paulo', estado: 'SP' };
  const sufixo = String(titulo || '').replace(/\(.*?\)/g, '').split(' - ').slice(1).join(' - ').trim();
  if (sufixo) {
    const [nome, uf = 'SP'] = sufixo.split('/').map((s) => s.trim());
    if (/^[A-Z]{2}$/.test(uf) && existe(uf, nome)) return { cidade: titleCase(nome.toLowerCase()), estado: uf };
    const ufSlug = (sufixo.match(/\b([A-Z]{2})$/) || [])[1];
    if (ufSlug && existe(ufSlug, sufixo.replace(/\s+[A-Z]{2}$/, ''))) return { cidade: titleCase(sufixo.replace(/\s+[A-Z]{2}$/, '').toLowerCase()), estado: ufSlug };
  }
  if (/\b(?:Capital|S[ãa]o Paulo\s*[\/-]\s*SP|Munic[íi]pio de S[ãa]o Paulo|Comarca da Capital)\b/i.test(t)) return { cidade: 'São Paulo', estado: 'SP' };
  return { cidade: null, estado: null };
}

function pracas(h) {
  const out = [];
  for (const m of h.matchAll(/<td[^>]*>\s*(1ª Praça|2ª Praça|Praça Única)\s*:\s*<\/td>\s*<td[^>]*>\s*(\d{2})\/(\d{2})\/(\d{4})\s*(?:às\s*(\d{2}:\d{2}))?\s*<\/td>\s*<td[^>]*>\s*R\$\s*([\d.,]+)/gi)) {
    out.push({ n: /2ª/.test(m[1]) ? 2 : 1, data: `${m[4]}-${m[3]}-${m[2]}T${m[5] || '00:00'}:00-03:00`, valor: num(m[6]) });
  }
  return out;
}

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const tituloLeilao = limpar((h.match(/<h2 class="h5[^"]*"[^>]*>([\s\S]*?)<\/h2>/i) || [])[1]);
  const tituloLote = limpar((h.match(/<h3 class="lead[^"]*"[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]).replace(/^Lote\s+\d+\s*-\s*/i, '');
  if (!tituloLeilao && !tituloLote) return null;
  const descricao = limpar((h.match(/Descri[çc][ãa]o completa do lote:\s*<\/p>\s*<hr[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
  const semDescricao = /^nenhuma descri[çc][ãa]o/i.test(descricao);
  const ps = pracas(h);
  const p1 = ps.find((p) => p.n === 1), p2 = ps.find((p) => p.n === 2);
  const aval = num((h.match(/Avalia[çc][ãa]o:\s*<\/dt>\s*<dd[^>]*>\s*R\$\s*([\d.,]+)/i) || [])[1]);
  const lance = num((h.match(/ENVIE SEU LANCE\s*R\$\s*([\d.,]+)/i) || [])[1]);
  let d1 = p1?.data || null, v1 = p1?.valor || lance || aval, d2 = p2?.data || null, v2 = p2?.valor || 0;
  if (d1 && d2 && Date.parse(d1) < agora && Date.parse(d2) >= agora) { d1 = d2; v1 = v2 || v1; d2 = null; v2 = 0; }
  const status = limpar((h.match(/<a[^>]*class="btn btn-block (?:futuro|aberto|andamento|encerrado|vendido|cancelado|suspenso|arrematado|finalizado|[a-z]+)\s[^"]*"[^>]*>([^<]{2,30})<\/a>/i) || [])[1]);
  const fechado = /encerrad|vendid|arrematad|cancelad|suspens|retirad|finaliz/i.test(status);
  const fim = d2 || d1;
  const venda = /venda\s+direta/i.test(`${tituloLeilao} ${url}`);
  const fotos = [...new Set(h.match(/arquivos\/leiloes\/lotes\/imagens\/[0-9a-f]+\.(?:jpe?g|png|webp|jfif)/gi) || [])];
  // "Lote de Terreno - Mairinque" + "Lote de Terreno - Mairinque Recanto dos Pássaros": não repete o que o lote já diz.
  const tl = tituloLeilao.replace(/\s*\(VENDA DIRETA\)\s*/i, '');
  const titulo = tl && tituloLote.toLowerCase().startsWith(tl.toLowerCase()) ? tituloLote : [tl, tituloLote].filter(Boolean).join(' - ');
  const { cidade, estado } = cidadeDoLote(tituloLeilao, descricao);
  const processo = limpar((h.match(/<strong class="mr-1">Processo:<\/strong>\s*(?:<a[^>]*>)?([^<]+)/i) || [])[1]);
  return {
    titulo: titulo.slice(0, 200),
    cidade, estado,
    valor_avaliacao: aval || v1, valor_minimo: v1, valor_minimo_2: v2 && v2 !== v1 ? v2 : null,
    modalidade: venda ? 'venda_direta' : /Leil[ãa]o Judicial/i.test(h) ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(`${titulo} ${descricao}`) || 0,
    descricao: !semDescricao && descricao ? `${processo ? `Processo ${processo}. ` : ''}${descricao}`.slice(0, 8000) : null,
    data_leilao: d1, data_leilao_2: d2,
    link_foto: fotos[0] ? `${TENANTS.alliance.base}/${fotos[0]}` : null,
    link_edital: url,
    link_matricula: null,
    anexos: [],
    numero_matricula: numeroMatriculaDoTexto(descricao) || descricao.match(/matr[íi]cula\s+(?:n[º°o.]*\s*)?(\d{1,3}(?:\.\d{3})+|\d{3,7})/i)?.[1] || null,
    naoImovel: /ve[íi]culo|carreta|m[áa]quina|bombas?\b|barco|motocicleta/i.test(tituloLeilao) && !/im[óo]ve|terreno|apartamento|casa|sala|galp[ãa]o|pr[ée]dio/i.test(tituloLeilao),
    // Venda direta sem praça: aberta enquanto o site oferece o lance e o botão não diz o contrário.
    encerrado: fechado || (fim ? Date.parse(fim) < agora : !venda),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  valor_minimo_2: det.valor_minimo_2 || null,
});
export { checarQualidade };
