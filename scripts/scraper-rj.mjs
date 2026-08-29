/**
 * Scraper RJ Leilões (rjleiloes.com.br) — imóveis via Bright Data Web Unlocker.
 * ────────────────────────────────────────────────────────────────────────────
 * Por que Bright Data (pago): o recon provou que o RJ está 100% atrás de Cloudflare
 * — TODO caminho responde 403 "Just a moment..." mesmo pelo Puppeteer no GitHub
 * Actions. Não há via grátis; o Web Unlocker é o único que resolve o desafio. Isso
 * segue o plano do agente: grátis primeiro (falhou), pago como SUPORTE necessário.
 *
 * ─── POR QUE ESTE ARQUIVO FOI REESCRITO EM 11/08 ────────────────────────────
 * O acervo do RJ estava congelado em 30/07 com **check verde em todas as execuções**.
 * A investigação achou quatro defeitos empilhados, e nenhum deles aparecia em log de erro:
 *
 *  1. O teto semanal do Bright Data estava SATURADO há 4 semanas (450/450). O
 *     `fetchViaBrightData` devolvia `null` por falta de cota, o `bd()` devolvia `null`,
 *     e o laço de páginas lia isso como **fim das páginas** → "Nenhum lote na listagem"
 *     → `return` → **exit 0**. É a forma #4 do CLAUDE.md, com um agravante: o processo
 *     inteiro durava 0,6s e ninguém notava. (A reserva por propósito, que garante os
 *     créditos do RJ, veio na migração `brightdata_reserva_por_proposito.sql`.)
 *  2. O runner RESIDENCIAL chamava este script SEM `RJ_DRYRUN=0` — e o default aqui é
 *     dry-run. Ou seja: o caminho grátis NUNCA gravou uma linha de RJ. Ele saía com 0,
 *     o gate carimbava "coletei", e o freio de custo bloqueava o caminho pago. Deadlock.
 *  3. O dispatch manual do workflow também era dry-run por default: gastava cota e não
 *     gravava nada. Oito execuções entre 02/08 e 11/08, todas verdes, todas estéreis.
 *  4. Os preços vinham errados. Três dos cinco imóveis ativos tinham `valor_minimo`
 *     igual a **5% do lance real** (a comissão do leiloeiro), porque o fallback pegava
 *     o `Math.min` de todos os "R$" da página. O próprio TÍTULO trazia o valor certo.
 *
 * REGRA QUE FICA: este script só sai com 0 quando **provou** o que aconteceu — gravou,
 * ou constatou de fato que não há lote. Falha de acesso sai com código ≠ 0 e registra
 * `fonte_saude` como 'falhou', para o monitor enxergar em vez de ver silêncio.
 *
 * SEGURANÇA DE CUSTO (cada request = 1 chamada Bright Data):
 *   - RJ_MAX_LOTES (default 40): teto de lotes por execução.
 *   - RJ_DRYRUN (default '1'): NÃO grava — só busca/parseia e loga o que inseriria.
 *   - RJ_DEBUG  (default '0'): dumpa a ESTRUTURA (sitemap + 1 lote) p/ afinar o parser
 *     — método recon-first. Roda com RJ_DEBUG=1 na 1ª vez (gasta ~2-3 requests).
 *   - buscarViaBrightData respeita o teto semanal global + reserva/sub-cota 'rj'.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { decodificarEntidades } from '../api/_texto-imovel.js';
import { buscarViaBrightData, brightDataDisponivel, ErroBrightData } from '../api/_brightdata.js';
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';
import { extrairGenerico, extrairData, checarQualidade } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';

const BASE = 'https://www.rjleiloes.com.br';
const MAX_LOTES = Number(process.env.RJ_MAX_LOTES || 40);
const DRYRUN = process.env.RJ_DRYRUN !== '0'; // default: dry-run (não grava)
const DEBUG = process.env.RJ_DEBUG === '1';
const HEADLESS = process.env.RJ_HEADLESS === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

/**
 * Falha de ACESSO à fonte (não é "a fonte não tem lote"). Sempre sai com código ≠ 0.
 *
 * CARREGA O `semCota` (29/08). O `ErroBrightData` já sabe distinguir "o orçamento disse
 * não" de "a fonte respondeu errado" — e esta classe descartava essa distinção ao copiar
 * só o `motivo`. Um frame acima, o `.catch()` do `main()` montava a validação sem o campo,
 * e `registrarSaude` gravava `status='falhou'`. Resultado medido: **8 linhas de RJLEILOES
 * entre 13/08 e 29/08 acusando a fonte por uma recusa de ORÇAMENTO** — com o `motivo`
 * dizendo `teto_global` por extenso, ao lado de um status que dizia o contrário.
 *
 * É a forma #5 do CLAUDE.md, e a correção de 16/08 em `_saude-fonte.mjs` não alcançou
 * este arquivo porque ele constrói o objeto de validação por conta própria. A ação que
 * cada caso pede é oposta — liberar cota × consertar parser —, então a informação tem de
 * chegar no CAMPO que o monitor lê, não só no texto que ninguém consulta.
 */
