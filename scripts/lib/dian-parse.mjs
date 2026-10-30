/**
 * Parser puro — LEILOEIRO DIAN (leiloeirodian.com.br; Lucas Ferreira, RS — Vacaria, Lagoa Vermelha, Passo Fundo). Fila
 * dos 58 leiloeiros com imóvel e sem leitor (#380, 29/10). Next.js + Supabase próprio. A página do item é montada no
 * NAVEGADOR ("Carregando leilão…" no HTML do servidor) — por isso a fonte é `dom` (Puppeteer no runner). A API do
 * Supabase do site NÃO é usada (chave tirada do JS do site = contorno de acesso; vetado em 29/10).
 *
 *   • home `/`, `/agenda`, `/venda-direta` (server-rendered): cards `<a href="/item/<uuid>">` com a modalidade
 *     ("Simultâneo"/"Online"/"Venda direta"), `<h3>` título, `<p>Cidade · Categoria</p>` e, no leilão, "Nª Praça
 *     R$ X dd/mm · HHhMM" (SEM ano) ou, na venda direta, "Valor de venda R$ X". 29/10: 29 itens, 10 imóveis.
 *   • item renderizado: `<h1>` título; `<p>ENDEREÇO — Cidade/UF<span> · #código</span></p>`; descrição no 1º `<p>` do
 *     painel "Descrição"; pares `<p>rótulo</p><p>valor</p>` (Código do lote, Categoria, 1ª praça "26/10/2026, 15:30",
 *     2ª praça, Comarca / cidade, Modalidade); valor por praça em `<p>1ª Praça</p><p>26 de out. de 2026</p><p>R$ 350.000</p>`;
 *     "Ver edital" (PDF no storage público); galeria em `<img alt="<título> - Imagem N">` via `/_next/image?url=`.
 *     O bloco "Leilões semelhantes" traz cards de OUTROS itens — as fotos dele não são do lote.
 *   • VENDA DIRETA: o item NÃO mostra o preço (só "Dar Lance"); ele vem do card ("Valor de venda R$ 225.000,00").
 *     A enumeração guarda o card em CARDS (por uuid) e o parseDetalhe junta — o runner sempre enumera antes do detalhe
 *     (mesmo arranjo do FEED do leilaoeletronico-parse).
 */
import { inferirTipo, checarQualidade } from './leilaopro-parse.mjs';
import { num, titleCase, montarRowDom } from './dom-parse-util.mjs';
import { decodificarEntidades, extrairAreaM2, numeroMatriculaDoTexto } from '../../api/_texto-imovel.js';
import { cidadeDoTexto } from './lucian-parse.mjs';

export const TENANTS = {
  dian: { fonte: 'DIANLEILOES', leiloeiro: 'Leiloeiro Dian (Lucas Ferreira)', base: 'https://www.leiloeirodian.com.br' },
};

export const idDaUrl = (url) => (String(url).match(/\/item\/([0-9a-f-]{36})/i) || [])[1] || null;

