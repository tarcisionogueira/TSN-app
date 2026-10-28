/**
 * Parser puro — LEILO (leilo.com.br, Goiânia/GO; "Leilo Master"). Triagem da junta 28/10 (149 menções a imóvel na home;
 * leilo.com.br e leilomaster.com.br são o MESMO site). App Vue/Quasar com SSR: toda página traz o estado do app em
 * `window.__INITIAL_STATE__ = {...}` — um literal de objeto, NÃO JSON: tem `new Date("…")` e `undefined`. Este leitor
 * converte o texto para JSON (troca esses dois por string/null) e lê com JSON.parse — nunca executa o script da página.
 *
 *   • venda direta de imóveis: /imoveis/venda-direta/?pagina=N → `elastic.lotes` (36 por página; 67 em 28/10);
 *   • leilões abertos: `leiloesSite.leiloes` (o mesmo estado, em qualquer página) → /leilao/?leilao.nome=<nome> lista os
 *     lotes do leilão em `elastic.lotes`. O leilão de imóvel nem sempre diz "Imóveis" no nome ("Leilão do Banco Luso -
 *     Santana de Parnaíba"), então o filtro é o `tipo` DO LOTE ("Imoveis"), não o nome do leilão;
 *   • lote: /lote/<uuid>/ → `elastic.lotes[0]` com descrição, valor.minimo / valor.segundaPraca, leilao.data /
 *     leilao.dataSegundaPraca, arquivos (Matrícula, Edital), fotosUrls, comitente.
 * A avaliação não é publicada (só o lance inicial de cada praça) — fica 0, sem inventar.
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { normCidade } from './inferir-uf.mjs';
import MUNICIPIOS from '../../api/_municipios.js';

export const TENANTS = {
  leilo: { fonte: 'LEILO', leiloeiro: 'Leilo (Goiânia/GO)', base: 'https://leilo.com.br' },
};

/** Estado SSR da página → objeto (ou null). Só texto: `new Date("x")` → "x", `undefined` → null. */
export function estadoDaPagina(html) {
  const m = String(html || '').match(/window\.__INITIAL_STATE__=([\s\S]*?)<\/script>/);
  if (!m) return null;
  const s = m[1].replace(/;document\.currentScript[\s\S]*$/, '').replace(/;\s*$/, '')
    .replace(/new Date\(("[^"]*")\)/g, '$1').replace(/([:[,])undefined(?=[,}\]])/g, '$1null');
  try { return JSON.parse(s); } catch { return null; } // padrao-ok: estado ilegível = página que não sei ler
}

const lotesDoEstado = (st) => (Array.isArray(st?.elastic?.lotes) ? st.elastic.lotes : []);
export const idDaUrl = (url) => (String(url).match(/\/lote\/([0-9a-f-]{36})/i) || [])[1] || null;
const urlDoLote = (base, id) => `${base}/lote/${id}/`;

/** Catálogo ou leilão → Map uuid → url, só lote de IMÓVEL. */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const l of lotesDoEstado(estadoDaPagina(html))) if (l?.id && l.tipo === 'Imoveis') out.set(l.id, urlDoLote(base, l.id));
  return out;
}

/** Leilões ainda abertos (não "Executado"), com lote → /leilao/?leilao.nome=<nome>. A "Venda Direta" que aparece como
 *  leilão já vem pelo catálogo da venda direta — não vira evento (seria a mesma lista de novo, um evento por imóvel). */
export function extrairUrlsDeEvento(html, base) {
  const out = new Map();
  for (const l of estadoDaPagina(html)?.leiloesSite?.leiloes || []) {
    if (!l?.uid || !l.nome || /executado|encerrado|cancelado/i.test(l.situacao || '') || !(Number(l.quantidadeLotes) > 0)) continue;
    if (/venda\s+direta/i.test(l.nome)) continue;
    out.set(l.uid, `${base}/leilao/?leilao.nome=${encodeURIComponent(l.nome)}`);
  }
  return out;
}

