/**
 * Parser puro — BENEDETTO LEILÕES (benedettoleiloes.com.br, Rolante/RS; leiloeiro Jeferson Benedetto — varas da Justiça
 * Estadual do RS, comarcas do Vale do Paranhana/Sinos, e vendas diretas). Fila #380. Plataforma PowerWeb ("Sistema
 * desenvolvido por PowerWeb", powerweb.com.br; Laravel + Vue), server-rendered, sem anti-bot → fetch direto, grátis.
 * Recon 30/10:
 *
 *   • `/leiloes?category_id=1` = só IMÓVEIS (o filtro "Categoria" da busca; 2 = móveis, 3 = veículos), numa página só
 *     — a paginação da plataforma está comentada no HTML ("PAGINACAO"). 30 lotes em 30/10, incluindo os FINALIZADOS
 *     (venda direta encerrada em 2024 ainda aparece). Link do lote: `/lance/<id>`.
 *   • Página do lote: o componente Vue `<status-leilao :config="{…}">` traz o lote INTEIRO em JSON (entidades HTML no
 *     atributo): `category_id`, `type` (JUDICIAL · EXTRA_JUDICIAL · VENDA_DIRETA · FEDERAL), `amount_evaluation`,
 *     `amount_initial`, `status` ("DISPONÍVEL"), `dateStatus` (AGENDADO · ATUAL · FINALIZADO), `excerpt` (resumo com
 *     "…, São Leopoldo/RS. Avaliação: R$ …"), `description` (texto da matrícula), `img_featured` + `pictures` (JSON
 *     dentro do JSON) e `proceeding` {processo, start, end, status, file = edital PDF, registration = matrícula PDF}.
 *     Ler o JSON e não o texto evita casar "Avaliação" e "Lance Inicial" da página errada.
 *   • Uma janela só por lote ("Início em 05/11/2026 às 09:00 até 05/11/2026 às 15:00"): o leilão judicial do RS aqui
 *     não publica 2ª praça na página — se houver, é outro cadastro. `data_leilao` = fim da janela.
 *   • Cidade: o resumo traz "Cidade/UF" ou "Cidade-UF" ("Tupandi-RS", "cidade de Parobé-RS"); a matrícula, a comarca.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';
import { tipoDaDescricao } from './parquedosleiloes-parse.mjs';

const BASE = 'https://benedettoleiloes.com.br';
export const CATALOGO = '/leiloes?category_id=1';
export const TENANTS = {
  benedetto: { fonte: 'BENEDETTO', leiloeiro: 'Benedetto Leilões (Jeferson Benedetto)', base: BASE },
};

const RE_LOTE = /href="(?:https?:\/\/(?:www\.)?benedettoleiloes\.com\.br)?\/lance\/(\d+)"/gi;
export const idDaUrl = (url) => (String(url).match(/\/lance\/(\d+)/) || [])[1] || null;

/** Listagem `/leiloes?category_id=1` → Map id → url do lote. */
export function extrairUrlsDeLote(html) {
  const out = new Map();
  for (const m of String(html || '').matchAll(RE_LOTE)) out.set(m[1], `${BASE}/lance/${m[1]}`);
  return out;
}
export function extrairUrlsDeEvento() { return new Map(); }

const texto = (html) => decodificarEntidades(String(html || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

/** `<status-leilao :config="{&quot;id&quot;:…}">` → objeto. null quando a página não tem o componente. */
export function configDoLote(html) {
  const m = String(html || '').match(/<status-leilao\s+:config="([^"]*)"/i);
  if (!m) return null;
  // Só as entidades que o Blade usa no atributo, `&amp;` por último (o `&amp;nbsp;` da descrição vira `&nbsp;`, que
  // o `texto` decodifica depois).
  const json = m[1].replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  try { return JSON.parse(json); } catch (e) { console.warn(`[benedetto] config do lote não é JSON: ${String(e?.message || e).slice(0, 80)}`); return null; }
}

// "2026-11-05 15:00:00" (horário de Brasília, sem fuso) → ISO -03:00.
const iso = (s) => { const m = String(s || '').match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})(?::(\d{2}))?/); return m ? `${m[1]}T${m[2]}:${m[3] || '00'}-03:00` : null; };
const FORA = /encerrad|finalizad|arrematad|vendid|cancelad|suspens|retirad|sustad|adiad/i;
const url = (p) => (p ? `${BASE}${encodeURI(decodeURI(String(p).replace(/\/{2,}/g, '/')))}` : null);
// "Tupandi-RS" / "cidade de Parobé-RS" → "Tupandi/RS" para o validador de município.
const comBarra = (s) => String(s).replace(/([A-Za-zÀ-ÿ])\s*[–-]\s*([A-Z]{2})\b(?![\wÀ-ÿ])/g, '$1/$2');