class FalhaDeAcesso extends Error {
  constructor(motivo, detalhe, semCota = false) {
    super(detalhe ? `${motivo}: ${detalhe}` : motivo);
    this.motivo = motivo;
    this.semCota = semCota === true;
  }
}

/**
 * Busca crua. **LANÇA** FalhaDeAcesso quando não conseguiu ler — nunca devolve `null`
 * para dizer "não deu", porque foi exatamente essa ambiguidade que travou a coleta por
 * 12 dias com o workflow verde. Só devolve string quando de fato leu a página.
 */
async function bd(url, { timeoutMs = 60000 } = {}) {
  if (HEADLESS) {   // runner residencial: Chromium real (passa Cloudflare de IP residencial), SEM Bright Data
    const h = await fetchHeadless(url, { timeoutMs });
    if (DEBUG) console.log(`  headless ${url} → ${h ? h.length + ' bytes' : 'null'}`);
    // fetchHeadless devolve null tanto para desafio não resolvido quanto para erro de
    // navegador — os dois são falha de acesso, nenhum é "a página está vazia".
    if (h == null) throw new FalhaDeAcesso('headless', `Chromium não trouxe ${url}`);
    return h;
  }
  let r;
  try {
    r = await buscarViaBrightData(url, { proposito: 'rj', timeoutMs, exigirOk: false });
  } catch (e) {
    // `e.semCota` viaja junto: sem ele, teto_global/subcota chegam ao monitor como quebra da fonte.
    if (e instanceof ErroBrightData) throw new FalhaDeAcesso(e.motivo, e.detalhe || e.message, e.semCota);
    throw e;
  }
  const body = await r.text().catch(() => null);
  if (DEBUG) console.log(`  bd ${url} → HTTP ${r.status} · ${body ? body.length : 0} bytes`);
  if (!r.ok) throw new FalhaDeAcesso('http', `HTTP ${r.status} em ${url}`);
  if (body == null) throw new FalhaDeAcesso('corpo_ilegivel', url);
  return body;
}

