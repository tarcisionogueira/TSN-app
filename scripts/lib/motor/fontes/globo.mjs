/**
 * FONTE (config) — GLOBOLEILOES, só VEÍCULOS (21/10). Os imóveis seguem no scraper-globo.mjs (JSON
 * Inertia por categoria); esta config existe para o scraper-veiculos-motor.mjs, que precisa de
 * enumeração + detalhe por URL.
 *
 * Medido pelo banco (pg_net) em 21/10: `/leiloes-veiculos?page=N` → `props.initialLots` com 60 lotes
 * em 6 páginas, categoria 4 (Outros) · subcategoria 14 (Veículo). Quase todos são do parceiro Balbino
 * (`url` → balbinoleiloes.com.br, MESMA plataforma) e a listagem vem com `description: null` — sem a
 * ficha, todo veículo sairia 'indefinido' e sumiria da tela. A ficha inteira (marca, chassi, renavam,
 * "Localização: <endereço>") está no `<meta name="description">` da página do lote, renderizada no
 * servidor; o JSON da página do parceiro só traz o id (o lote chega depois, por XHR).
 *
 * O lote da LISTAGEM é guardado por URL na enumeração (praças, cidade/UF, avaliação, foto) e o
 * `montarRow` o combina com a ficha — a página do lote não repete esses números.
 */
import { BASE, lerListagem, lerDetalhe, montarRowGlobo } from '../../globo-json.mjs';
import { decodificarEntidades } from '../../../../api/_texto-imovel.js';

const SUBCATEGORIA_VEICULO = 14;
const LOTES = new Map(); // url do lote → lote da listagem (preenchido em extrairUrlsDeVeiculo)
const urlDoLote = (l) => l.url || `${BASE}/leiloes/${l.slug}/${l.id}`;

export function extrairUrlsDeVeiculo(html) {
  const out = new Map();
  for (const l of lerListagem(html)?.lotes || []) {
    if (Number(l.subcategory_id) !== SUBCATEGORIA_VEICULO) continue; // 28 = Sucata, 27 = Equipamento
    const u = urlDoLote(l);
    LOTES.set(u, l);
    out.set(String(l.id), u);
  }
  return out;
}

// O id é o da GLOBO (estável e único na plataforma), não o do parceiro: Balbino e Globo numeram
// cada um o seu, e o mesmo número nos dois sites colidiria no `fonte_id`.
export const idDaUrl = (u) => String(LOTES.get(u)?.id ?? (String(u).match(/\/(\d+)\/?(?:\?|$)/) || [])[1] ?? '');

/** Ficha do `<meta name="description">` (vem com `&lt;br /&gt;` escapado). */
export function fichaDoMeta(html) {
  const m = String(html || '').match(/<meta\s+name="description"\s+content="([^"]*)"/i);
  if (!m) return '';
  return decodificarEntidades(decodificarEntidades(m[1]).replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
}

export function parseDetalhe(html, url) {
  if (!LOTES.has(url)) return null;
  // Lote próprio da Globo: o JSON da página traz fotos e PDFs (lerDetalhe). No parceiro o JSON não
  // tem o lote — fica a foto da listagem.
  const det = LOTES.get(url).url ? null : lerDetalhe(html);
  return { ficha: fichaDoMeta(html), det };
}

export function montarRow(url, { ficha, det }) {
  const l = LOTES.get(url);
  const row = montarRowGlobo(l, det);
  // `title` é o nome do bem ("Ford F-250 XLT L - 1999"); o `full_title` mistura lote, UF e cidade.
  // O " - " antes do ano ("… XLT L - 1999", "… Sedan - 2003/2004") impedia a leitura do ano.
  row.titulo = String(l.title || row.titulo).replace(/\s+/g, ' ').trim().replace(/\s+-\s+(?=(?:19|20)\d\d(?:\/(?:19|20)\d\d)?$)/, ' ').slice(0, 180);
  if (ficha) row.descricao = ficha.slice(0, 8000);
  // Última praça ainda aberta ou futura = até quando o veículo está à venda.
  const fim = (Array.isArray(l.values) ? l.values : []).filter((v) => Number(v.status) !== 2).map((v) => v.end).filter(Boolean).sort().pop();
  if (fim) row.data_leilao_2 = fim;
  return row;
}

export default {
  chave: 'globo',
  fetch: 'fetch',
  tenants: [{ fonte: 'GLOBOLEILOES', base: BASE }],
  veiculos: { catalogo: '/leiloes-veiculos', paginaParam: 'page', maxPages: 15, listaCompleta: true, extrairUrlsDeLote: extrairUrlsDeVeiculo },
  parse: { extrairUrlsDeLote: extrairUrlsDeVeiculo, idDaUrl, parseDetalhe, montarRow },
};
