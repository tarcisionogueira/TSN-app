/**
 * Scraper MULTI-TENANT da plataforma SOLEON — imóveis de vários leiloeiros do backlog
 * TRT-15 que rodam a MESMA base white-label (Bootstrap 4.1.3 + soleon.s3 + /lotes/…).
 * ────────────────────────────────────────────────────────────────────────────
 * Por que existe: o recon (23/07) classificou calil/vegas/3torres como a MESMA
 * plataforma que o RJ Leilões (scripts/scraper-rj.mjs) — cujo parser já é validado em
 * produção. Aqui GENERALIZAMOS aquele parser p/ N tenants, um `fonte`/`leiloeiro` por
 * domínio (catálogos independentes; NÃO é backend compartilhado como o cluster PHP).
 *
 * ECONOMIA ("grátis primeiro"): só o 3torres está atrás de Cloudflare. Então cada fetch
 * tenta a via GRÁTIS (fetch direto, egress do Actions) e SÓ cai no Bright Data Web
 * Unlocker (pago, com teto) quando barrado/challenge. calil/vegas custam ~US$0.
 *
 * SEGURANÇA DE CUSTO:
 *   - SOLEON_MAX_LOTES (default 40): teto de lotes NOVOS por execução (por tenant).
 *   - SOLEON_DRYRUN (default '1'): NÃO grava — busca, parseia e LOGA o que inseriria.
 *   - SOLEON_DEBUG  (default '0'): dumpa a estrutura (listagem + 1 detalhe/tenant) p/
 *     confirmar os padrões de URL e o parser ANTES de gravar (método recon-first).
 *   - Bright Data via buscarViaBrightData(proposito='soleon') → sub-cota + teto global.
 *   - SOLEON_TENANTS: csv de fontes p/ rodar um subconjunto (ex.: "CALIL,VEGAS").
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
// NOTA (11/08, REVISTA EM 12/08): a decisão anterior era manter o `null` do
// `fetchViaBrightData` como fallback deliberado — grátis primeiro, pago como segunda
// chance. O fallback continua certo; o `null` é que era cego. Em 12/08 a cota semanal
// saturou e as três fontes foram para o `fonte_saude` como
// "REGRESSÃO: caiu de 6 para 0" — mandando procurar um bug de parser que não existia,
// quando a ação correta era liberar orçamento. Agora usa `buscarViaBrightData`, que LANÇA
// com o motivo, e o `semCota` chega até o registro de saúde.
// Segue valendo o resto: coleta com zero lote sai com código 1 e grava 'falhou', e o gate
// só carimba "coletei" com linha no acervo.
import { buscarViaBrightData, ErroBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { extrairGenerico, extrairData, checarQualidade } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';

// Tenants SOLEON confirmados no recon (23/07). fonte = chave única no acervo/monitor;
// o baseline auto-aprendido (monitor-fontes-cron) passa a vigiar cada um após alguns runs.
const TODOS_TENANTS = [
  { fonte: 'CALIL',   leiloeiro: 'Calil Leilões',    base: 'https://www.calilleiloes.com.br' },
  { fonte: 'VEGAS',   leiloeiro: 'Vegas Leilões',    base: 'https://www.vegasleiloes.com.br' },
  { fonte: 'TORRES3', leiloeiro: '3 Torres Leilões', base: 'https://www.3torresleiloes.com.br' },
];
const filtro = (process.env.SOLEON_TENANTS || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
const TENANTS = filtro.length ? TODOS_TENANTS.filter(t => filtro.includes(t.fonte)) : TODOS_TENANTS;

const MAX_LOTES = Number(process.env.SOLEON_MAX_LOTES || 40);
const MAX_PAGES = Number(process.env.SOLEON_MAX_PAGES || 6);
const DRYRUN = process.env.SOLEON_DRYRUN !== '0';
const DEBUG = process.env.SOLEON_DEBUG === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Cidade/UF robusta: 1º pelo rótulo estruturado do SOLEON ("Cidade: X/UF"); 2º "…em X/UF"
// pegando só 1-3 palavras antes da /UF (evita frases inteiras como "comercial no Centro de
// Vitoria" que o regex ganancioso capturava). estado sempre pela sigla após a barra.
function cidadeUF(txt, titulo = '') {
  const fonte = `${titulo} ${txt}`;
  let m = fonte.match(/\bCidade:\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]{1,28}?)\s*[\/-]\s*([A-Z]{2})\b/i);
  if (!m) m = fonte.match(/\b(?:em|de|no|na)\s+([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,2})\s*\/\s*([A-Z]{2})\b/);
  if (!m) m = fonte.match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,2})\s*\/\s*([A-Z]{2})\b/);
  if (!m) return { cidade: null, estado: null };
  return { cidade: m[1].trim().replace(/\s+/g, ' ').slice(0, 60), estado: (m[2] || '').toUpperCase() || null };
}

// Título sem o "sufixo de preço" que o og:title do SOLEON cola ("… - Lance Inicial: R$…").
function limparTitulo(t) {
  return (t || '').replace(/\s*[-–]\s*(?:Lance Inicial|Avalia[çc][ãa]o|Valor)\b.*$/i, '').replace(/\s+/g, ' ').trim();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const ehChallenge = h => !h || /just a moment|challenge-platform|cf-chl|cf-mitigated|attention required/i.test(h.slice(0, 4000));

// Fetch "grátis primeiro": tenta direto (egress do Actions); se barrado/challenge/erro,
// cai no Web Unlocker (pago, com teto). Retorna { html, via } ou { html:null }.
async function fetchTenant(url, { timeoutMs = 45000 } = {}) {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 20000);
    const r = await fetch(url, { signal: c.signal, headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9', 'Accept': 'text/html,application/xhtml+xml' } });
    clearTimeout(t);
    if (r.ok) {
      const html = await r.text().catch(() => '');
      if (html && !ehChallenge(html)) return { html, via: 'gratis' };
    }
  } catch { /* cai p/ Bright Data */ }
  // Runner RESIDENCIAL (SOLEON_NO_BD=1): o fetch direto já funciona do IP residencial (o SOLEON
  // bloqueia só datacenter, não tem Cloudflare) → NUNCA cair no Bright Data. Pula a página se
  // por acaso o direto falhar (evita gasto surpresa de BD numa coleta que deveria ser grátis).
  if (process.env.SOLEON_NO_BD === '1') return { html: null, via: 'sem-bd' };
  // `buscarViaBrightData` (que LANÇA com o motivo) no lugar do `fetchViaBrightData` (que
  // devolve null para quatro causas diferentes). Motivo, medido em 12/08: a cota semanal
  // saturou (450/450, com a reserva do 'rj' derrubando o teto efetivo dos demais para 420),
  // as três fontes saíram com 0 lotes em 0,6 s e foram gravadas como
  // "REGRESSÃO: caiu de 6 para 0" — decisão de ORÇAMENTO lida como quebra do leiloeiro.
  // É a forma #5 do CLAUDE.md, e aqui ela contaminava o próprio painel de saúde.
  try {
    const bd = await buscarViaBrightData(url, { proposito: 'soleon', timeoutMs, exigirOk: false });
    if (!bd.ok) return { html: null, via: 'bloqueado' };
    const html = await bd.text().catch(() => null);
    return { html, via: 'brightdata' };
  } catch (e) {
    if (e instanceof ErroBrightData) {
      // `semCota` = o sistema decidiu não gastar. Não é o site que mudou.
      return { html: null, via: e.semCota ? 'sem-cota' : 'bloqueado', semCota: !!e.semCota, motivoBD: e.motivo };
    }
    throw e;
  }
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