function inferirTipo(titulo = '') {
  const t = titulo.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote|gleba|[áa]rea/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// Enumeração — plataforma SOLEON: a página do lote é /item/{id}/detalhes.
// Extrai da listagem (ou de qualquer HTML) as URLs de detalhe, normalizando (sem ?page).
function extrairUrlsDeLote(txt) {
  const urls = new Set();
  for (const m of txt.matchAll(/\/item\/(\d+)\/detalhes/gi)) {
    urls.add(`${BASE}/item/${m[1]}/detalhes`);
  }
  return [...urls];
}

// Rótulos que NÃO são o preço do imóvel. O `Math.min` cego pegava a comissão de 5% e
// gravava um lance 20× menor que o real (medido em 3 dos 5 ativos, 11/08). O `Math.max`
// pegava o "total geral" do edital. Qualquer R$ precedido por um destes é descartado.
const ROTULO_NAO_PRECO = /(comiss|cau[çc][ãa]o|incremento|honor[áa]r|taxa|multa|iptu|condom[íi]n|d[ée]bito|d[íi]vida|custas|emolument|itbi|dep[óo]sito\s+pr[ée]vio|lance\s+m[íi]nimo\s+de\s+incremento)/i;

/**
 * Todos os "R$ x.xxx,yy" do texto que NÃO estão colados a um rótulo de não-preço.
 * A janela do rótulo vai do "R$" ANTERIOR até este (no máx. 60 chars): olhar 60 chars fixos
 * para trás faz o rótulo do valor anterior contaminar o seguinte — numa página com
 * "Incremento R$ 2.000,00 Valor de Avaliação R$ 1.000.000,00" a avaliação era descartada.
 */
function valoresPlausiveis(txt) {
  const out = [];
  let fimAnterior = 0;
  for (const m of txt.matchAll(/R\$\s*([\d.]+,\d{2})/g)) {
    const ini = Math.max(fimAnterior, m.index - 60);
    fimAnterior = m.index + m[0].length;
    if (ROTULO_NAO_PRECO.test(txt.slice(ini, m.index))) continue;
    const v = num(m[1]);
    if (v >= 10000 && v <= 500_000_000) out.push(v);
  }
  return out;
}

// Preposições/artigos que o regex de "CIDADE/UF" arrasta junto ("EM ITABAIANA/SE",
// "A CIDADE DE BARRA DOS COQUEIROS/SE"). Sem esta limpeza a cidade gravada não bate
// com nenhum filtro do site nem com a geocodificação.
const CONECTIVO = /^(?:d[aeo]s?|n[aeo]s?|em|a|o|as|os|situad[oa]|localizad[oa])$/i;
// "cidade", "bairro", "povoado"… NÃO são conectivos por si só — **Cidade Ocidental/GO é um
// município de verdade**, e uma versão anterior desta limpeza renomeou 756 lotes para
// "Ocidental" antes de eu perceber. Substantivo geográfico só é ruído quando vem seguido de
// "de/do/da" ("a CIDADE DE Barra dos Coqueiros"); colado direto no nome, ele É o nome.
const SUBSTANTIVO_GEO = /^(?:cidade|bairro|munic[íi]pio|distrito|povoado|conjunto|condom[íi]nio|resid[êe]ncial)$/i;
const PREPOSICAO = /^(?:d[aeo]s?)$/i;
function limparCidade(bruta) {
  if (!bruta) return null;
  let c = String(bruta).trim().replace(/\s+/g, ' ');
  // "CENTRO EM ITABAIANINHA" → o que vem DEPOIS do último " EM " é a cidade.
  const posEm = c.toUpperCase().lastIndexOf(' EM ');
  if (posEm > 0) c = c.slice(posEm + 4).trim();
  const p = c.split(' ').filter(Boolean);
  for (;;) {
    if (p.length > 1 && CONECTIVO.test(p[0])) { p.shift(); continue; }
    // "CIDADE DE Barra…" → descarta os dois; "Cidade Ocidental" → intocado.
    if (p.length > 2 && SUBSTANTIVO_GEO.test(p[0]) && PREPOSICAO.test(p[1])) { p.splice(0, 2); continue; }
    break;
  }
  c = p.join(' ').trim();
  if (!c || c.length > 60 || CONECTIVO.test(c) || SUBSTANTIVO_GEO.test(c)) return null;
  return c;
}

// Parseia a página de detalhe: base genérica (og/ld+json/valores) + refinamentos RJ.
function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  // Decodifica entidades antes de qualquer regex (18/08): `Leil&atilde;o`, `1&ordm;`,
  // `matr&iacute;cula` e `m&sup2;` nao casam com regex acentuada, e o resultado nao e erro —
  // e valor faltando com cara de ausencia. Ver `api/_texto-imovel.js`.
  const txt = decodificarEntidades(html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

  const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;

  // 1º) O TÍTULO. O SOLEON escreve os dois valores no próprio nome do lote
  //     ("… - Lance Inicial: R$600.000,00- Avaliação: R$1.000.000,00"). Vem do cadastro,
  //     não do corpo — onde convivem comissão, caução, incremento e os valores dos OUTROS
  //     lotes do mesmo edital. É a fonte mais confiável da página.
  const tit = base.titulo || '';
  const titLance = plaus(num((tit.match(/lance\s*(?:inicial|m[íi]nimo)\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const titAval = plaus(num((tit.match(/avalia[çc][ãa]o\s*:?\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]));

  // 2º) Rótulos limpos no corpo.
  const rotLance = plaus(num((txt.match(/lance\s*(?:inicial|m[íi]nimo)[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const rotAval = plaus(num((txt.match(/valor\s*(?:de\s*)?avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i)
    || txt.match(/avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));

  // 3º) Último recurso: os R$ da página, já sem os rótulos de não-preço.
  const grandes = valoresPlausiveis(txt);
  const avaliacao = titAval || rotAval || (grandes.length ? Math.max(...grandes) : 0);
  let valorMinimo = titLance || rotLance;
  if (!valorMinimo && grandes.length) {
    const semAval = grandes.filter(v => v !== avaliacao);
    valorMinimo = semAval.length ? Math.min(...semAval) : avaliacao;
  }

  const modalidade = /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : /extrajudicial/i.test(txt) ? 'extrajudicial'
    : /venda\s*direta/i.test(txt) ? 'venda_direta' : 'extrajudicial';
  const area = num((txt.match(/([\d.]+,\d{2}|\d+)\s*m²/i) || [])[1]);
  // cidade/UF: padrão "CIDADE/UF" no título/endereço (ex.: "ARACAJU/SE"). Sem hífen na
  // classe p/ não capturar o nome da rua antes do " - CIDADE/UF".
  const loc = ((base.titulo || '') + ' ' + txt).match(/([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'. ]{1,30})\/([A-Z]{2})\b/);
  const cidade = loc ? limparCidade(loc[1]) : null;
  const estado = loc ? loc[2] : null;
  const mat = (txt.match(/matr[íi]cula[^\d]{0,20}([\d.\-\/]{2,})/i) || [])[1] || null;

  // Documentos: PDFs e links rotulados (matrícula/edital/laudo).
  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label)) {
      let abs; try { abs = new URL(href, url).href; } catch { continue; }
      docs.push({ url: abs, label: label.slice(0, 60) });
    }
  }
  const findDoc = re => (docs.find(d => re.test(d.label) || re.test(d.url)) || {}).url || null;
  const anexos = docs.map(d => ({ tipo: /matr[íi]cula/i.test(d.label + d.url) ? 'matricula' : (/edital/i.test(d.label + d.url) ? 'edital' : (/laudo/i.test(d.label + d.url) ? 'laudo' : 'outro')), nome: (d.label || 'Documento').slice(0, 80), url: d.url }));

  // Coerência anexo × link: o anexo é a lista completa; link_edital/link_matricula são
  // os atalhos que a tela usa. Achado real (rj_82689, 21/07): a matrícula estava nos
  // anexos e `link_matricula` vinha null — o botão do cliente ficava morto com o
  // documento na mão. Se o anexo existe, o atalho existe.
  const doTipo = t => (anexos.find(a => a.tipo === t) || {}).url || null;

  return {
    titulo: (base.titulo || '').slice(0, 180) || null,
    cidade,
    estado,
    link_foto: base.link_foto,
    valor_avaliacao: avaliacao,
    valor_minimo: valorMinimo,
    modalidade,
    area_m2: area,
    descricao: (base.descricao || '').slice(0, 500) || null,
    data_leilao: base.data_leilao || extrairData(html),
    numero_matricula: mat,
    link_edital: findDoc(/edital/i) || doTipo('edital'),
    link_matricula: findDoc(/matr[íi]cula/i) || doTipo('matricula'),
    anexos,
  };
}

function idDaUrl(url) {
  const m = String(url).match(/\/item\/(\d+)/i);
  return m ? m[1] : String(url).replace(/[?#].*/, '').split('/').filter(Boolean).pop();
}

function montarRow(url, det) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url);
  return {
    fonte: 'RJLEILOES',
    fonte_id: `rj_${id}`,
    titulo: det.titulo || `Imóvel RJ ${id}`,
    tipo: inferirTipo(det.titulo || ''),
    modalidade: det.modalidade,
    cidade: det.cidade || null,
    estado: det.estado || null,
    valor_avaliacao: va,
    valor_minimo: vm,
    area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url,
    url_lote: url,
    link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula,
    link_matricula: det.link_matricula,
    anexos: det.anexos,
    leiloeiro: 'RJ Leilões',
    data_leilao: det.data_leilao || null,
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// RECON: plataforma SOLEON — os imóveis ficam na listagem /lotes/categoria/imoveis
// (o sitemap só tem categorias). Dumpa o padrão de URL do lote + paginação + 1 detalhe.
async function debugRecon() {
  console.log('🔎 RJ RECON v2 — plataforma SOLEON\n');
  const LIST = `${BASE}/lotes/categoria/imoveis`;
  const html = await bd(LIST, { timeoutMs: 90000 });
  console.log(`listagem ${LIST}: ${html.length} bytes`);

  const lotes = extrairUrlsDeLote(html);
  console.log(`\n▓▓ lotes /item/{id}/detalhes na página 1 — ${lotes.length}:`);
  console.log('   ' + lotes.slice(0, 25).join('\n   '));

  const alvo = lotes[0] || null;
  if (alvo) {
    console.log(`\n── DETALHE amostra: ${alvo}`);
    const dh = await bd(alvo, { timeoutMs: 90000 });
    const det = parseDetalhe(dh, alvo);
    console.log('   parseDetalhe →', JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }, null, 2));
    const t = decodificarEntidades(dh.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
    console.log('   R$ contexto:');
    for (const m of t.matchAll(/(.{0,45})R\$\s*([\d.]+,\d{2})/g)) console.log(`     …${m[1].trim()} » R$ ${m[2]}`);
    console.log('   matrícula ctx:', (t.match(/.{0,25}matr[íi]cula.{0,45}/i) || [''])[0].trim());
    console.log('   docs href amostra:', JSON.stringify([...dh.matchAll(/href=["']([^"']*(?:\.pdf|edital|matricula|laudo)[^"']*)["']/gi)].map(m => m[1]).slice(0, 6)));
  } else {
    console.log('\n⚠️ nenhum /item/{id}/detalhes na listagem — amostra do HTML p/ inspeção:');
    console.log('   ' + html.slice(0, 1500).replace(/\s+/g, ' '));
  }
  console.log('\n✅ RECON v2 concluído.');
}

async function main() {
  // Bright Data só é exigido no modo pago (CI); no runner RESIDENCIAL (RJ_HEADLESS=1)
  // o Chromium real passa o Cloudflare de graça — o guard antigo abortava o modo de casa.
  if (!brightDataDisponivel() && !HEADLESS) {
    throw new FalhaDeAcesso('sem_config', 'BRIGHTDATA_API_TOKEN/ZONE ausentes — RJ só é acessível via Web Unlocker (ou use RJ_HEADLESS=1 num IP residencial)');
  }
  if (DEBUG) { await debugRecon(); return { modo: 'recon' }; }

  console.log(`RJ LEILÕES ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · via ${HEADLESS ? 'Chromium residencial' : 'Bright Data'} · max ${MAX_LOTES} lote(s)/run`);

  // 1) Enumeração: listagem de imóveis paginada (SOLEON: /lotes/categoria/imoveis?page=N).
  //    A página 1 é OBRIGATÓRIA: se ela não vier, não sabemos nada sobre o acervo — e
  //    "não sei" nunca pode virar "não há". A partir da 2ª, uma falha interrompe a
  //    paginação mas marca a enumeração como INCOMPLETA (nunca desativa o que não viu).
  const MAX_PAGES = Number(process.env.RJ_MAX_PAGES || 6);
  const setUrls = new Set();
  let enumeracaoCompleta = true;
  for (let p = 1; p <= MAX_PAGES; p++) {
    let body;
    try {
      body = await bd(`${BASE}/lotes/categoria/imoveis?page=${p}`, { timeoutMs: 90000 });
    } catch (e) {
      if (p === 1) throw e;                 // sem a página 1 não há coleta — falha dura
      enumeracaoCompleta = false;
      console.error(`  página ${p}: FALHA (${e.motivo || e.message}) — parando a paginação (enumeração incompleta)`);
      break;
    }
    const antes = setUrls.size;
    for (const u of extrairUrlsDeLote(body)) setUrls.add(u);
    console.log(`  página ${p}: +${setUrls.size - antes} lote(s) (total ${setUrls.size})`);
    if (setUrls.size === antes) break; // página sem novidade → fim
    await sleep(400);
  }
  const urlsLote = [...setUrls];
  if (!urlsLote.length) {
    // Chegamos aqui tendo LIDO a página 1 — logo é uma constatação, não uma falha de
    // acesso. Ainda assim registra saúde 'falhou': acervo zerado numa fonte que tinha
    // lotes é exatamente o que o monitor de regressão precisa ver.
    await registrarSaude(supabase, 'RJLEILOES', [], 'principal',
      { ok: false, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 }, motivo: 'listagem lida, zero lotes' });
    console.error('Listagem lida, mas sem nenhum /item/{id}/detalhes. Rode RJ_DEBUG=1 p/ inspecionar o HTML.');
    return { gravados: 0, vazioConfirmado: true };
  }
  console.log(`Enumerados ${urlsLote.length} lote(s)${enumeracaoCompleta ? '' : ' (ENUMERAÇÃO INCOMPLETA)'}.`);

  // Prioriza os NOVOS (fonte_id ainda não no banco). O `error` é checado: `{data}` sozinho
  // funde "não achou" com "não consegui ler" (forma #2 do CLAUDE.md) e, aqui, um erro de
  // leitura faria TODO o acervo parecer novo e reprocessar 40 lotes pagos à toa.
  const ids = urlsLote.map(u => `rj_${idDaUrl(u)}`);
  const existentes = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('imoveis_leilao').select('fonte_id').in('fonte_id', ids.slice(i, i + 200));
    if (error) throw new FalhaDeAcesso('supabase', `leitura de fonte_id: ${error.message}`);
    for (const r of data || []) existentes.add(r.fonte_id);
  }
  const novos = urlsLote.filter(u => !existentes.has(`rj_${idDaUrl(u)}`));
  const alvo = (novos.length ? novos : urlsLote).slice(0, MAX_LOTES);
  console.log(`no banco: ${existentes.size} · novos: ${novos.length} · processando: ${alvo.length}`);

  // 2) Detalhe de cada lote alvo.
  const prontos = [];
  let sem = 0, reprov = 0;
  // Recusa do FREIO DE CUSTO (não de rede) e quantos lotes ficaram POR BUSCAR por causa
  // dela. Os dois alimentam `registrarSaude`: sem cota nenhuma → 'sem_cota'; cota que
  // cortou no meio → 'parcial_cota'. Ver o comentário do `parcial_cota` em _saude-fonte.mjs:
  // um total truncado pelo orçamento não mede a fonte, e ia parar no piso aprendido.
  let recusaDeCota = null, cotaNegada = 0;
  const motivosFalha = new Map();
  for (let i = 0; i < alvo.length; i++) {
    const url = alvo[i];
    let html;
    try {
      html = await bd(url, { timeoutMs: 90000 });
    } catch (e) {
      sem++;
      const m = e.motivo || 'erro';
      motivosFalha.set(m, (motivosFalha.get(m) || 0) + 1);
      console.error(`  ${idDaUrl(url)} · SEM DETALHE (${m})`);
      // Cota esgotada no meio do lote: insistir só queima tempo, e cada tentativa já
      // recebeu o "não" do freio. Para aqui e reporta o que conseguiu. `e.semCota` é o
      // catálogo ÚNICO (em _brightdata.js) — a lista enumerada aqui era a cópia que não
      // recebia motivo novo: `subcota_dia` (rateio de 18/08) já teria ficado de fora.
      if (e.semCota) {
        recusaDeCota = m;
        // Este lote também não foi buscado: conta a partir dele, não do seguinte.
        cotaNegada = alvo.length - i;
        console.log(`  ⛔ PAROU POR COTA (${m}): ${cotaNegada} lote(s) ficaram para a próxima rodada.`);
        break;
      }
      continue;
    }
    const row = montarRow(url, parseDetalhe(html, url));
    const q = checarQualidade(row, { estrito: false });
    console.log(`  ${idDaUrl(url)} · aval R$${row.valor_avaliacao} · min R$${row.valor_minimo} · foto ${row.link_foto ? 'sim' : 'NÃO'} · ${row.modalidade}${q.descartar ? ' · DESCARTADO(' + q.faltando.join(',') + ')' : (q.faltando.length ? ' · faltando ' + q.faltando.join(',') : ' · OK')}`);
    if (q.descartar) { reprov++; continue; }
    prontos.push(row);
    await sleep(400);
  }
  const resumoFalhas = [...motivosFalha].map(([m, n]) => `${m}×${n}`).join(', ');
  console.log(`\nResumo: ${prontos.length} prontos · ${reprov} descartados · ${sem} sem detalhe${resumoFalhas ? ` (${resumoFalhas})` : ''}.`);

  // Nada pronto E houve falha de acesso → NÃO é "a fonte está vazia", é coleta quebrada.
  // Salvo quando quem disse não foi o ORÇAMENTO: aí a fonte nunca chegou a ser lida, e
  // `semCota` viaja no erro para o `.catch()` gravar 'sem_cota' em vez de acusar o parser.
  if (!prontos.length && sem > 0) {
    throw new FalhaDeAcesso(
      recusaDeCota || 'detalhes_inacessiveis',
      `${sem} lote(s) sem detalhe (${resumoFalhas})`,
      !!recusaDeCota);
  }
  if (!prontos.length) {
    await registrarSaude(supabase, 'RJLEILOES', [], 'principal',
      { ok: false, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 }, motivo: `todos reprovados na qualidade (${reprov})` });
    console.error(`Nada a gravar: ${reprov} lote(s) reprovados na checagem de qualidade.`);
    return { gravados: 0, reprovados: reprov };
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 2), null, 2));
    console.log('\nPara gravar, rode com RJ_DRYRUN=0.');
    return { gravados: 0, dryrun: true, prontos: prontos.length };
  }
  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) throw new FalhaDeAcesso('supabase', `upsert: ${error.message}`);
  console.log(`✅ ${prontos.length} imóveis RJ Leilões gravados/atualizados.`);
  // SAÚDE DA FONTE (08/08): entra no monitor de regressão junto das demais. Antes esta fonte
  // não escrevia em `fonte_saude`, então nunca ganhava piso aprendido e uma quebra passaria batido.
  // `cotaNegada` > 0 → 'parcial_cota': coletou alguma coisa, mas o total mede até onde o
  // dinheiro deu, não o acervo do leiloeiro. Sem isto a linha saía 'ok' com um número
  // truncado que o piso aprendido ABSORVE, puxando a linha de base para baixo a cada
  // rodada cortada — a mesma armadilha que o `parcial_cota` fechou nos outros coletores.
  await registrarSaude(supabase, 'RJLEILOES', prontos, 'principal',
    (enumeracaoCompleta && !cotaNegada)
      ? undefined
      : { ok: enumeracaoCompleta, cotaNegada,
          motivo: enumeracaoCompleta ? '' : 'enumeração incompleta (paginação interrompida)' });
  // Auto-aprendizado: registra o que este scraper sabe na base de conhecimento.
  await registrarConhecimento(supabase, {
    fonte: 'RJLEILOES', plataforma: 'SOLEON', acesso: HEADLESS ? 'residencial' : 'brightdata',
    custo: HEADLESS ? 'gratis' : 'pago',
    anti_bot: 'cloudflare', enumeracao: 'listagem_paginada', url_lote: '/item/{id}/detalhes',
    scraper: 'scraper-rj.mjs', qualidade: qualidadeColeta(prontos),
  });
  return { gravados: prontos.length, enumeracaoCompleta };
}

/**
 * Saída HONESTA. Antes, qualquer caminho terminava em `process.exit(0)` — inclusive
 * "não consegui abrir uma única página". Um exit 0 aqui é lido por três consumidores
 * como sucesso: o check do GitHub, o `rodar()` do runner residencial (que carimba o
 * gate) e, por tabela, o freio de custo que decide se o caminho pago pode rodar.
 * Falha de acesso agora sai 1 e deixa rastro em `fonte_saude`.
 */
main()
  .then(async (r) => {
    console.log(`[rj] fim → ${JSON.stringify(r)}`);
    await fecharHeadless();
    process.exit(0);
  })
  .catch(async (e) => {
    const motivo = e?.motivo || 'erro';
    const semCota = e?.semCota === true;
    console.error(`[rj] ${semCota ? 'SEM COTA' : 'FALHA'} (${motivo}): ${e?.message || e}`);
    if (!(e instanceof FalhaDeAcesso)) console.error(e);
    // Marca a falha no monitor. Sem isto, uma fonte que para de responder simplesmente
    // some do radar: `fonte_saude` fica sem linha nova e o acervo encolhe em silêncio.
    // `semCota` grava 'sem_cota' em vez de 'falhou' — a fonte não foi consultada, então
    // não há o que acusar nela. O exit 1 FICA nos dois casos: "não coletei" é verdade em
    // ambos, e sair com 0 seria o check verde sobre acervo parado de 11/08.
    try {
      await registrarSaude(supabase, 'RJLEILOES', [], 'principal',
        { ok: false, semCota, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
          motivo: semCota
            ? `SEM COTA Bright Data (${motivo}) — coleta não tentada (decisão de orçamento, não regressão da fonte)`
            : `falha de acesso: ${motivo}` });
    } catch { /* já estamos no caminho de erro */ }
    await fecharHeadless();
    process.exit(1);
  });
