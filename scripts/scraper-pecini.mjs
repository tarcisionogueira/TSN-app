/**
 * Scraper PECINI Leilões — imóveis via Bright Data Web Unlocker.
 * ────────────────────────────────────────────────────────────────────────────
 * O site barra o Puppeteer com Cloudflare (403), então usamos o Web Unlocker
 * (api/_brightdata.js — já com TETO SEMANAL de custo como fail-safe). Fluxo
 * recon-first (ver scripts/recon-novos-leiloeiros.mjs):
 *   1) GET /sitemap.xml  → enumera TODOS os lotes em 1 request (sem JS).
 *      É um feed de listings (home_listing): id + cidade + região por lote.
 *      A URL do lote segue o padrão /lote/{cidade-uf-slug}/{home_listing_id}/.
 *   2) Para cada lote (limitado a PECINI_MAX_LOTES/run p/ caber na cota grátis),
 *      GET da página de detalhe → título, avaliação, lance, foto, modalidade, data.
 *
 * SEGURANÇA DE CUSTO (cada lote = 1 request Bright Data):
 *   - PECINI_MAX_LOTES (default 40): limite de lotes por execução.
 *   - PECINI_DRYRUN (default '1'): NÃO grava — só busca, parseia e LOGA o que
 *     inseriria. A 1ª validação roda SECA; depois de conferir o parsing no log,
 *     rode com PECINI_DRYRUN=0. O workflow é dispatch-only (sem cron) até validar.
 *   - fetchViaBrightData respeita o teto semanal global (compartilhado com os
 *     demais consumidores) — se estourar, retorna null e o scraper para gentil.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
// NOTA (11/08, revista em 17/08): o `null` que `bd()` devolve continua sendo um fallback
// DELIBERADO (tenta o caminho grátis/residencial; o pago é a segunda chance) — o que mudou é
// que ele deixou de ser MUDO. `bd()` passou de `fetchViaBrightData` para `buscarViaBrightData`
// dentro de um try/catch: o chamador segue vendo `null`, mas o MOTIVO da recusa vira log e o
// laço para quando o freio de custo diz não, em vez de repetir a recusa lote a lote.
import { buscarViaBrightData, brightDataDisponivel, ErroBrightData } from '../api/_brightdata.js';
import { fetchResidencial, fecharHeadless, estatisticaResidencial } from './lib/fetch-residencial.mjs';
import { extrairGenerico, extrairData, checarQualidade, extrairAreaM2} from './lib/scraper-core.mjs';
import { decodificarEntidades } from '../api/_texto-imovel.js';
import { nomeiaUmDocumento } from '../api/_doc-scan.js';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';
import { inferirUF } from './lib/inferir-uf.mjs';
import { pisoEnumeracao, demaisParaUmaRodada } from './lib/sweep-trava.mjs';
import { planejarFilaSitemap, naoImovelPelaPagina } from './lib/pecini-fila.mjs';

// MULTI-LEILOEIRO (27/09): a plataforma ASP.NET "DefaultClean" (suaplataformadeleilao.com.br) é
// a mesma em outros leiloeiros — confirmado no Sublime pelo recon (recon_dump 71): /Core/V1,
// /Themes/DefaultClean, lotes em /lote/<slug>/<id>/. `PECINI_TENANT` escolhe o site; o padrão
// continua sendo o Pecini, com o MESMO comportamento de antes.
const TENANTS = {
  PECINI:  { base: 'https://www.pecinileiloes.com.br', leiloeiro: 'Pecini Leilões' },
  // SUBLIME: o lance NÃO vem no HTML — só `${ValorMinimoLanceSegundaPraca}` (template trimpath)
  // preenchido depois pelo JS via POST com token anti-forgery (/ApiEngine/…, recon 27/09 ids
  // 72-74). Por isso `renderizar`: no runner residencial a página de lote só serve depois que o
  // Chromium roda o JS e o valor aparece. Pelo Web Unlocker (CI) não há lance → não roda lá.
  SUBLIME: { base: 'https://www.sublimeleiloes.com.br', leiloeiro: 'Sublime Leilões', renderizar: true },
  // PW (22/10, triagem #292 — patricialeiloeira e wsleiloes redirecionam para cá): mesma plataforma, feed
  // /sitemap.xml no formato <listings> (134 lotes medidos) e lance em template JS → `renderizar`, como o Sublime.
  PW: { base: 'https://www.pwleiloes.com.br', leiloeiro: 'PW Leilões', renderizar: true },
};
const FONTE = (process.env.PECINI_TENANT || 'PECINI').toUpperCase();
if (!TENANTS[FONTE]) { console.error(`PECINI_TENANT desconhecido: ${FONTE} (conhecidos: ${Object.keys(TENANTS).join(', ')})`); process.exit(1); }
const BASE = TENANTS[FONTE].base;
// fonte_id por leiloeiro: o id do lote é sequencial por SITE — sem prefixo próprio o lote 100 do
// Sublime sobrescreveria o 100 do Pecini em silêncio (upsert por fonte_id não reclama). Para o
// Pecini o prefixo continua `pecini_`, idêntico ao acervo existente.
const PREFIXO = `${FONTE.toLowerCase()}_`;
const MAX_LOTES = Number(process.env.PECINI_MAX_LOTES || 40);
const DRYRUN = process.env.PECINI_DRYRUN !== '0'; // default: dry-run (não grava)
const ALVO = ['novos', 'antigos', 'todos'].includes(process.env.PECINI_ALVO) ? process.env.PECINI_ALVO : 'novos';
const DEBUG = process.env.PECINI_DEBUG === '1';   // dumpa contexto dos R$ p/ achar os rótulos reais
let debugRestante = Number(process.env.PECINI_DEBUG_N || 3); // primeiros lotes (log enxuto)
const RESIDENCIAL = process.env.PECINI_HEADLESS === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Busca crua via Web Unlocker (com teto de custo). Retorna o HTML/XML ou null.
let recusaDeCota = null;   // motivo da última recusa do FREIO DE CUSTO (não de rede)

async function bd(url, { proposito = 'pecini', timeoutMs = 45000 } = {}) {
  if (RESIDENCIAL) {   // runner residencial: fetch puro, Chromium de rede de segurança
    // Tenant `renderizar`: página de LOTE só "serve" com o lance já preenchido pelo JS — o fetch
    // puro devolve o template vazio, `valido` recusa e o fetchResidencial cai no Chromium.
    const valido = TENANTS[FONTE].renderizar && /\/lote\//.test(url) ? (h) => RE_VALOR_RENDERIZADO_1.test(h) : null;
    return await fetchResidencial(url, { timeoutMs, valido });
  }
  // O `null` daqui segue sendo o fallback deliberado deste arquivo — mas o MOTIVO para de ser
  // adivinhado. `fetchViaBrightData` engolia o ErroBrightData e o laço imprimia
  // "detalhe não veio (teto BD?)" com ponto de interrogação: um palpite no lugar do fato que
  // a RPC já tinha devolvido. Na coleta de 17/08 os 5 últimos lotes pararam em
  // `reservado_para_outros` (457 de 500 usados, 43 reservados para o RJ) — o freio agindo como
  // projetado, e o log dizendo "teto?" como se ninguém soubesse.
  try {
    const r = await buscarViaBrightData(url, { proposito, timeoutMs, exigirOk: false });
    if (!r.ok) { console.log(`  · HTTP ${r.status} em ${url}`); return null; }
    return await r.text().catch(() => null);
  } catch (e) {
    if (!(e instanceof ErroBrightData)) throw e;
    if (e.semCota) recusaDeCota = `${e.motivo}${e.detalhe ? ` — ${e.detalhe}` : ''}`;
    console.log(`  · ${e.semCota ? 'RECUSADO PELO FREIO DE CUSTO' : 'falha'}: ${e.motivo}${e.detalhe ? ` (${e.detalhe})` : ''}`);
    return null;
  }
}

// Tipo do imóvel a partir do título (normalizarTipo do scraper principal não é
// exportado; heurística simples e suficiente p/ o filtro da busca).
function inferirTipo(titulo = '') {
  const t = titulo.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';   // antes de terreno: "área rural" é rural
  if (/terreno|lote|gleba|[áa]rea/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio/.test(t)) return 'comercial';
  return 'outros';
}

// Resolve href relativo → absoluto no domínio do Pecini (o _abs do core não é exportado).
function absPecini(href) {
  if (!href) return null;
  if (/^https?:\/\//i.test(href)) return href;
  if (/^\/\//.test(href)) return 'https:' + href;
  if (/^\//.test(href)) return BASE + href;
  return `${BASE}/${String(href).replace(/^\.?\//, '')}`;
}

// Extrai os DOCUMENTOS (PDFs) da página do lote — o Pecini serve em
// /arquivos/Leiloes/Docs/*.pdf. Coleta todo <a href>.pdf, classifica por rótulo/nome e
// monta os anexos. Zero-regressão: sem PDF na página, retorna [] e o comportamento é o
// de hoje (link_edital = página do lote, sem matrícula). Só ADICIONA cobertura.
// Id/caminho do documento escondido num atributo da âncora (`data-arquivo`, `data-url`,
// `data-id`, `onclick="abrir('...')"`). Só devolve o que JÁ É caminho ou nome de arquivo —
// nunca inventa a URL a partir do padrão observado noutro link.
function idDeAtributo(atributos) {
  const txt = String(atributos || '');
  for (const re of [/data-(?:arquivo|url|href|src|file|documento)\s*=\s*["']([^"']+)["']/i,
                    /on[a-z]+\s*=\s*["'][^"']*?['"]([^'"]*\.(?:pdf|jpe?g|png|docx?))['"]/i]) {
    const v = (txt.match(re) || [])[1];
    if (v && /[^/]$/.test(v)) return v;
  }
  return null;
}

function extrairDocs(html) {
  const anexos = [];
  const vistos = new Set();
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+\.pdf(?:\?[^"']*)?)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = absPecini(m[1]);
    if (!url || vistos.has(url)) continue; vistos.add(url);
    // DECODIFICA ENTIDADES ANTES DE CLASSIFICAR (17/08). O rótulo vinha cru: um link
    // "Matr&#xED;cula" não casava com /matr[íi]cul/ e a matrícula que EXISTE no site do
    // leiloeiro nunca virava anexo de matrícula — o cliente lia "Matrícula: no site" com o
    // documento publicado. A prova estava no acervo: anexo gravado como "Edital do Leil&#xE3;o".
    const rotulo = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    const alvo = `${rotulo} ${url}`.toLowerCase();
    const tipo = /matr[íi]cul/.test(alvo) ? 'matricula'
      : /edital/.test(alvo) ? 'edital'
      : /laudo|avalia[çc]/.test(alvo) ? 'laudo'
      : 'anexo';
    anexos.push({ nome: (rotulo || tipo).slice(0, 60), url, tipo });
  }
  // SEGUNDA PASSADA: link cujo RÓTULO diz o que é, mesmo sem terminar em .pdf. O laço acima
  // só aceita href .pdf — se o leiloeiro serve o documento por rota de download/visualizador
  // (`/download?id=`, `/documento/123`), ele some. Aqui só entra o que o TEXTO do link
  // identifica, para não varrer o menu do site inteiro: nada de href genérico.
  for (const m of html.matchAll(/<a\b([^>]*)href=["']([^"']+)["']([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const atributos = `${m[1] || ''} ${m[3] || ''}`;
    let url = absPecini(m[2]);
    if (!url || /\.pdf(\?|$)/i.test(url)) continue;
    const rotulo = decodificarEntidades((m[4] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (!rotulo || rotulo.length > 60) continue;
    const tipo = /matr[íi]cul/i.test(rotulo) ? 'matricula'
      : /edital/i.test(rotulo) ? 'edital'
      : /laudo|avalia[çc]/i.test(rotulo) ? 'laudo'
      : null;
    if (!tipo) continue;
    // O href pode ser a ROTA e não o arquivo (`/preview/`), com o id do documento guardado
    // num atributo que o JS da página usa. Tenta recuperar dali — e SÓ dali: nada é montado
    // a partir de palpite sobre o formato da URL.
    if (!nomeiaUmDocumento(url)) url = absPecini(idDeAtributo(atributos)) || url;
    // Continua sem nomear documento nenhum → não é anexo. Ver `nomeiaUmDocumento`: um link
    // rotulado "Matrícula" que aponta para a pasta faz a ficha prometer o que não entrega.
    if (!nomeiaUmDocumento(url)) continue;
    if (vistos.has(url)) continue;
    vistos.add(url);
    anexos.push({ nome: rotulo.slice(0, 60), url, tipo });
  }

  const ordem = { matricula: 0, edital: 1, laudo: 2, anexo: 3 };
  anexos.sort((a, b) => (ordem[a.tipo] ?? 9) - (ordem[b.tipo] ?? 9));
  return anexos;
}

// "barreiras-ba" → { cidade: 'Barreiras', uf: 'BA' } (o slug do lote traz cidade+UF).
const UFS_BR = new Set('AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO'.split(' '));
function cidadeUfDoSlug(slug) {
  // Sublime (27/09): slug "<tipo>-em-<cidade>[-<uf>]" ("casa-em-campinas",
  // "2-apartamentos-em-dourados-ms") — o formato do Pecini é "<cidade>-<uf>". Sem isto a cidade
  // saiu "2 Apartamentos Em Dourados" e 28 de 34 lotes ficaram sem UF.
  // Sem "-em-" ("casa-no-interlagos": bairro, não cidade) → vazio, melhor que cidade inventada.
  if (FONTE !== 'PECINI') {
    if (!/-em-/.test(String(slug || ''))) return { cidade: null, uf: null };
    slug = String(slug).split('-em-').pop();
  }
  let m = String(slug || '').match(/^(.+)-([a-z]{2})$/i);
  // Sufixo de 2 letras só é UF se FOR uma UF: "sapopemba-zl" (Zona Leste) virou estado "ZL" (28/09).
  if (m && !UFS_BR.has(m[2].toUpperCase())) m = null;
  if (!m && FONTE !== 'PECINI' && slug) {
    const cidade = String(slug).split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
    return { cidade: cidade || null, uf: null };
  }
  if (!m) return { cidade: null, uf: null };
  const cidade = m[1].split('-').filter(Boolean).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  return { cidade: cidade || null, uf: m[2].toUpperCase() };
}

// Enumera lotes do sitemap. Tolerante a 2 formatos: URLs /lote/{slug}/{id}/ (em
// <loc>/<link>/href) e feed de listings (home_listing_id + city + region).
function parseSitemap(xml) {
  const lotes = new Map(); // id -> { id, loteUrl, cidade, uf }
  for (const m of xml.matchAll(/\/lote\/([a-z0-9-]+)\/(\d+)\/?/gi)) {
    const id = m[2];
    if (!lotes.has(id)) {
      const { cidade, uf } = cidadeUfDoSlug(m[1]); // cidade/UF vêm do slug da URL
      lotes.set(id, { id, loteUrl: `${BASE}/lote/${m[1].toLowerCase()}/${id}/`, cidade, uf });
    }
  }
  for (const bl of xml.matchAll(/<listing\b[\s\S]*?<\/listing>/gi)) {
    const b = bl[0];
    const id = (b.match(/<home_listing_id>\s*([^<]+?)\s*<\/home_listing_id>/i) || [])[1]?.trim();
    if (!id) continue;
    const cidade = (b.match(/<city>\s*([^<]+?)\s*<\/city>/i) || [])[1]?.trim() || null;
    const uf = (b.match(/<region>\s*([^<]+?)\s*<\/region>/i) || [])[1]?.trim() || null;
    const rec = lotes.get(id) || { id, loteUrl: null, cidade: null, uf: null };
    if (cidade) rec.cidade = cidade;
    if (uf) rec.uf = uf;
    lotes.set(id, rec);
  }
  return [...lotes.values()];
}

// RÓTULO DA PRAÇA. Exige o ORDINAL (1º/2º/1ª/2ª) ou a palavra "Público" antes de "Leilão" —
// um "Leilão:" solto aparece em menu e em texto corrido, e aceitá-lo transformaria qualquer
// R$ da página em lance. O regex antigo pedia "Público Leilão" e essa fonte escreve só
// "1º Leilão:", que é o suficiente para identificar a praça sem abrir a porta.
const RE_PRACA_ROTULO = /(?:[12]\s*[ºªo°a]\s*|P\S*blico\s+)Leil\S*o/i;
// Valor já renderizado no span do template (Sublime/DefaultClean novo):
// `<span class="ValorMinimoLanceSegundaPraca" DataLabel="R$ ">R$ 180.000,00</span>`.
const RE_VALOR_RENDERIZADO = /class="ValorMinimoLance(?:Primeira|Segunda|Terceira)Praca"[^>]*>\s*(?:R\$\s*)?([\d.]+,\d{2})/gi;
// Cópia SEM `g` para `.test()`: regex global guarda `lastIndex` entre chamadas e o validador
// alternaria aceita/recusa de um lote para o outro.
const RE_VALOR_RENDERIZADO_1 = new RegExp(RE_VALOR_RENDERIZADO.source, 'i');
// AMOSTRA DO RENDERIZADO (27/09): a 1ª gravação do Sublime saiu com lance = 10% da avaliação em
// vários lotes. Os valores só existem depois do JS (no PC do dono) — então o coletor guarda, dos
// primeiros lotes, cada campo de valor/praça COM o nome da classe e o texto em volta dos R$, em
// recon_dump (origem `pecini-render`). Diagnóstico, não dado.
const AMOSTRAS_RENDER = [];
const RE_PRACA_VALOR = /(?:[12]\s*[ºªo°a]\s*|P\S*blico\s+)Leil\S*o\s*:?\s*R\$\s*([\d.]+,\d{2})/gi;

// Parseia a página de detalhe: base genérica (og/ld+json/valores) + refinamentos
// específicos do Pecini (rótulos Avaliação/Lance e trimpath ValorMinimoLance...).
function parseDetalhe(html, rec) {
  const base = extrairGenerico(html, rec.loteUrl) || {};
  // DECODIFICA AS ENTIDADES (17/08). Só o `&nbsp;` era tratado, e o resto do texto chegava cru
  // aos regexes de rótulo. O recon com PECINI_DEBUG mostrou que a página escreve
  // `1&ordm; Leil&atilde;o: R$ 25.789,00` — ou seja, nem `1º` nem `Leilão` existem no texto que
  // era testado. Foi por isso que 10 dos 21 lotes novos saíram com `valor_minimo = 0` e foram
  // descartados: o lance ESTAVA na página, escrito numa forma que nada aqui conseguia ler.
  // É a terceira vez no dia que a mesma entidade não decodificada aparece com outra roupa
  // (rótulo de anexo, descrição do corpo e agora o lance).
  const txt = decodificarEntidades(
    html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
  ).replace(/\s+/g, ' ');

  // Valores pelos rótulos REAIS do Pecini (recon via PECINI_DEBUG):
  //   "Valor de Avaliação (dd/mm/aaaa): R$ X"     → avaliação (a data no meio quebrava o regex antigo)
  //   "1º Leilão: R$ X" / "2º Leilão: R$ Y" (com ou sem "Público") → praças (lance mínimo)
  // Ignoramos "Incremento", "Exercício da Preferência" e o filtro "Faixa de Preço".
  // Faixa plausível p/ imóvel: piso R$1.000, teto R$500mi. Sem match → 0 → descartado.
  const plaus = (v) => (v >= 1000 && v <= 500_000_000) ? v : 0;
  const avalLabel = plaus(num((txt.match(/Avalia\S*o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const pracas = [];
  for (const m of txt.matchAll(RE_PRACA_VALOR)) pracas.push(num(m[1]));
  for (const m of html.matchAll(/ValorMinimoLance(?:Primeira|Segunda)Praca["'\s:=]+R?\$?\s*([\d.]+,\d{2})/gi)) pracas.push(num(m[1]));
  // Tenant renderizado (Sublime): praça só CONTA se tiver data de abertura. O site preenche
  // `ValorMinimoLanceTerceiraPraca` com 10% da avaliação mesmo sem 3ª praça (data vazia) — medido
  // na amostra pecini-render de 27/09 (4 de 4 lotes); o `Math.min` abaixo pegava esse valor e o
  // acervo saiu com desconto falso de 90%. A página tem 2 cópias dos campos (a 2ª é o template
  // vazio): vale a 1ª ocorrência de cada.
  const pracasDatadas = [];
  if (TENANTS[FONTE].renderizar) {
    const NOMES = ['Primeira', 'Segunda', 'Terceira'];
    for (let n = 1; n <= 3; n++) {
      // PW (22/10) divide a data em `Praca<n>DataHoraEncerramento_Data`; o Sublime põe na `…Abertura`.
      const data = (html.match(new RegExp(`class="Praca${n}DataHoraAbertura"[^>]*>\\s*(\\d{2})/(\\d{2})/(\\d{4})`))
        || html.match(new RegExp(`class="Praca${n}DataHoraEncerramento_Data"[^>]*>\\s*(\\d{2})/(\\d{2})/(\\d{4})`)) || []);
      const val = (html.match(new RegExp(`class="ValorMinimoLance${NOMES[n - 1]}Praca"[^>]*>\\s*(?:R\\$\\s*)?([\\d.]+,\\d{2})`)) || [])[1];
      if (data[3] && val) pracasDatadas.push({ n, data: `${data[3]}-${data[2]}-${data[1]}`, valor: num(val) });
    }
    if (pracasDatadas.length) pracas.push(...pracasDatadas.map(p => p.valor));
    else {
      // Sem nenhuma praça datada: o "Lance Mínimo" corrente da página é o único valor seguro.
      const corrente = (txt.match(/Lance M[íi]nimo:\s*R\$\s*([\d.]+,\d{2})/i) || [])[1];
      if (corrente) pracas.push(num(corrente));
    }
  } else {
    for (const m of html.matchAll(RE_VALOR_RENDERIZADO)) pracas.push(num(m[1]));
  }
  if (TENANTS[FONTE].renderizar && AMOSTRAS_RENDER.length < 4) {
    AMOSTRAS_RENDER.push({
      id: rec.id, url: rec.loteUrl, titulo: base.titulo || null,
      campos: [...html.matchAll(/class="((?:ValorMinimoLance|ValorAvaliacao|ValorLanceAtual|ValorDescDiff|ValorIncremento|Praca\d|PracaAtual|QtdPracas|BoxDesc)\w*)"[^>]*>([^<]{0,80})</g)]
        .map(m => `${m[1]}=${m[2].trim()}`).slice(0, 40),
      contextos: [...txt.matchAll(/(.{0,60})R\$\s*([\d.]+,\d{2})/g)].map(m => `${m[1].trim()} » ${m[2]}`).slice(0, 15),
      local: [...txt.matchAll(/(?:Localiza\S*o|Endere\S*o|Cidade|Comarca)\s*:?\s*.{0,120}/gi)].map(m => m[0]).slice(0, 4),
      pracasLidas: pracas,
    });
  }
  const pracasValidas = pracas.map(plaus).filter(v => v > 0);
  const valorMinimo = pracasValidas.length ? Math.min(...pracasValidas) : 0;
  // A 1ª praça abre pelo valor de avaliação → se não houver rótulo de avaliação, usa a MAIOR praça.
  const avaliacao = avalLabel || (pracasValidas.length ? Math.max(...pracasValidas) : 0);

  // RECON: com PECINI_DEBUG=1 dumpa o contexto de cada "R$ ..." (rótulo à esquerda) p/
  // descobrir os rótulos REAIS do site sem acesso direto (o proxy bloqueia o Pecini daqui).
  //
  // MORA AQUI, e não antes de ler os valores, de propósito (17/08): a coleta perdeu 10 dos 21
  // lotes novos por `valor_minimo = 0`, e o debug limitado aos 3 PRIMEIROS lotes despeja
  // justamente os que deram certo — a amostra que não precisa de recon. Agora o dump sai
  // SEMPRE que o lance não foi lido, que é a única página com algo a ensinar.
  if (DEBUG && (debugRestante > 0 || !valorMinimo)) {
    if (debugRestante > 0) debugRestante--;
    console.log(`\n[DEBUG ${rec.id}] ${valorMinimo ? '' : '(SEM LANCE LIDO) '}contextos de R$ (texto):`);
    for (const m of txt.matchAll(/(.{0,45})R\$\s*([\d.]+(?:,\d{2})?)/g)) {
      console.log(`   …${m[1].trim()} » R$ ${m[2]}`);
    }
    const trimp = [...html.matchAll(/(Valor\w*|Lance\w*|Avalia\w*)["'\s:=]{1,4}R?\$?\s*([\d.]+,\d{2})/gi)].map(x => `${x[1]}=${x[2]}`);
    if (trimp.length) console.log(`   [trimpath/attrs] ${trimp.join(' · ')}`);
  }

  // Modalidade: "Público Leilão" (1ª/2ª praça) = leilão, não venda direta (que
  // aparece no menu do site em toda página). "extrajudicial" contém "judicial",
  // então usa lookbehind p/ não classificar errado.
  const temPracas = RE_PRACA_ROTULO.test(txt) || /[12][ªa]\s*pra[çc]a/i.test(txt);
  const modalidade = /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : (temPracas || /extrajudicial/i.test(txt)) ? 'extrajudicial'
    : /venda\s*direta/i.test(txt) ? 'venda_direta'
    : 'extrajudicial';
  // ÁREA (17/08): era `txt.match(/(\d+)\s*m²/)` — exigia o caractere `m²` (site que escreve
  // "m2" saía sem área) e pegava a PRIMEIRA ocorrência da página, que num portal de leilão
  // costuma ser o filtro de busca, não o imóvel. `extrairAreaM2` prioriza área ROTULADA
  // (construída/privativa) e aceita as variações de unidade. Procura primeiro na DESCRIÇÃO —
  // que desde hoje vem do corpo da página, não da meta tag de marketing — e só depois na
  // página inteira, porque a descrição é o texto que fala do imóvel e o resto é o site.
  const descImovel = (base.descricao || '');
  const area = extrairAreaM2(descImovel) || extrairAreaM2(txt);

  // Documentos do lote (matrícula/edital/laudo) a partir dos PDFs da própria página.
  const anexos = extrairDocs(html);
  const matriculaDoc = anexos.find(a => a.tipo === 'matricula')?.url || null;
  const editalDoc = anexos.find(a => a.tipo === 'edital')?.url || null;

  // Página genérica (lote inexistente/redirect p/ a home): og:image é o ícone do
  // site (apple-touch-icon / Themes) e/ou título institucional. Marca p/ pular.
  //
  // 24/08: `!base.link_foto` SOZINHO marcava a página como inexistente — "não tem foto"
  // entregue como "não tem lote". É a forma da casa: ausência de um campo virando veredito
  // sobre a página inteira, e o lote real sem og:image sendo descartado em silêncio, sem
  // sequer aparecer no log como descarte. A prova de que a conflação era real está no próprio
  // log: o ramo `foto NÃO` da linha de resumo é INALCANÇÁVEL, porque todo lote sem foto era
  // pulado antes de chegar lá — em 578 lotes visitados, nunca uma única linha `foto NÃO`.
  //
  // Agora o sinal de "página institucional" decide sozinho (ícone do tema, título do site),
  // e a falta de foto só pesa quando a página TAMBÉM não tem nenhum sinal de lote — nenhum
  // valor e nenhum documento. Um lote de verdade tem pelo menos um dos dois.
  // 22/10 (PW, 36 de 40 "sem detalhe"): lote SEM foto própria tem o og:image do TEMA — e isso sozinho virava
  // "página institucional", com preço e datas na página. Ícone do tema só condena junto com falta de sinal de lote;
  // com sinal, é só "sem foto".
  const fotoDoTema = /apple-touch-icon|Themes\/DefaultClean|\/Content\/images\//i.test(base.link_foto || '');
  if (fotoDoTema) base.link_foto = null;
  const semSinalDeLote = !avaliacao && !valorMinimo && !anexos.length;
  const pareceInstitucional = (fotoDoTema && semSinalDeLote)
    || /^Pecini Leil[õo]es\s*[|-]/i.test((base.titulo || '').trim());
  const paginaInvalida = pareceInstitucional || (!base.link_foto && semSinalDeLote);

  return {
    // Sublime (27/09): o og:title/<title> traz " Casas em leilão | Sublime Leilões" colado.
    titulo: (base.titulo || `Imóvel Pecini ${rec.id}`)
      .replace(/\s*\|\s*(?:Sublime|Pecini) Leil[õo]es\s*$/i, '')
      .replace(/\s+[A-Za-zÀ-ÿ]+ em leil[ãa]o\s*$/i, '').trim().slice(0, 180),
    // Título CRU (com o sufixo de categoria "Motos em leilão"), só para `naoImovelPelaPagina` — o de cima o corta.
    tituloCru: base.titulo || '',
    link_foto: base.link_foto,
    valor_avaliacao: avaliacao,
    valor_minimo: valorMinimo,
    modalidade,
    area_m2: area,
    // 500→2000 (17/09) →8000 (20/09, pedido do dono: descrição completa, como o leiloeiro
    // publica): 2000 ainda truncava (medido no acervo: lotes batendo exatamente no teto).
    // `extrairDescricaoDoCorpo` (api/_texto-imovel.js) já foi ao mesmo teto — sem repetir aqui
    // o corte voltaria a acontecer, só que num ponto diferente.
    descricao: (base.descricao || '').slice(0, 8000) || null,
    // "Comarca: Sorocaba Vara: 4ª Vara Cível …" — cidade quando o slug só traz o BAIRRO (Sublime).
    // 16/10: a captura do campo às vezes traz a VARA ("5ª Vara Cível") — 3 lotes de Franca saíram com
    // ela de cidade e sumiram de /leiloes. Vara não é cidade: descarta (o slug/IBGE decidem). E
    // "Franca do Estado de São Paulo" (forma do edital) vira "Franca".
    comarca: (() => {
      const c = ((txt.match(/Comarca:\s*(.{2,60}?)\s+Vara:/i) || [])[1] || '').trim()
        .replace(/\s+(?:d[oa]\s+)?Estado\s+d[eo]\s+.*$/i, '').trim();
      return c && !/\bvaras?\b|c[íi]vel|juizado|\bforo\b|^\d+\s*[ªºa]/i.test(c) ? c : null;
    })(),
    data_leilao: pracasDatadas[0]?.data || base.data_leilao || extrairData(html),
    data_leilao_2: pracasDatadas[1]?.data || null,
    numero_matricula: base.numero_matricula || null,
    link_matricula: matriculaDoc,
    link_edital_doc: editalDoc,
    anexos: anexos.length ? anexos : null,
    paginaInvalida,
  };
}

// Monta a linha compatível com imoveis_leilao (mesmos campos computados do
// salvarImoveis: ativo/viavel/score/desconto/atualizado_em).
// VEÍCULO NÃO É IMÓVEL (28/09, Sublime): o site leiloa carros no mesmo sitemap e 8 entraram em
// imoveis_leilao ("Mercedes-Benz C180 | Modelo 2015", "Lote principal" de "/lote/11-veiculos-no-
// tatuape/"). Pelo SLUG decide antes de abrir o navegador; pelo título, depois.
// Palavra INTEIRA no slug ("terreno-em-fordlandia-pa" não é Ford).
// As regras (slug, título e categoria da página) moram em lib/pecini-fila.mjs desde 24/10 (#358), testadas.

function montarRow(rec, det) {
  // Slug do Sublime às vezes é BAIRRO ("casa-na-vila-madalena") ou traz sufixo ("casa-em-jacarei-
  // cond-fechado"): a COMARCA da página manda. Foro regional da capital paulista = São Paulo/SP.
  const FOROS_SP = /^(central|penha de fran[çc]a|santo amaro|tatuap[ée]|jabaquara|lapa|pinheiros|santana|itaquera|ipiranga|vila prudente|s[ãa]o miguel paulista|nossa senhora do [óo]|butant[ãa]|parelheiros|jo[ãa]o mendes|barra funda)$/i;
  if (FONTE !== 'PECINI' && det.comarca && !rec.uf) {
    if (FOROS_SP.test(det.comarca)) { rec.cidade = 'São Paulo'; rec.uf = 'SP'; }
    else rec.cidade = det.comarca;
  } else if (FONTE !== 'PECINI' && rec.cidade) {
    rec.cidade = rec.cidade.replace(/\s+Cond(ominio)?\s+Fechado$/i, '');
  }
  const ufInferida = rec.uf ? null : inferirUF({ cidade: rec.cidade, titulo: det.titulo, descricao: det.descricao });
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  // SUBLIME (15/10): o título do site é uma linha de CARACTERÍSTICAS ("Vaga | 90m² útil", "3 dormitórios |
  // 64m² útil") e o TIPO vinha no sufixo "Apartamentos em leilão", que o parseDetalhe corta. Resultado:
  // apartamento da Vila Sônia gravado como "Vaga" e tipo `outros` (10 lotes). O slug do endereço diz o
  // que é ("/lote/apartamento-na-vila-sonia/3418/"): manda no tipo e abre o título. Slug de lote múltiplo
  // ("4-areas-em-vilhena-ro") não abre o título — cada lote tem o seu.
  const slugTxt = FONTE !== 'PECINI' ? ((rec.loteUrl || '').match(/\/lote\/([^/]+)\/\d+/) || [])[1]?.replace(/-/g, ' ') || '' : '';
  const tipoSlug = slugTxt ? inferirTipo(slugTxt) : 'outros';
  // O slug é do LEILÃO, não do lote: em leilão de vários bens ele descreve outro imóvel ("casas na praia
  // grande" sobre um terreno em Jundiaí). Por isso só entra quando o título do LOTE não diz o tipo.
  const tipoTitulo = inferirTipo(det.titulo);
  const slugTitulo = tipoTitulo === 'outros' && slugTxt && !/^\d/.test(slugTxt) && tipoSlug !== 'outros'
    ? slugTxt.replace(/\b([a-zà-ú])/g, (m) => m.toUpperCase()).replace(/\b(Na|No|Em|De|Da|Do|Das|Dos|E)\b/g, (m) => m.toLowerCase()) : '';
  const tituloBase = slugTitulo ? `${slugTitulo} | ${det.titulo.replace(/^\s*\d*\s*vagas?\s*\|\s*/i, '')}` : det.titulo;
  return {
    fonte: FONTE,
    fonte_id: `${PREFIXO}${rec.id}`,
    // Título do Sublime não diz ONDE ("Terreno de 250m² | Constr. de 150m²"): acrescenta Cidade/UF.
    titulo: (FONTE !== 'PECINI' && (rec.cidade || ufInferida?.cidade))
      ? `${tituloBase} - ${rec.cidade || ufInferida.cidade}${(rec.uf || ufInferida?.uf) ? '/' + (rec.uf || ufInferida.uf) : ''}`.slice(0, 180)
      : tituloBase,
    tipo: tipoTitulo !== 'outros' ? tipoTitulo : tipoSlug,
    modalidade: det.modalidade,
    // UF do slug; faltando (Sublime: "casa-em-campinas" não traz UF), deduz pela cidade e pelo
    // texto ("município e comarca de Atibaia - SP") com o mesmo inferirUF do motor.
    estado: (rec.uf || ufInferida?.uf || '').toString().toUpperCase().slice(0, 2) || null,
    cidade: rec.cidade || ufInferida?.cidade || null,
    valor_avaliacao: va,
    valor_minimo: vm,
    // 2 casas: "90,0485 m²" com 4 casas foi lido adiante como 485 m² (15/10).
    area_m2: det.area_m2 ? Math.round(det.area_m2 * 100) / 100 : 0,
    descricao: det.descricao,
    // Edital REAL (PDF) quando a página o expõe; senão a página do lote (comportamento atual).
    link_edital: det.link_edital_doc || rec.loteUrl,
    url_lote: rec.loteUrl,
    link_matricula: det.link_matricula || null,
    anexos: det.anexos,
    link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula,
    leiloeiro: TENANTS[FONTE].leiloeiro,
    data_leilao: det.data_leilao || null,
    ...(det.data_leilao_2 ? { data_leilao_2: det.data_leilao_2 } : {}),
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

async function main() {
  // Bright Data só no modo pago (CI); no runner RESIDENCIAL (PECINI_HEADLESS=1) o
  // Chromium real de IP de casa dispensa o proxy.
  if (!brightDataDisponivel() && !RESIDENCIAL) {
    console.error('BRIGHTDATA_API_TOKEN/ZONE ausentes — Pecini só é acessível via Web Unlocker (ou use PECINI_HEADLESS=1 num IP residencial). Abortado.');
    process.exit(1);
  }
  console.log(`PECINI ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · max ${MAX_LOTES} lote(s)/run`);

  // 1) Sitemap → enumeração (1 request). Timeout maior: o feed pode ser grande e
  //    o Web Unlocker demora a resolver Cloudflare (45s estourou na 1ª validação).
  const xml = await bd(`${BASE}/sitemap.xml`, { timeoutMs: 110000 });
  if (!xml) { console.error('sitemap.xml não veio (teto BD atingido ou erro). Abortado.'); return; }
  let lotes = parseSitemap(xml);
  console.log(`sitemap: ${lotes.length} lote(s) enumerados (com URL: ${lotes.filter(l => l.loteUrl).length}).`);
  lotes = lotes.filter(l => l.loteUrl);
  if (!lotes.length) {
    console.error('nenhuma URL de lote no sitemap — estrutura pode ter mudado. Raw[0..600]:');
    console.error(xml.slice(0, 600).replace(/\s+/g, ' '));
    return;
  }

  // PECINI_ALVO (histórico). Por que virou opção (18/08): `novos.length ? novos : lotes` significa que os lotes JÁ
  // capturados só são revisitados quando NÃO HÁ nenhum novo no sitemap. Como quase sempre há,
  // os antigos nunca eram relidos — os da PECINI estavam parados desde julho, com a metragem
  // e a matrícula que os consertos de 17/08 passaram a saber extrair, e sem nada que os fosse
  // buscar. "Rodar os antigos" não era possível pedir: era um efeito colateral de o sitemap
  // estar sem novidade. (24/10: o mesmo defeito voltou pelo outro lado — "novo" que nunca vira linha.)
  const ids = lotes.map(l => `${PREFIXO}${l.id}`);
  const visto = new Map();   // fonte_id → { atualizado_em, ativo }
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('imoveis_leilao')
      .select('fonte_id,atualizado_em,ativo').in('fonte_id', ids.slice(i, i + 200));
    // Um erro aqui NÃO pode virar "não tem nada no banco": isso reclassificaria o acervo
    // inteiro como novo e faria a rodada gastar cota recapturando o que já existe.
    if (error) { console.error(`falha ao ler o acervo (${error.message}). Abortado.`); process.exitCode = 1; return; }
    for (const r of data || []) visto.set(r.fonte_id, { atualizado_em: r.atualizado_em || null, ativo: r.ativo !== false });
  }
  // MEMÓRIA DE RECUSA (24/10, #358 — a mesma tabela do motor, #238). Lote lido e recusado nunca entra em
  // imoveis_leilao, então sem isto ele era "novo" para sempre e tomava a vaga dos imóveis já gravados.
  // Ilegível = segue sem ela (só custa leitura repetida, nunca dado errado), com o motivo no log.
  const recusados = new Set();
  const semLinha = ids.filter(id => !visto.has(id));
  for (let i = 0; i < semLinha.length; i += 200) {
    const { data, error } = await supabase.from('coleta_lote_recusado')
      .select('fonte_id').in('fonte_id', semLinha.slice(i, i + 200)).gt('rever_apos', new Date().toISOString());
    if (error) { console.log(`  ⚠️ memória de recusa ilegível — segue relendo os recusados: ${error.message}`); break; }
    for (const r of data || []) recusados.add(r.fonte_id);
  }
  // QUEM ESTE RUN VAI VISITAR — ver lib/pecini-fila.mjs (24/10, #358). PECINI_ALVO continua valendo:
  //   novos   → os que ainda não estão no banco; no caminho GRÁTIS (residencial) a vaga que sobra vai
  //             para os antigos ATIVOS, do mais velho para o mais novo; no PAGO, só cai nos antigos sem novo
  //   antigos → só os JÁ capturados (ativos), do mais desatualizado para o mais recente
  //   todos   → novos primeiro, antigos em seguida, na mesma rodada
  const plano = planejarFilaSitemap({
    lotes, noBanco: visto, recusados, prefixo: PREFIXO, maxLotes: MAX_LOTES,
    releituraLivre: RESIDENCIAL, alvo: ALVO, filtrarNaoImovel: FONTE !== 'PECINI',
  });
  const { novos, antigos } = plano;
  const alvoLotes = plano.fila;
  console.log(`no banco: ${visto.size} · novos: ${novos.length} · antigos ativos: ${antigos.length} · não-imóvel pelo endereço: ${plano.foraPeloEndereco.length}${plano.recusadosPulados ? ` · ${plano.recusadosPulados} recusado(s) há pouco, pulados` : ''} · alvo '${ALVO}' · processando: ${alvoLotes.length}`);

  // ─── SAIU DO SITE? PERGUNTE À ENUMERAÇÃO, NÃO À COLETA (18/08) ───────────────────────────
  //
  // A limpeza de encerrados (`desativar_imoveis_leiloeiro_stale`) desativa o que "não veio na
  // última coleta". Isso funciona para coletor de PASSADA COMPLETA, mas aqui a coleta visita
  // 4–6 lotes por rodada de propósito (cota do Bright Data): quase todo o acervo fica "não
  // visto" por construção, e a fonte é pulada para sempre — 58 lotes esperando.
  //
  // A resposta certa não vem da coleta: vem do SITEMAP, que enumera o acervo INTEIRO em UMA
  // requisição, sem visitar lote nenhum. Lote ativo no banco que o sitemap não lista saiu do
  // site — isso é medição, não silêncio.
  //
  // O PISO É ABSOLUTO E ISSO É UMA DÍVIDA CONSCIENTE. O CLAUDE.md manda deixar o histórico
  // aprender os pisos, e é o certo — mas `fonte_baseline_aprendida()` aprende do total
  // COLETADO (4–6 aqui), que não descreve a enumeração (52). Misturar os dois corromperia o
  // baseline das duas medidas. Até existir histórico de ENUMERAÇÃO, o piso fica explícito aqui
  // e o número enumerado vai para o log de toda rodada, que é de onde esse histórico sai.
  const PISO_ENUMERACAO = 40;   // fallback sem histórico (observado: 52). Sitemap quebrado devolve 0 ou punhado.
  // 24/10 (#277): o piso fixo virou dívida paga — o sitemap da PECINI encolheu para 38–43 e a varredura era
  // pulada quase todo dia. Agora o piso é RELATIVO ao que o próprio sitemap enumerou nas últimas rodadas
  // (`fonte_saude.enumerados`, ver lib/sweep-trava.mjs); o fixo só vale sem histórico legível.
  const { data: histEnum, error: eHist } = await supabase.from('fonte_saude').select('enumerados')
    .eq('fonte', FONTE).not('enumerados', 'is', null).order('executado_em', { ascending: false }).limit(10);
  if (eHist) console.error(`  histórico de enumeração ilegível (${eHist.message}) — piso fixo ${PISO_ENUMERACAO}.`);
  const { piso: pisoEnum, via: viaPiso } = pisoEnumeracao(eHist ? [] : histEnum, PISO_ENUMERACAO);
  if (!DRYRUN && lotes.length >= pisoEnum) {
    const noSitemap = new Set(lotes.map(l => `${PREFIXO}${l.id}`));
    const { data: ativosNoBanco, error: eAtivos } = await supabase
      .from('imoveis_leilao').select('fonte_id,resultado_leilao,resultado_apurado_em').eq('fonte', FONTE).eq('ativo', true);
    if (eAtivos) {
      console.error(`  não consegui ler os ativos para a varredura (${eAtivos.message}) — sweep PULADO.`);
    } else {
      // LEILÃO NEGATIVO FICA 15 DIAS (regra do dono, mesma de salvarEFinalizar/desativar_leiloes_encerrados):
      // "sem lance" apurado há < 15 dias continua ativo para a proposta de compra, mesmo fora do sitemap.
      const janela = Date.now() - 15 * 864e5;
      const retido = (r) => ['sem_lance', 'indeterminado'].includes(r.resultado_leilao) && Date.parse(r.resultado_apurado_em || 0) > janela;
      const sumiram = (ativosNoBanco || []).filter(r => !noSitemap.has(r.fonte_id) && !retido(r)).map(r => r.fonte_id);
      if (demaisParaUmaRodada(sumiram.length, (ativosNoBanco || []).length)) {
        console.error(`  🛑 ${sumiram.length} de ${(ativosNoBanco || []).length} ativos fora do sitemap de uma vez — demais para uma rodada, NÃO desligados (conferir o sitemap).`);
      } else if (sumiram.length) {
        const { data: desativados, error: eDesat } = await supabase
          .from('imoveis_leilao').update({ ativo: false, suprimido_motivo: 'sumiu_da_fonte' }).in('fonte_id', sumiram).eq('ativo', true).select('fonte_id');
        // `.select()` de propósito: update que a RLS/filtro não alcança devolve error null e
        // zero linha — sem isto, "desativei 58" seria afirmação sem prova (CLAUDE.md, forma 3).
        if (eDesat) console.error(`  falha ao desativar os que sumiram do sitemap: ${eDesat.message}`);
        else console.log(`  🔻 ${(desativados || []).length} lote(s) desativado(s): ativos no banco e AUSENTES do sitemap (${lotes.length} enumerados; piso ${pisoEnum}, ${viaPiso}).`);
      } else {
        console.log(`  ✓ nenhum lote ativo fora do sitemap (${lotes.length} enumerados).`);
      }
    }
  } else if (!DRYRUN) {
    console.error(`  ⚠️ sitemap enumerou ${lotes.length} (< piso ${pisoEnum}, ${viaPiso}) — varredura de ausentes PULADA para não zerar a fonte por parse quebrado.`);
  }
  if (!alvoLotes.length) {
    console.error(`nenhum lote na fila para alvo='${ALVO}'. Nada a fazer.`);
    process.exitCode = 1;
    return;
  }

  // 2) Detalhe de cada lote alvo.
  const prontos = [];
  let semDetalhe = 0, reprovados = 0;
  const recusas = [];   // { fonte_id, motivo, dias } — só de lote NOVO (o antigo já tem linha e não volta como novo)
  const naoImovelIds = [...plano.naoImovelNoAcervo];   // gravados como imóvel e que não são: saem do acervo
  for (let i = 0; i < alvoLotes.length; i++) {
    const rec = alvoLotes[i];
    const fonteId = `${PREFIXO}${rec.id}`;
    const ehNovo = i < plano.iReleitura;
    if (recusaDeCota) { semDetalhe++; continue; }   // o freio já disse não: insistir só repete a recusa
    const html = await bd(rec.loteUrl);
    if (!html) { semDetalhe++; console.log(`- ${rec.id}: detalhe não veio`); continue; }
    const det = parseDetalhe(html, rec);
    if (det.paginaInvalida) { semDetalhe++; console.log(`- ${rec.id}: página genérica/sem lote (pulado)`); continue; }
    if (FONTE !== 'PECINI' && naoImovelPelaPagina(rec.loteUrl, det.titulo, det.tituloCru)) {
      reprovados++; console.log(`  ${rec.id} · DESCARTADO(não-imóvel — pelo título/categoria da página)`);
      if (ehNovo) recusas.push({ fonte_id: fonteId, motivo: 'nao_imovel', dias: 30 });
      else naoImovelIds.push(fonteId);
      continue;
    }
    const row = montarRow(rec, det);
    const q = checarQualidade(row, { estrito: false });
    console.log(`  ${rec.id} ${rec.cidade || '?'}/${rec.uf || '?'} · aval R$${row.valor_avaliacao} · min R$${row.valor_minimo} · desc ${row.desconto_percentual ?? '?'}% · foto ${row.link_foto ? 'sim' : 'NÃO'} · ${row.modalidade}${ehNovo ? '' : ' · releitura'}${q.descartar ? ' · DESCARTADO(' + q.faltando.join(',') + ')' : (q.faltando.length ? ' · faltando ' + q.faltando.join(',') : ' · OK')}`);
    if (q.descartar) {
      reprovados++;
      // Sem valor/data pode ser temporário (o site publica depois): volta à fila em 10 dias, como no motor.
      if (ehNovo) recusas.push({ fonte_id: fonteId, motivo: `descartado: ${(q.faltando || []).join(', ').slice(0, 120)}`, dias: 10 });
      continue;
    }
    prontos.push(row);
    await sleep(400); // gentileza entre requisições
  }
  const relidos = prontos.filter(r => visto.has(r.fonte_id)).length;
  console.log(`  (${relidos} dos prontos são releitura de lote já gravado)`);

  // Grava ANTES do "nada pronto" lá embaixo: uma rodada só de recusas é exatamente a que precisa lembrar delas.
  if (!DRYRUN && recusas.length) {
    const agora = Date.now();
    const linhas = [...new Map(recusas.map(r => [r.fonte_id, { fonte_id: r.fonte_id, fonte: FONTE, motivo: r.motivo,
      visto_em: new Date(agora).toISOString(), rever_apos: new Date(agora + r.dias * 864e5).toISOString() }])).values()];
    const { error: eRec } = await supabase.from('coleta_lote_recusado').upsert(linhas, { onConflict: 'fonte_id' });
    if (eRec) console.error(`  não gravei a memória de ${linhas.length} recusa(s) — serão relidas na próxima rodada: ${eRec.message}`);
    else console.log(`  ${linhas.length} recusa(s) lembradas — fora da fila até o prazo (não-imóvel 30 d, descarte 10 d).`);
  } else if (recusas.length) console.log(`  DRY-RUN: ${recusas.length} recusa(s) seriam lembradas: ${recusas.map(r => r.fonte_id).join(', ')}`);
  // Lote JÁ GRAVADO que é veículo/máquina (pelo endereço ou pela página): sai com motivo, como no motor
  // (o gatilho de gemeos_hasta_cef.sql segura a ressurreição de linha com suprimido_motivo). `.select()` prova.
  if (naoImovelIds.length && !DRYRUN) {
    const { data: saiu, error: eNi } = await supabase.from('imoveis_leilao')
      .update({ ativo: false, suprimido_motivo: 'nao_imovel' }).in('fonte_id', [...new Set(naoImovelIds)]).eq('ativo', true).select('fonte_id');
    if (eNi) console.error(`  não consegui retirar os não-imóveis: ${eNi.message}`);
    else console.log(`  🚗 ${(saiu || []).length} lote(s) gravados como imóvel e que são veículo/máquina retirados: ${(saiu || []).map(r => r.fonte_id).join(', ')}`);
  } else if (naoImovelIds.length) console.log(`  DRY-RUN: retiraria do acervo (não-imóvel): ${[...new Set(naoImovelIds)].join(', ')}`);

  console.log(`\nResumo: ${prontos.length} prontos · ${reprovados} descartados · ${semDetalhe} sem detalhe.`);
  // "Não coletei porque o orçamento disse não" é uma frase diferente de "a fonte não tinha nada",
  // e elas não podem sair iguais do mesmo lugar (CLAUDE.md, forma 5).
  if (recusaDeCota) console.log(`⛔ PAROU POR COTA: ${recusaDeCota} — ${semDetalhe} lote(s) ficaram para a próxima rodada.`);
  // Zero pronto não é "a fonte está vazia" — é coleta quebrada até prova em contrário.
  // Sai com erro E deixa a linha em `fonte_saude`: sem isso a fonte some do monitor
  // (nenhuma linha nova) e o acervo encolhe em silêncio. Ver scraper-rj.mjs, 11/08.
  if (AMOSTRAS_RENDER.length) {
    const { error: eA } = await supabase.from('recon_dump').insert({ origem: 'pecini-render', chave: FONTE, conteudo: { amostras: AMOSTRAS_RENDER } });
    console.log(`amostra do renderizado (${AMOSTRAS_RENDER.length} lotes) ${eA ? `NÃO gravada: ${eA.message}` : 'gravada em recon_dump (pecini-render)'}`);
  }
  if (!prontos.length) {
    // `semCota` NO CAMPO, não só na prosa (29/08). O motivo já dizia "sem cota: …" — mas
    // quem lê o estado da fonte é o STATUS, e sem esta flag `registrarSaude` gravava
    // 'falhou': o monitor acusava o leiloeiro por uma decisão de orçamento nossa. Aconteceu
    // em 19/08 (`reservado_para_outros`, 1 linha). É a forma #5 do CLAUDE.md — o freio de
    // custo tem de dizer QUAL "não", e dizer no lugar em que alguém escuta.
    await registrarSaude(supabase, FONTE, [], 'principal',
      { ok: false, semCota: !!recusaDeCota,
        metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        enumerados: lotes.length,
        motivo: recusaDeCota
          ? `SEM COTA Bright Data (${recusaDeCota}) — coleta não tentada (decisão de orçamento, não regressão da fonte); ${semDetalhe} sem detalhe, ${reprovados} reprovados`
          : `nada pronto (${semDetalhe} sem detalhe, ${reprovados} reprovados)` });
    console.error('nada a gravar. Saindo com erro para não carimbar coleta que não coletou.');
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra do que inseriria:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log(`\nPara gravar de verdade, rode com PECINI_DRYRUN=0.`);
    return;
  }

  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis ${FONTE} gravados/atualizados.`);
  // SAÚDE DA FONTE (08/08): entra no monitor de regressão junto das demais. Antes esta fonte
  // não escrevia em `fonte_saude`, então nunca ganhava piso aprendido e uma quebra passaria batido.
  // 19/08 (paga a dívida do "piso ABSOLUTO"): a PECINI só visita lotes NOVOS, então `total`
  // por run é 4-6 e a mediana nunca alcança o gate de baseline — ficava presa no piso fixo
  // para sempre. `enumerados` = o sitemap INTEIRO (o que a fonte LISTA), que é o número que
  // a regressão deve vigiar; com ~3 runs gravando isto, o piso aprendido assume sozinho.
  await registrarSaude(supabase, FONTE, prontos, 'principal', { enumerados: lotes.length });
  // Auto-aprendizado: registra o que este scraper sabe na base de conhecimento.
  await registrarConhecimento(supabase, {
    // `acesso`/`custo` são o caminho que ESTA execução usou, não o que o scraper sabe fazer:
    // gravar 'pago' numa coleta residencial é o instrumento reportando outra coisa (forma #10).
    fonte: FONTE, plataforma: 'ASP.NET-DefaultClean',
    acesso: RESIDENCIAL ? 'residencial' : 'brightdata', custo: RESIDENCIAL ? 'gratis' : 'pago',
    anti_bot: 'cloudflare', enumeracao: 'sitemap', url_lote: '/lote/{slug}/{id}/',
    scraper: 'scraper-pecini.mjs', qualidade: qualidadeColeta(prontos),
  });
}

// Qual caminho serviu esta execução. Sem este número, "o Chromium nunca precisou entrar" e
// "o Chromium entrou em tudo" ficam idênticos no log — e a segunda é o sinal de que o site
// endureceu, que é justamente o que a rede de segurança existe para não esconder.
function logPlacarResidencial(tag) {
  const p = estatisticaResidencial();
  if (p.fetch + p.navegador + p.falha === 0) return;   // rodou pelo caminho pago: nada a dizer
  console.log(`  🏠 [${tag}] caminho residencial: ${p.fetch} por fetch puro · ${p.navegador} pelo Chromium (rede de segurança) · ${p.falha} sem resposta`);
}

// `process.exit(0)` FIXO apagava o `process.exitCode = 1` que o caminho "nada a gravar"
// acabara de definir — a coleta falhava e o processo saía verde mesmo assim. Agora o
// código de saída é o que o main decidiu (0 por padrão, 1 quando não coletou nada).

main()
  .then(() => { logPlacarResidencial(FONTE); return fecharHeadless().finally(() => process.exit(process.exitCode || 0)); })
  .catch(e => { console.error(e); logPlacarResidencial(FONTE); fecharHeadless().finally(() => process.exit(1)); });