// Detalhe do lote no SOLEON: /item/{id}/detalhes (padrão do RJ). Aceita variações
// (/lote/{id}, /lotes/{...}/{id}) como salvaguarda — o DEBUG confirma o real por tenant.
function extrairUrlsDeLote(html, base) {
  const urls = new Map(); // id → url absoluta (dedup por id)
  for (const m of html.matchAll(/\/item\/(\d+)\/detalhes/gi)) urls.set(m[1], `${base}/item/${m[1]}/detalhes`);
  if (!urls.size) for (const m of html.matchAll(/href=["'](\/lote\/(\d+)(?:\/[^"']*)?)["']/gi)) urls.set(m[2], new URL(m[1], base).href);
  if (!urls.size) for (const m of html.matchAll(/href=["'](\/lotes\/[^"']*?\/(\d+))["']/gi)) urls.set(m[2], new URL(m[1], base).href);
  return [...urls.values()];
}

function idDaUrl(url) {
  const m = String(url).match(/\/item\/(\d+)/i) || String(url).match(/\/(\d+)(?:\/(?:detalhes)?)?$/);
  return m ? m[1] : String(url).replace(/[?#].*/, '').split('/').filter(Boolean).pop();
}

// Parser SOLEON (idêntico em espírito ao scraper-rj.mjs, validado em produção):
// preços pelos RÓTULOS ("Lance Inicial", "Valor de Avaliação") p/ não pegar
// Incremento/Comissão; fallbacks robustos; cidade/UF por "CIDADE/UF".
function parseDetalhe(html, url) {
  const base = extrairGenerico(html, url) || {};
  const txt = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ');

  const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;
  const rotLance = plaus(num((txt.match(/lance\s*(?:inicial|m[íi]nimo|atual)[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const rotAval = plaus(num((txt.match(/avalia[çc][ãa]o[^R]{0,25}R\$\s*([\d.]+,\d{2})/i) || [])[1]));
  const grandes = [...txt.matchAll(/R\$\s*([\d.]+,\d{2})/g)].map(m => num(m[1])).filter(v => v >= 10000 && v <= 500_000_000);
  const avaliacao = rotAval || (grandes.length ? Math.max(...grandes) : 0);
  let valorMinimo = rotLance;
  if (!valorMinimo && grandes.length) {
    const semAval = grandes.filter(v => v !== avaliacao);
    valorMinimo = semAval.length ? Math.min(...semAval) : avaliacao;
  }

  const modalidade = /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : /extrajudicial/i.test(txt) ? 'extrajudicial'
    : /venda\s*direta/i.test(txt) ? 'venda_direta' : 'extrajudicial';
  const area = num((txt.match(/([\d.]+,\d{2}|\d+)\s*m²/i) || [])[1]);
  const { cidade, estado } = cidadeUF(txt, base.titulo || '');
  const mat = (txt.match(/matr[íi]cula[^\d]{0,20}([\d.\-\/]{2,})/i) || [])[1] || null;

  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1]; const label = (m[2] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label)) {
      let abs; try { abs = new URL(href, url).href; } catch { continue; }
      docs.push({ url: abs, label: label.slice(0, 60) });
    }
  }
  const findDoc = re => (docs.find(d => re.test(d.label) || re.test(d.url)) || {}).url || null;
  const anexos = docs.map(d => ({ tipo: /matr[íi]cula/i.test(d.label + d.url) ? 'matricula' : (/edital/i.test(d.label + d.url) ? 'edital' : (/laudo/i.test(d.label + d.url) ? 'laudo' : 'outro')), nome: (d.label || 'Documento').slice(0, 80), url: d.url }));

  return {
    titulo: limparTitulo(base.titulo).slice(0, 180) || null,
    cidade, estado,
    link_foto: base.link_foto,
    valor_avaliacao: avaliacao, valor_minimo: valorMinimo,
    modalidade, area_m2: area,
    descricao: (base.descricao || '').slice(0, 500) || null,
    data_leilao: base.data_leilao || extrairData(html),
    numero_matricula: mat,
    link_edital: findDoc(/edital/i), link_matricula: findDoc(/matr[íi]cula/i),
    anexos,
  };
}

function montarRow(tenant, url, det) {
  const va = det.valor_avaliacao || 0, vm = det.valor_minimo || 0;
  const id = idDaUrl(url);
  return {
    fonte: tenant.fonte,
    fonte_id: `${tenant.fonte.toLowerCase()}_${id}`,
    titulo: det.titulo || `Imóvel ${tenant.leiloeiro} ${id}`,
    tipo: inferirTipo(det.titulo || ''),
    modalidade: det.modalidade,
    cidade: det.cidade || null,
    estado: det.estado || null,
    valor_avaliacao: va, valor_minimo: vm,
    area_m2: det.area_m2 || 0,
    descricao: det.descricao,
    link_edital: det.link_edital || url,
    url_lote: url,
    link_foto: det.link_foto || null,
    numero_matricula: det.numero_matricula, link_matricula: det.link_matricula,
    anexos: det.anexos,
    leiloeiro: tenant.leiloeiro,
    data_leilao: det.data_leilao || null,
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// Enumera lotes de imóveis de um tenant: listagem /lotes/imovel paginada (+ salvaguardas).
// Tenants cuja coleta parou por decisão de ORÇAMENTO (cota Bright Data), não por mudança
// no site. A diferença decide se `fonte_saude` recebe "regressão" ou "sem cota".
const SEM_COTA = new Set();

async function enumerarLotes(tenant) {
  const setUrls = new Set();
  let via = null;
  for (let p = 1; p <= MAX_PAGES; p++) {
    // Listagem de imóveis do SOLEON: /lotes/imovel (pág 1) e ?tipo=imovel&page=N (2+).
    const url = `${tenant.base}/lotes/imovel${p > 1 ? `?tipo=imovel&page=${p}` : ''}`;
    const { html, via: v, semCota } = await fetchTenant(url);
    if (semCota) SEM_COTA.add(tenant.fonte);
    if (!html) break;
    via = via || v;
    const antes = setUrls.size;
    for (const u of extrairUrlsDeLote(html, tenant.base)) setUrls.add(u);
    if (DEBUG) console.log(`   [${tenant.fonte}] pág ${p} (${v}): +${setUrls.size - antes} (total ${setUrls.size})`);
    if (setUrls.size === antes) break;
    await sleep(400);
  }
  return { urls: [...setUrls], via };
}

async function debugRecon() {
  console.log('🔎 SOLEON RECON — confirma padrões de URL + parser por tenant\n');
  for (const tenant of TENANTS) {
    console.log(`\n════ ${tenant.fonte} (${tenant.base})`);
    const lista = `${tenant.base}/lotes/imovel`;
    const { html, via } = await fetchTenant(lista);
    if (!html) { console.log('  listagem não veio (challenge/teto).'); continue; }
    console.log(`  listagem via ${via}, ${html.length} bytes`);
    // Dumpa TODOS os hrefs candidatos p/ ver o padrão real do lote deste tenant.
    const hrefs = [...new Set([...html.matchAll(/href=["'](\/(?:item|lote|lotes)\/[^"']+)["']/gi)].map(m => m[1]))].slice(0, 20);
    console.log(`  hrefs item/lote (${hrefs.length}): ${JSON.stringify(hrefs)}`);
    const lotes = extrairUrlsDeLote(html, tenant.base);
    console.log(`  extrairUrlsDeLote → ${lotes.length}: ${JSON.stringify(lotes.slice(0, 6))}`);
    const alvo = lotes[0];
    if (alvo) {
      const { html: dh, via: dv } = await fetchTenant(alvo);
      if (dh) {
        const det = parseDetalhe(dh, alvo);
        console.log(`  ── detalhe ${alvo} (via ${dv})`);
        console.log('     parseDetalhe →', JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }));
        const t = dh.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        console.log('     R$ ctx:', JSON.stringify([...t.matchAll(/.{0,40}R\$\s*[\d.]+,\d{2}/g)].map(m => m[0].trim()).slice(0, 8)));
      }
    }
    await sleep(500);
  }
  console.log('\n✅ RECON concluído.');
}

async function coletarTenant(tenant) {
  const { urls, via } = await enumerarLotes(tenant);
  if (!urls.length) { console.log(`  [${tenant.fonte}] 0 lotes enumerados (via ${via}). Pulando.`); return []; }
  const ids = urls.map(u => `${tenant.fonte.toLowerCase()}_${idDaUrl(u)}`);
  const existentes = new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await supabase.from('imoveis_leilao').select('fonte_id').in('fonte_id', ids.slice(i, i + 200));
    for (const r of data || []) existentes.add(r.fonte_id);
  }
  const novos = urls.filter(u => !existentes.has(`${tenant.fonte.toLowerCase()}_${idDaUrl(u)}`));
  const alvo = (novos.length ? novos : urls).slice(0, MAX_LOTES);
  console.log(`  [${tenant.fonte}] via ${via} · enumerados ${urls.length} · no banco ${existentes.size} · novos ${novos.length} · processando ${alvo.length}`);

  const prontos = [];
  let sem = 0, reprov = 0;
  for (const url of alvo) {
    const { html } = await fetchTenant(url);
    if (!html) { sem++; continue; }
    const row = montarRow(tenant, url, parseDetalhe(html, url));
    const q = checarQualidade(row, { estrito: false });
    if (q.descartar) { reprov++; continue; }
    prontos.push(row);
    await sleep(350);
  }
  console.log(`  [${tenant.fonte}] ${prontos.length} prontos · ${reprov} descartados · ${sem} sem detalhe`);
  return prontos;
}

async function main() {
  if (DEBUG) {
    if (!brightDataDisponivel()) console.log('(aviso: Bright Data ausente — só a via grátis será tentada)');
    await debugRecon();
    return;
  }
  console.log(`SOLEON ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · tenants: ${TENANTS.map(t => t.fonte).join(', ')} · max ${MAX_LOTES}/tenant`);
  const prontos = [];
  for (const tenant of TENANTS) prontos.push(...await coletarTenant(tenant));

  console.log(`\nTotal: ${prontos.length} imóveis prontos.`);
  // Coleta que não coletou NADA não é sucesso — é falha que ainda não sabe que falhou.
  // Sair com 0 aqui engana três consumidores de uma vez: o check do GitHub, o `rodar()`
  // do runner residencial (que carimbava o gate) e o freio de custo, que passava a
  // bloquear o caminho pago. Foi assim que o RJ ficou 12 dias congelado, tudo verde.
  if (!prontos.length) {
    // "Não coletei porque a cota acabou" e "não coletei porque o site mudou" exigem AÇÕES
    // OPOSTAS (liberar orçamento × consertar parser). Gravar o primeiro como o segundo põe o
    // leiloeiro no banco dos réus e manda alguém procurar um bug que não existe — foi o que
    // aconteceu com CALIL, VEGAS e TORRES3 em 12/08.
    for (const tenant of TENANTS) {
      const semCota = SEM_COTA.has(tenant.fonte);
      await registrarSaude(supabase, tenant.fonte, [], 'soleon', {
        ok: false,
        semCota,
        metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: semCota
          ? 'SEM COTA Bright Data — coleta não tentada (decisão de orçamento, não regressão da fonte)'
          : 'execução sem nenhum lote pronto',
      });
    }
    if (SEM_COTA.size) {
      console.error(`sem cota Bright Data para: ${[...SEM_COTA].join(', ')} — orçamento, não regressão. Saindo com erro.`);
    } else {
      console.error('nada a gravar — nenhum tenant devolveu lote. Saindo com erro.');
    }
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log('\nPara gravar, rode com SOLEON_DRYRUN=0.');
    return;
  }
  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis SOLEON gravados/atualizados.`);
  // Auto-aprendizado por tenant.
  for (const tenant of TENANTS) {
    const rows = prontos.filter(r => r.fonte === tenant.fonte);
    // SAÚDE POR TENANT (08/08): CALIL, VEGAS e 3 TORRES compartilham a plataforma Soleon mas são
    // fontes SEPARADAS no acervo — cada uma precisa da sua linha, senão o piso aprendido de uma
    // esconde a quebra da outra. As três estavam fora do monitor.
    //
    // O `if (!rows.length) continue` saía ANTES desta linha (corrigido 11/08): o tenant que
    // coletava zero era justamente o que não deixava rastro — o único caso em que o monitor
    // precisava de uma linha, e era o único em que ela não vinha. TORRES3 está com 1 lote ativo.
    await registrarSaude(supabase, tenant.fonte, rows, 'soleon',
      rows.length ? undefined : {
        ok: false,
        semCota: SEM_COTA.has(tenant.fonte),
        metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: SEM_COTA.has(tenant.fonte)
          ? 'SEM COTA Bright Data — coleta não tentada (decisão de orçamento, não regressão da fonte)'
          : 'tenant sem lote nesta execução',
      });
    if (!rows.length) continue;
    await registrarConhecimento(supabase, {
      fonte: tenant.fonte, plataforma: 'SOLEON', acesso: 'gratis+brightdata', custo: 'misto',
      anti_bot: 'cloudflare_parcial', enumeracao: 'listagem_paginada', url_lote: '/item/{id}/detalhes',
      scraper: 'scraper-soleon.mjs', qualidade: qualidadeColeta(rows),
    });
  }
}

main().catch(e => { console.error(e); process.exit(1); });