// "JATAI/GO - GLEBA…", "Águas Claras/DF - Apartamento…", "Barra do Garças/MT com área…": cidade/UF no começo do nome,
// valendo só se o par existir no IBGE. DF é um município só (Brasília): "Águas Claras/DF" é Brasília, bairro Águas Claras.
export function cidadeDoNome(nome) {
  const m = String(nome || '').match(/^\s*([A-Za-zÀ-ÿ' .-]{2,50}?)\s*\/\s*([A-Za-z]{2})\b/);
  if (!m) return { cidade: null, estado: null, bairro: null };
  const uf = m[2].toUpperCase(), bruto = m[1].trim();
  if (uf === 'DF') return { cidade: 'Brasília', estado: 'DF', bairro: normCidade(bruto) === 'brasilia' ? null : titleCase(bruto.toLowerCase()) };
  if (!Object.prototype.hasOwnProperty.call(MUNICIPIOS, `${uf}|${normCidade(bruto)}`)) return { cidade: null, estado: uf, bairro: null };
  return { cidade: titleCase(bruto.toLowerCase()), estado: uf, bairro: null };
}

const iso = (d) => { const t = Date.parse(String(d || '')); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const id = idDaUrl(url);
  const l = lotesDoEstado(estadoDaPagina(html)).find((x) => x?.id === id);
  if (!l) return null;
  const leilao = l.leilao || {};
  const nomeLeilao = String(leilao.nome || '').trim();
  const venda = /venda\s+direta/i.test(nomeLeilao) || !!l.somenteBuyNowProposta;
  const { cidade, estado, bairro } = cidadeDoNome(l.nome);
  const descricao = decodificarEntidades(String(l.descricao || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  const arq = (re) => (l.arquivos || []).find((a) => re.test(a?.descricao || '') && /^https?:\/\//.test(a?.url || ''))?.url || null;
  const matricula = arq(/matr[íi]cula/i);
  const edital = arq(/edital/i) || (/^https?:\/\//.test(leilao.editalUrl || '') ? leilao.editalUrl : null);
  const anexos = [edital && { tipo: 'edital', nome: 'Edital', url: edital }, matricula && { tipo: 'matricula', nome: 'Matrícula', url: matricula }].filter(Boolean);

  // Praças: 1ª em leilao.data, 2ª em leilao.dataSegundaPraca (valor.segundaPraca). Venda direta: prazo em dataFim, sem praça.
  let d1 = venda ? null : iso(leilao.data || l.dataFim), d2 = venda ? null : iso(leilao.dataSegundaPraca);
  let v1 = Number(l.valor?.minimo) || 0, v2 = Number(l.valor?.segundaPraca) || 0;
  if (d1 && d2 && Date.parse(d1) < agora && Date.parse(d2) >= agora) { d1 = d2; v1 = v2 || v1; d2 = null; v2 = 0; }
  const fim = venda ? iso(l.dataFim) : (d2 || d1);
  const comitente = String(l.comitente?.nome || '');
  return {
    titulo: titleCase(String(l.nome || '').toLowerCase()).replace(/\/([a-z]{2})\b/i, (_, uf) => `/${uf.toUpperCase()}`),
    cidade, estado, bairro,
    valor_avaliacao: 0, valor_minimo: v1, valor_minimo_2: v2 && v2 !== v1 ? v2 : null,
    modalidade: venda ? 'venda_direta'
      : /banco|coop|sicoob|sicredi|cred|financ|caixa/i.test(comitente) ? 'extrajudicial'
        : leilao.tipoUrl === 'judicial' ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(`${l.nome || ''} ${descricao}`) || 0,
    descricao: descricao ? `${nomeLeilao ? `${nomeLeilao}. ` : ''}${descricao}`.slice(0, 8000) : null,
    data_leilao: d1, data_leilao_2: d2,
    link_foto: (l.fotosUrls || []).find((u) => /^https?:\/\//.test(u)) || null,
    link_edital: edital || url,
    link_matricula: matricula,
    anexos,
    numero_matricula: numeroMatriculaDoTexto(descricao) || null,
    // "LiberadoLeilao" é o lote no ar (leilão ou venda direta); o resto (Vendido, Retirado, Condicional…) sai.
    encerrado: l.situacao !== 'LiberadoLeilao' || (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  bairro: det.bairro || null,
  valor_minimo_2: det.valor_minimo_2 || null,
});
export { checarQualidade };