export function parseDetalhe(html, urlLote, { agora = new Date() } = {}) {
  const c = configDoLote(html);
  if (!c || !c.id) return null;
  const p = c.proceeding || {};
  const resumo = texto(c.excerpt);
  const desc = texto(c.description) || resumo;
  const local = [cidadeDoTexto(comBarra(resumo)), cidadeDoTexto(comBarra(desc))].find((x) => x.cidade) || { cidade: null, estado: null };
  // Título = o resumo sem "Lote 2 - " na frente e sem a avaliação no fim. Resumo todo em maiúsculas ("BOX DE
  // ESTACIONAMENTO Nº 07, EDIFÍCIO WERNER…") passa por titleCase.
  // O artigo do começo sai ("O Box nº 44 …" → "Box nº 44 …"): é o começo do título que a regra de vaga/box de garagem
  // (decisão do dono, scraper-core) lê, e com "O " na frente o box passava como imóvel.
  let base = resumo.replace(/^\s*Lote\s*\d+\s*[-–:]\s*/i, '').split(/\.?\s*Avalia[çc][ãa]o\s*:?/i)[0].replace(/[.;,\s]+$/, '')
    .replace(/^(?:O|A|Um|Uma)\s+/i, '').replace(/^./, (l) => l.toUpperCase());
  if (base && base === base.toUpperCase()) base = titleCase(base.toLowerCase()).replace(/\/([a-z]{2})\b/i, (_, uf) => `/${uf.toUpperCase()}`);
  // "Imóvel localizado na Rua …" não diz o tipo: vem da descrição ("Um terreno situado…", "TERRENO URBANO…"). Só
  // nesse caso — "Box de estacionamento" virava "Prédio - Box…" e escapava da regra de vaga.
  const tipoDesc = /^im[óo]vel\b/i.test(base) ? tipoDaDescricao(desc) : null;
  const titulo = `${tipoDesc ? `${tipoDesc} - ` : ''}${base}`;
  const fim = iso(p.end);
  const situacao = [c.status, c.dateStatus, p.status].filter(Boolean).join(' · ');
  let galeria = [];
  try { galeria = Array.isArray(c.pictures) ? c.pictures : JSON.parse(c.pictures || '[]'); } catch (e) { console.warn(`[benedetto] galeria ilegível no lote ${c.id}: ${String(e?.message || e).slice(0, 60)}`); }
  const fotos = [...new Set([c.img_featured, ...galeria].filter(Boolean).map(url))];
  const edital = url(p.file);
  const matricula = url(p.registration);
  const tipo = String(c.type || '').toUpperCase();
  return {
    titulo: (local.cidade && !titulo.includes(local.cidade) ? `${titulo} - ${local.cidade}/${local.estado}` : titulo).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: Number(c.amount_evaluation) || 0,
    valor_minimo: Number(c.amount_initial) || 0, valor_minimo_2: null,
    modalidade: tipo === 'VENDA_DIRETA' ? 'venda_direta' : tipo === 'EXTRA_JUDICIAL' ? 'extrajudicial' : 'judicial',
    area_m2: extrairAreaM2(desc) || extrairAreaM2(resumo) || 0,
    descricao: [desc, p.proceeding && `Processo ${String(p.proceeding).replace(/\s*\(\d+\)\s*$/, '')}.`].filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: fim, data_leilao_2: null,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || urlLote,
    link_matricula: matricula,
    anexos: [edital && { tipo: 'edital', nome: 'Edital', url: edital }, matricula && { tipo: 'matricula', nome: 'Matrícula', url: matricula }].filter(Boolean),
    numero_matricula: numeroMatriculaDoTexto(desc) || null,
    situacao,
    // Categoria do próprio cadastro: 1 = Imóveis. O catálogo já filtra, a página confirma.
    naoImovel: Number(c.category_id) !== 1,
    encerrado: c.dateStatus === 'FINALIZADO' || FORA.test(`${c.status || ''} ${p.status || ''}`) || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