const limpar = (s) => decodificarEntidades(String(s || '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Cards vistos na enumeração (uuid → card). Venda direta só tem o preço aqui.
const CARDS = new Map();
export const cardDe = (id) => CARDS.get(id) || null;

/** Card da listagem → { id, modalidade, titulo, cidade, categoria, praca, valor, venda }. */
export function lerCard(id, inner) {
  const txt = limpar(inner.replace(/<\/(span|p|h3|div)>/gi, ' | '));
  const loc = limpar((inner.match(/<p>([\s\S]*?)<\/p>/i) || [])[1]);
  const [cidade, categoria] = loc.split(/\s*·\s*/);
  const venda = /Venda direta/i.test(txt);
  const valor = num((txt.match(/(?:Valor de venda|\dª Praça)\s*\|?\s*R\$\s*([\d.]+(?:,\d{2})?)/i) || [])[1]);
  return { id, venda, titulo: limpar((inner.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i) || [])[1]), cidade: cidade || null, categoria: categoria || null, valor: valor || 0 };
}

/** Listagem → Map uuid → url, só CATEGORIA Imóvel (veículo e máquina nem são abertos: cada página custa um render). */
export function extrairUrlsDeLote(html, base) {
  const out = new Map();
  for (const m of String(html || '').matchAll(/<a[^>]*href="\/item\/([0-9a-f-]{36})"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const card = lerCard(m[1], m[2]);
    if (!card.titulo) continue; // link sem card (botão, destaque repetido)
    if (!CARDS.has(m[1]) || (card.valor && !CARDS.get(m[1]).valor)) CARDS.set(m[1], card);
    if (/im[óo]vel/i.test(card.categoria || '')) out.set(m[1], `${base}/item/${m[1]}`);
  }
  return out;
}

/** Home → as duas listagens que a home não mostra inteiras (29/10: +4 itens, todos veículos). */
export function extrairUrlsDeEvento(html, base) {
  return new Map([['agenda', `${base}/agenda`], ['venda-direta', `${base}/venda-direta`]]);
}

const par = (h, rotulo) => limpar((h.match(new RegExp(`<p[^>]*>\\s*${rotulo}\\s*</p>\\s*<p[^>]*>([\\s\\S]*?)</p>`, 'i')) || [])[1]);
const dataISO = (s) => {
  const m = String(s || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:,?\s*(\d{1,2}):(\d{2}))?/); if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:00-03:00`;
};

export function parseDetalhe(html, url, { agora = new Date() } = {}) {
  const h = String(html || '');
  const titulo = limpar((h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1]);
  if (!titulo) return null; // ainda "Carregando leilão…" ou página de erro
  const id = idDaUrl(url);
  const card = cardDe(id);
  // Só o que vem ANTES de "Leilões semelhantes" é do lote.
  const corte = h.search(/Leil[õo]es semelhantes/i);
  const lote = corte > 0 ? h.slice(0, corte) : h;
  const endereco = limpar((lote.match(/<\/h1>\s*<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1]);
  const descricao = limpar((lote.match(/Documentos[^<]*<\/button>\s*<\/div>\s*<div[^>]*>\s*<p[^>]*>([\s\S]*?)<\/p>/i) || [])[1])
    || [...lote.matchAll(/<p[^>]*>([^<]{120,})<\/p>/g)].map((m) => limpar(m[1])).sort((a, b) => b.length - a.length)[0] || '';
  const categoria = par(lote, 'Categoria');
  const comarca = par(lote, 'Comarca\\s*/\\s*cidade');
  const d1 = dataISO(par(lote, '1ª praça')), d2raw = dataISO(par(lote, '2ª praça'));
  const valorPraca = (n) => num((lote.match(new RegExp(`<p[^>]*>\\s*${n}ª Praça\\s*</p>\\s*<p[^>]*>[^<]*</p>\\s*<p[^>]*>\\s*R\\$(?:&nbsp;|\\s)*([\\d.,]+)\\s*</p>`, 'i')) || [])[1]);
  const v1raw = valorPraca(1), v2raw = valorPraca(2);
  const aval = num((lote.match(/avalia[çc][ãa]o\s*<strong[^>]*>\s*R\$(?:&nbsp;|\s)*([\d.,]+)/i) || [])[1])
    || num((descricao.match(/[Aa]valiad[oa][^R$]{0,60}R\$\s*([\d.]+,\d{2})/) || [])[1]) || v1raw || 0;
  const venda = !d1 && (card?.venda || false);
  if (!d1 && !venda) return null; // sem praça e sem card de venda direta: não dá para saber preço nem situação
  let data1 = d1, v1 = v1raw || aval, data2 = d2raw, v2 = v2raw || 0;
  if (venda) { v1 = card.valor; data1 = null; data2 = null; v2 = 0; }
  // Entre as praças: vale a 2ª (lance de agora).
  if (data1 && data2 && Date.parse(data1) < agora && Date.parse(data2) >= agora) { data1 = data2; v1 = v2 || v1; data2 = null; v2 = 0; }
  const fim = data2 || data1;
  const local = cidadeDoTexto(endereco).cidade ? cidadeDoTexto(endereco)
    : cidadeDoTexto(`${comarca}/RS`).cidade ? cidadeDoTexto(`${comarca}/RS`) : cidadeDoTexto(descricao);
  const edital = (lote.match(/<a[^>]*href="([^"]+\.pdf)"[^>]*>\s*Ver edital/i) || [])[1] || null;
  const fotos = [...new Set([...lote.matchAll(/<img[^>]*alt="[^"]*- Imagem \d+"[^>]*src="([^"]+)"|<img[^>]*src="([^"]+)"[^>]*alt="[^"]*- Imagem \d+"/gi)]
    .map((m) => decodificarEntidades(m[1] || m[2]))
    .map((s) => { const u = s.match(/[?&]url=([^&]+)/); return u ? decodeURIComponent(u[1]) : new URL(s, url).href; }))];
  const judicial = /\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}/.test(`${edital || ''} ${descricao}`) || /penhora|auto de avalia/i.test(descricao);
  return {
    titulo: titleCase(titulo.toLowerCase()).slice(0, 200),
    cidade: local.cidade, estado: local.estado,
    valor_avaliacao: aval || v1, valor_minimo: v1, valor_minimo_2: v2 && v2 !== v1 ? v2 : null,
    modalidade: venda ? 'venda_direta' : judicial ? 'judicial' : 'extrajudicial',
    area_m2: extrairAreaM2(`${descricao} ${titulo}`) || 0,
    descricao: [endereco && `Endereço: ${endereco.replace(/\s*·\s*#.*$/, '')}.`, descricao].filter(Boolean).join(' ').slice(0, 8000) || null,
    data_leilao: data1, data_leilao_2: data2,
    link_foto: fotos[0] || null,
    fotos,
    link_edital: edital || url,
    link_matricula: null,
    anexos: edital ? [{ tipo: 'edital', nome: 'Edital', url: edital }] : [],
    // "conforme matrículas nº 115.305 (apartamento) e nº 115.215 (box 80)": o plural escapa do helper comum; vale a 1ª.
    numero_matricula: numeroMatriculaDoTexto(descricao)
      || descricao.match(/matr[íi]culas?\s+n[º°o.]*\s*(\d{1,3}(?:\.\d{3})+|\d{3,7})/i)?.[1] || null,
    naoImovel: !!categoria && !/im[óo]vel/i.test(categoria),
    encerrado: venda ? false : (fim ? Date.parse(fim) < agora : false),
  };
}

export const montarRow = (url, det, tenant) => ({
  ...montarRowDom(url, det, tenant, idDaUrl(url), inferirTipo),
  valor_minimo_2: det.valor_minimo_2 || null,
  ...(det.fotos?.length ? { fotos: det.fotos } : {}),
});
export { checarQualidade };
