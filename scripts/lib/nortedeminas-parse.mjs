/**
 * Parser puro — NORTE DE MINAS LEILÕES (nortedeminasleiloes.com.br, plataforma "WebAjato"). Triagem 22/10 (#292).
 * HTML pronto do servidor, sem Cloudflare (grátis). Um nível: a home lista `/leilao/<id>` e cada um é UM bem.
 *
 * Página medida (`/leilao/73`): <h3> com o título ("Apartamento 601 do Edifício …, Belo Horizonte…"),
 * "Valor inícial: 1.550.000,00" (sem R$), "Avaliado em R$ 1.550.000,00", "encerramento do Leilão: 28/11/2025
 * 23:59:59", status no <h3 class="sidebar-title"> ("Em Andamento"/"Encerrado"), descrição em `.car-description`
 * com matrícula e processo, fotos em `/upload/leilao-<id>-<n>-<ts>.png`. Boa parte é venda pelo Comprei (PGFN):
 * a dedup por matrícula (reconciliar_gemeos_matricula) esconde a repetida do COMPREI.
 */
import { inferirTipo, extrairArea, checarQualidade } from './leilaopro-parse.mjs';
import { num, plaus, textoDe, titleCase, montarRowDom, cidadeUFBare, UF_POR_NOME } from './dom-parse-util.mjs';
import { decodificarEntidades } from '../../api/_texto-imovel.js';

export const TENANTS = {
  nortedeminas: { fonte: 'NORTEDEMINAS', leiloeiro: 'Norte de Minas Leilões', base: 'https://nortedeminasleiloes.com.br' },
};

export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/href=["']\/leilao\/(\d+)\/?["']/gi)) out.set(m[1], new URL(`/leilao/${m[1]}`, base).href);
  return out;
}
export const idDaUrl = (url) => (String(url).match(/\/leilao\/(\d+)/) || [])[1] || null;

const limpo = (s) => decodificarEntidades(String(s || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const dataBr = (s) => { const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

// Ordem medida no lote 73: "…, Belo Horizonte, Minas Gerais" (descrição) vem antes; "Cidade/UF" do título; e só
// então a PRIMEIRA "X/UF" da descrição — a última era a vara ("Jef Adjunto de Belo Horizonte/MG").
// "Imóveis da Comarca de Sete Lagoas", "Município de Uberlândia": o prefixo não é a cidade.
const semPrefixo = (c) => String(c || '').replace(/^.*?\b(?:comarca|munic[íi]pio|cidade|distrito)\s+de\s+/i, '').trim();
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function cidadeUf(titulo, descricao) {
  const nomes = Object.keys(UF_POR_NOME).map((k) => k.replace(/-/g, '[ -]')).sort((a, b) => b.length - a.length).join('|');
  const ext = semAcento(descricao).match(new RegExp(String.raw`([a-z][a-z' ]{2,40}?),\s*(?:estado de\s+)?(${nomes})\b`));
  if (ext) {
    const ini = semAcento(descricao).indexOf(ext[0]);
    const cidade = String(descricao).slice(ini, ini + ext[1].length);
    return { cidade: titleCase(semPrefixo(cidade)), estado: UF_POR_NOME[ext[2].replace(/ /g, '-')] || null };
  }
  for (const t of [titulo, descricao]) {
    const m = String(t || '').match(/([A-ZÀ-Ý][A-Za-zÀ-ÿ' ]{2,40}?)\s*\/\s*([A-Z]{2})\b/);
    if (m) return { cidade: titleCase(semPrefixo(m[1])), estado: m[2] };
  }
  return cidadeUFBare(`${titulo || ''} ${descricao || ''}`);
}

export function parseDetalhe(html, url) {
  const h = String(html || '');
  const raiz = `${new URL(url).origin}/`;
  const txt = decodificarEntidades(textoDe(h));
  const titulo = limpo((h.match(/<h3(?![^>]*class=)[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]).slice(0, 180) || null;
  const descricao = limpo((h.match(/class=["'][^"']*car-description[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [])[1]).replace(/^Descri[çc][ãa]o\s*/i, '').slice(0, 4000) || null;
  const { cidade, estado } = cidadeUf(titulo, descricao);
  const minimo = plaus(num((txt.match(/Valor\s+in[íi]cial\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i) || [])[1]));
  const avaliacao = plaus(num((txt.match(/Avaliad[oa]\s+em\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1])) || minimo;
  const encerra = dataBr((txt.match(/encerramento do Leil[ãa]o\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i) || [])[1]);
  const status = limpo((h.match(/<h3[^>]*sidebar-title[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]);
  const mat = (txt.match(/matr[íi]cula\s*(?:n[º°.]?\s*)?:?\s*([\d.]{3,})/i) || [])[1]?.replace(/\.$/, '') || null;
  const fotos = [...new Set([...h.matchAll(/src=["'](\/upload\/leilao-\d+-\d+-[^"']+)["']/gi)].map((m) => new URL(m[1], raiz).href))];
  const anexos = [...h.matchAll(/href=["']([^"']+\.(?:pdf|docx?))["']/gi)].map((m) => {
    const u = new URL(m[1], raiz).href; return { tipo: /matr/i.test(u) ? 'matricula' : 'edital', nome: /matr/i.test(u) ? 'Matrícula' : 'Edital', url: u };
  });
  return {
    titulo, cidade, estado,
    valor_avaliacao: avaliacao, valor_minimo: minimo || avaliacao,
    modalidade: /processo|vara|penhor|execu[çc][ãa]o fiscal/i.test(txt) ? 'judicial' : 'extrajudicial',
    area_m2: extrairArea(titulo || '', descricao || ''),
    descricao, data_leilao: encerra, numero_matricula: mat, anexos,
    link_edital: anexos.find((a) => a.tipo === 'edital')?.url || null,
    link_foto: fotos[0] || null,
    encerrado: /encerrad|arrematad|vendid|cancelad|suspens/i.test(status),
  };
}

export const montarRow = (url, det, tenant) => montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo);
export { checarQualidade };
