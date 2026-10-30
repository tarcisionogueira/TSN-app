/**
 * Parser puro — LUIZ CAMPOLINA LEILÕES (luizcampolina.com.br, Sete Lagoas/MG; leilões do TRT3). Fila #380. WordPress +
 * WooCommerce (produto do tipo `auction` = lote). A Store API pública do WooCommerce entrega o catálogo inteiro em JSON:
 * `/wp-json/wc/store/v1/products?category=imoveis&per_page=100` — o detalhe sai do próprio catálogo, sem abrir página.
 * Recon 30/10:
 *
 *   • Categorias: `1o-leilao` (20), `imoveis` (5), `veiculos`, `diversos`, `realizados` (505 — encerrados). A categoria
 *     `imoveis` mistura veículo cancelado ("LOTE 4.1 *CANCELADO* BEM VEÍCULO FIAT UNO") — o texto decide.
 *   • `name`: "LOTE 01 BEM: GLEBA DE TERRAS…", com "*SUSPENSO*"/"*CANCELADO*" quando sai do pregão.
 *   • `short_description`: vara, "1º LEILÃO: 10-NOVEMBRO-26 – TERÇA FEIRA 15:00 HORAS" e o PDF do edital.
 *   • `description`: processo, partes, "BEM: …", "LOCALIZAÇÃO: … – SETE LAGOAS – MG", "AVALIAÇÃO: R$ 9.000.000,00",
 *     "LANCE MÍNIMO A PARTIR DE 50% NO PRIMEIRO E SEGUNDO LEILÃO: R$ 4.500.000,00".
 *   • Preço do WooCommerce vem zerado (`prices.price = "0"`) — o valor está só no texto.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

const BASE = 'https://luizcampolina.com.br';
export const CATALOGO = '/wp-json/wc/store/v1/products?category=imoveis&per_page=100';
export const TENANTS = {
  campolina: { fonte: 'LUIZCAMPOLINA', leiloeiro: 'Luiz Campolina Leilões (Luiz Washington Campolina Santos)', base: BASE },
};

export const idDaUrl = (url) => (String(url).match(/[?&]lote=(\d+)/) || [])[1] || null;
// O permalink do produto muda se o leiloeiro reescrever o nome ("LOTE 03" → "LOTE 03 *SUSPENSO*"); o id não.
const urlDe = (p) => `${String(p.permalink || `${BASE}/?p=${p.id}`).replace(/[?#].*$/, '')}?lote=${p.id}`;

function produtos(txt) {
  try { const j = JSON.parse(String(txt || '')); return Array.isArray(j) ? j : []; }
  catch (e) { console.warn(`[campolina] catálogo não é JSON: ${String(e?.message || e).slice(0, 80)}`); return []; }
}
const texto = (html) => decodificarEntidades(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

const MESES = { JANEIRO: 1, FEVEREIRO: 2, 'MARÇO': 3, MARCO: 3, ABRIL: 4, MAIO: 5, JUNHO: 6, JULHO: 7, AGOSTO: 8, SETEMBRO: 9, OUTUBRO: 10, NOVEMBRO: 11, DEZEMBRO: 12 };
/** "1º LEILÃO: 10-NOVEMBRO-26 – TERÇA FEIRA 15:00 HORAS" → ISO; n = 1 ou 2. */
export function dataDoLeilao(t, n) {
  const m = String(t || '').match(new RegExp(`${n}\\s*[ºo°]\\s*LEIL[ÃA]O:?\\s*(\\d{1,2})\\s*[-/ ]\\s*([A-ZÇ]+|\\d{1,2})\\s*[-/ ]\\s*(\\d{2,4})[^\\d]{0,40}?(\\d{1,2})[:h](\\d{2})`, 'i'));
  if (!m) return null;
  const mes = /^\d+$/.test(m[2]) ? Number(m[2]) : MESES[m[2].toUpperCase()];
  if (!mes) return null;
  const ano = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${ano}-${String(mes).padStart(2, '0')}-${m[1].padStart(2, '0')}T${m[4].padStart(2, '0')}:${m[5]}:00-03:00`;
}

export function detalheDoProduto(p, { agora = new Date() } = {}) {
  const nome = texto(p.name);
  const curto = texto(p.short_description);
  const desc = texto(p.description);
  const cats = (p.categories || []).map((c) => c.slug);
  const fora = /\*\s*(SUSPENS|CANCELAD|ADIAD|RETIRAD)/i.test(nome);
  const bem = (desc.match(/\bBEM:\s*(.*?)(?=\s+LOCALIZA[ÇC][ÃA]O:|\s+AVALIA[ÇC][ÃA]O:|$)/i) || [])[1] || nome.replace(/^LOTE\s+[\d.]+\s*(?:\*[^*]+\*)?\s*(?:BEM:?)?\s*/i, '');
  const localizacao = (desc.match(/LOCALIZA[ÇC][ÃA]O:\s*(.*?)(?=\s+AVALIA[ÇC][ÃA]O:|\s+LANCE M[ÍI]NIMO|$)/i) || [])[1] || '';
  // "… – SETE LAGOAS – MG" → "SETE LAGOAS/MG" para o validador de município (lista do IBGE).
  const comBarra = (s) => String(s).replace(/\s*[–-]\s*([A-Z]{2})\b(?!\w)/g, '/$1');
  const local = [cidadeDoTexto(comBarra(localizacao)), cidadeDoTexto(comBarra(bem)), cidadeDoTexto(comBarra(curto))].find((c) => c.cidade) || { cidade: null, estado: null };
  const aval = num((desc.match(/AVALIA[ÇC][ÃA]O:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  // "[^R$]" parava no R de "PRIMEIRO" e o lance caía na avaliação (R$ 9 mi no lugar de 4,5 mi).
  const minimo = num((desc.match(/LANCE M[ÍI]NIMO[\s\S]{0,120}?R\$\s*([\d.]+,\d{2})/i) || [])[1]) || aval;
  const d1 = dataDoLeilao(curto, 1) || dataDoLeilao(desc, 1);
  const d2 = dataDoLeilao(curto, 2) || dataDoLeilao(desc, 2);
  const fim = d2 || d1;
  const edital = (String(p.short_description || '').match(/href="(https:\/\/luizcampolina\.com\.br\/wp-content\/uploads\/[^"]+\.pdf)"/i) || [])[1] || null;
  const fotos = (p.images || []).map((i) => i?.src).filter(Boolean);
  const processo = (desc.match(/\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b/) || [])[0];
  // Título = 1ª frase do bem, até a 1ª vírgula depois da medida ("Gleba de terras a-02, medindo 10.021,12 m²").
  const frase = (bem.match(/^(.{20,140}?m²|[^,.;]{8,140})/i) || [])[1] || nome;
  const titulo = titleCase(frase.toLowerCase()).replace(/\bM²/g, 'm²');
  return {
    titulo: (local.cidade && !titulo.includes(local.cidade) ? `${titulo} - ${local.cidade}/${local.estado}` : titulo).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval, valor_minimo: minimo, valor_minimo_2: null,
    modalidade: 'judicial',
    area_m2: extrairAreaM2(bem) || 0,
    descricao: [bem, localizacao && `Localização: ${localizacao}.`, processo && `Processo ${processo}.`, curto.match(/\d+ª VARA[^.]*?(?=\s+\d\s*[ºo°]\s*LEIL|$)/i)?.[0]]
      .filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: d1, data_leilao_2: d2 && d2 !== d1 ? d2 : null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || p.permalink || null,
    link_matricula: null,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : [],
    numero_matricula: numeroMatriculaDoTexto(bem) || null,
    naoImovel: /\bVE[ÍI]CULO\b|\bPLACA\s+[A-Z]{3}/i.test(`${nome} ${bem}`),
    encerrado: fora || cats.includes('realizados') || (fim ? Date.parse(fim) < agora : false),
  };
}

/** Catálogo (JSON da Store API) → Map id → url do lote. */
export function extrairUrlsDeLote(txt) {
  const out = new Map();
  for (const p of produtos(txt)) if (p?.id) out.set(String(p.id), urlDe(p));
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }
/** O detalhe já vem no catálogo — o motor não abre página de lote. */
export function detalhesDoCatalogo(txt) {
  const out = new Map();
  for (const p of produtos(txt)) if (p?.id) out.set(urlDe(p), detalheDoProduto(p));
  return out;
}
// Só chamado se o catálogo não trouxe o lote (não deveria acontecer): sem página HTML para ler.
export const parseDetalhe = () => null;

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url.replace(/\?lote=\d+$/, ''), det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
