/**
 * FONTE (config) — NAKAKOGUELEILOES (nakakogueleiloes.com.br). Fonte `fetch` com DETALHE NO CATÁLOGO
 * (gancho `detalhesDoCatalogo` do runner): `/lotes/consulta/1` traz os imóveis de todos os leilões
 * numa página. Uma execução = 2 páginas (catálogo + home) + 1 PDF por leilão que ainda esteja sem
 * cidade. Sem Cloudflare; o wrapper roda com `semBD` — Bright Data nunca entra. Parser puro em
 * lib/nakakogue-parse.mjs.
 *
 * `enriquecerProntos`:
 *  1. home → data e nome de cada leilão (o card não tem data); o nome também corrige a modalidade
 *     ("Massa Falida…" = judicial; "ITAIPU BINACIONAL ALN…" = extrajudicial).
 *  2. CIDADE PELO EDITAL, só quando o card não a nomeia (ex.: 23 casas da Itaipu, "Vila A"): lê o PDF
 *     do leilão e aceita a cidade só se ela DOMINA o texto (≥ 3 citações e ≥ 2× a segunda). Edital que
 *     cita várias cidades (sede do leiloeiro, foro, outro lote) fica sem — cidade errada é pior que vazia.
 */
import {
  TENANTS, extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, detalhesDoCatalogo,
  leiloesDaHome, leilaoDaUrl, modalidadeDoLeilao,
} from '../../nakakogue-parse.mjs';
import { votosDeCidade } from '../../albertomacedo-parse.mjs';
import { carregarPDFParse } from '../../../../api/_pdf-safe.js';

export const TENANTS_POR_CHAVE = TENANTS;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function baixar(url, { binario = false } = {}) {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  if (binario) return Buffer.from(await r.arrayBuffer());
  const buf = await r.arrayBuffer();
  const u = new TextDecoder('utf-8').decode(buf);
  return u.includes('�') ? new TextDecoder('windows-1252').decode(buf) : u;
}

export function cidadeDominante(texto) {
  const [a, b] = votosDeCidade(texto);
  if (!a || a.n < 3 || (b && a.n < 2 * b.n)) return null;
  return { cidade: a.exibe, estado: a.uf };
}

async function cidadeDoEdital(url) {
  const PDFParse = await carregarPDFParse();
  const parser = new PDFParse({ data: await baixar(url, { binario: true }) });
  try { return cidadeDominante((await parser.getText()).text || ''); }
  finally { await parser.destroy().catch(() => {}); } // padrao-ok: liberar o parser não pode derrubar a cidade já lida
}

async function enriquecer(rows, tenant) {
  const leiloes = leiloesDaHome(await baixar(`${tenant.base}/`));
  let datas = 0, modal = 0, cidEdital = 0;
  for (const r of rows) {
    const l = leiloes.get(leilaoDaUrl(r.url_lote));
    if (!l) continue;
    if (l.data && !r.data_leilao) { r.data_leilao = l.data; datas++; }
    const m = modalidadeDoLeilao(l.nome, r.modalidade);
    if (m !== r.modalidade) { r.modalidade = m; modal++; }
  }
  // Cidade pelo edital: um PDF por leilão (lotes do mesmo leilão compartilham o edital).
  const semCidade = new Map();
  for (const r of rows) if (!r.cidade && r.link_edital && /\.pdf$/i.test(r.link_edital)) {
    if (!semCidade.has(r.link_edital)) semCidade.set(r.link_edital, []);
    semCidade.get(r.link_edital).push(r);
  }
  const falhas = [];
  for (const [pdf, lote] of semCidade) {
    try {
      const c = await cidadeDoEdital(pdf);
      if (!c) { falhas.push(`${pdf.split('/').pop()}: edital sem cidade dominante`); continue; }
      for (const r of lote) { r.cidade = c.cidade; r.estado = c.estado; cidEdital++; }
    } catch (e) {
      const motivo = `${pdf.split('/').pop()}: ${String(e?.message || e).slice(0, 80)}`;
      console.log(`   [${tenant.fonte}] edital não lido — lote(s) seguem sem cidade: ${motivo}`);
      falhas.push(motivo);
    }
  }
  const semCid = rows.filter((r) => !r.cidade).length;
  return `home: ${leiloes.size} leilão(ões) · data em ${datas} · modalidade corrigida em ${modal} · cidade pelo edital em ${cidEdital}`
    + ` · ainda sem cidade: ${semCid}${falhas.length ? ` · ${falhas.join(' | ')}` : ''}`;
}

export default {
  chave: 'nakakogue',
  catalogo: '/lotes/consulta/1',
  paginaParam: 'pagina',
  maxPages: 1,
  tenants: Object.values(TENANTS),
  parse: { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade, detalhesDoCatalogo },
  enriquecerProntos: enriquecer,
  conhecimento: {
    plataforma: 'Multiplix (PHP)', acesso: 'fetch', custo: 'gratis', anti_bot: 'nenhum',
    enumeracao: '/lotes/consulta/1 (categoria imóveis, todos os leilões; detalhe no próprio card)',
    url_lote: '/detalhe-lote/<leilão>/<lote>', scraper: 'scraper-nakakogue.mjs',
  },
};
