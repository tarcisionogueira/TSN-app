/**
 * Scraper do SATO LEILÕES (satoleiloes.com.br) — via API pública JSON.
 * ────────────────────────────────────────────────────────────────────────────
 * FONTE DE VERDADE: recon Round 35 (debug_fetch, fontes 'ofv35-sato-%', 30/07/2026).
 * O site é um SPA Quasar/Vue (zero <a href> de lote no HTML renderizado; cards
 * `q-card cursor-pointer` com handler JS). A home consome:
 *
 *   GET https://www.satoleiloes.com.br/api-publica/stale/dados-home?page=N&type=leilao
 *
 * → responde um ARRAY JSON de LEILÕES (não lotes), 15 por página (`rn` é um
 *   row-number global: pág 1 = rn 1..15, pág 2 = 16..30, pág 5 = 61..75…).
 *   Fim da paginação NÃO capturado no recon → paginamos até vir array vazio /
 *   repetido, com teto SATO_MAX_PAGES.
 *
 * Shape confirmado de cada leilão (campos usados):
 *   id, titulo ("CASA 93M² | SÃO LEOPOLDO/RS | ALIENAÇÃO FIDUCIÁRIA"),
 *   descricao ("Local: São Leopoldo/RS"), data_hora_inicio,
 *   data_hora_inicio_segundo_leilao, dois_leiloes, primeiro_leilao_concluido,
 *   segundo_leilao_concluido, venda_direta, lotes_count, lotes_vendidos,
 *   menorlanceInicial, menorlanceInicialSegLeilao, lanceInicialPrimeiroLote,
 *   lanceInicialSegLeilaoPrimeiroLote, link_parceiro, externo,
 *   status_leilao { identificador: 'ABERTO', arquivado, completo, suspenso… },
 *   imagens_leilao[0].arquivo.leilaoAbertoUrl.{x1,x2,x4,x8} (URL assinada),
 *   comitente { nome_fantasia }.
 *
 * O QUE O RECON NÃO CAPTUROU (TODOs no código):
 *   - endpoint de DETALHE/LOTES de um leilão (leilões multi-lote "IMÓVEIS | SP |
 *     MG…" têm lotes_count>1 e nenhum dado por lote no dados-home) → por ora só
 *     gravamos leilões com lotes_count === 1 (o leilão É o lote);
 *   - a rota pública da página do leilão no site (SPA sem hrefs) → usamos o
 *     palpite /leilao/{id} como url_lote; o 1º run real valida.
 *
 * O catálogo é MISTO (imóveis + veículos + sucata + equipamentos) → guard duplo:
 * precisa PARECER imóvel E não bater na lista de exclusão (veículo/equipamento/
 * parte ideal/direito creditório — padrão do repo).
 *
 * SEGURANÇA DE CUSTO/ACERVO:
 *   - SATO_DRYRUN (default '1'): NÃO grava — busca, parseia e loga.
 *   - SATO_MAX (default 150): teto de linhas gravadas por execução.
 *   - SATO_MAX_PAGES (default 30): teto de páginas da API (~450 leilões).
 *   - Desativação de obsoletos SÓ com coleta saudável (>50) — padrão
 *     salvarEFinalizar do scraper-puppeteer (erro de rede não zera o acervo).
 *   - fetch DIRETO, sem Bright Data/puppeteer (API pública JSON; o 1º run diz
 *     se egress de datacenter passa — se vier HTML/challenge, abortamos).
 *
 * Env: VITE_SUPABASE_URL (ou SUPABASE_URL), SUPABASE_SERVICE_KEY.
 * Teste: SATO_DRYRUN=1 node scripts/scraper-sato.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { checarQualidade } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte NASCE INVISÍVEL ao bug bounty. O SATO ainda é
// dispatch-only, então dava para não notar — e é exatamente assim que uma fonte entra em
// produção sem piso aprendido e quebra em silêncio meses depois (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';

const FONTE = 'SATO';
const LEILOEIRO = 'Sato Leilões';
const BASE = 'https://www.satoleiloes.com.br';
const API = `${BASE}/api-publica/stale/dados-home`;

const DRYRUN = process.env.SATO_DRYRUN !== '0';
const MAX_ROWS = Number(process.env.SATO_MAX || 150);
const MAX_PAGES = Number(process.env.SATO_MAX_PAGES || 30);
const DEBUG = process.env.SATO_DEBUG === '1';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
// Dry-run funciona sem credenciais (não toca o banco); gravação exige.
if (!DRYRUN && (!SB_URL || !SB_KEY)) {
  console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY (obrigatórias com SATO_DRYRUN=0)');
  process.exit(1);
}
const supabase = SB_URL && SB_KEY ? createClient(SB_URL, SB_KEY) : null;

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Valores da API vêm como string em formato US ("488639.51", "244500").
const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
// Anti-sentinela (padrão do repo): fora de 1.000..500M não é preço real de imóvel.
const plaus = v => (v >= 1000 && v <= 500_000_000) ? v : 0;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// ─── GUARDS: só imóveis ──────────────────────────────────────────────────────
// Positivo: o título/descrição precisa indicar imóvel.
const RE_IMOVEL = /\b(casa|sobrado|apartament|apto|flat|kitnet|studio|terreno|loteamento|gleba|galp[ãa]o|im[óo]ve(l|is)|sala\s+comercial|loja|pr[ée]dio|edif[íi]cio|fazenda|s[íi]tio|ch[áa]cara|[áa]rea\s+(rural|urbana|de\s+terra)|vaga\s+de\s+garagem|lote\s+de\s+terreno)\b/i;
// Negativo: exclusões do repo (veículo/equipamento) + parte ideal/direito creditório.
const RE_EXCLUIR = /\b(ve[íi]culo|caminh[ãa]o|carro|moto(cicleta)?|[ôo]nibus|trator|empilhadeira|colheitadeira|escavadeira|retroescavadeira|carroceria|implemento|cabine|sucata|m[áa]quin|equipament|gerador|compressor|eletrodom[ée]stic|inform[áa]tica|mobili[áa]rio|chevrolet|volkswagen|fiat|ford|toyota|honda|hyundai|renault|nissan|jeep|scania|volvo|mercedes|iveco|parte\s+ideal|fra[çc][ãa]o\s+ideal|direito[s]?\s+credit[óo]rio|nua[\s-]propriedade)\b/i;

function ehImovel(titulo = '', descricao = '') {
  const t = `${titulo} ${descricao}`;
  return RE_IMOVEL.test(t) && !RE_EXCLUIR.test(t);
}

function inferirTipo(titulo = '') {
  const t = titulo.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|loteamento|gleba|lote de terreno|[áa]rea/.test(t)) return 'terreno';
  if (/comercial|loja|sala|galp[ãa]|pr[ée]dio|escrit[óo]rio|vaga de garagem/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// Cidade/UF: 1º pela descrição estruturada ("Local: São Leopoldo/RS", "Local do
// bem: PONTA GROSSA/PR"); 2º pelo segmento "| CIDADE/UF" do título. Títulos
// multi-UF ("IMÓVEIS | SP | MG") não casam — e esses leilões (multi-lote) nem
// chegam aqui (lotes_count>1 → TODO detalhe).
function cidadeUF(descricao = '', titulo = '') {
  let m = String(descricao).match(/Local(?:\s+do\s+bem)?\s*:\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]{1,40}?)\s*[\/-]\s*([A-Z]{2})\b/i);
  if (!m) m = String(titulo).match(/\|\s*([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ'.\- ]{1,40}?)\s*\/\s*([A-Z]{2})\s*(?:\||$)/);
  if (!m) m = String(`${titulo} ${descricao}`).match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+(?:\s+[A-ZÀ-Ý][A-Za-zÀ-ÿ'.]+){0,3})\s*\/\s*([A-Z]{2})\b/);
  if (!m) return { cidade: null, estado: null };
  return { cidade: m[1].trim().replace(/\s+/g, ' ').slice(0, 60), estado: m[2].toUpperCase() };
}

// Área pelo título: "93M²", "59,10m²", "100M2", "15HA" (ha → m²).
function extrairArea(titulo = '') {
  let m = titulo.match(/(\d+(?:[.,]\d+)?)\s*m[²2]\b/i);
  if (m) return num(m[1].replace(',', '.'));
  m = titulo.match(/(\d+(?:[.,]\d+)?)\s*ha\b/i);
  if (m) return num(m[1].replace(',', '.')) * 10_000;
  return 0;
}

function modalidadeDe(l) {
  const t = `${l.titulo || ''} ${l.descricao || ''}`;
  if (l.venda_direta === '1' || Number(l.venda_direta) === 1 || /venda\s*direta/i.test(t)) return 'venda_direta';
  if (/aliena[çc][ãa]o\s+fiduci[áa]ria|extrajudicial/i.test(t)) return 'extrajudicial';
  if (/judicial/i.test(t)) return 'judicial';
  return 'extrajudicial';
}

// Data do próximo pregão: 1ª praça; se já concluída (ou passada) e existe 2ª, a 2ª.
function dataLeilao(l) {
  const d1 = (l.data_hora_inicio || '').slice(0, 10) || null;
  const d2 = (l.data_hora_inicio_segundo_leilao || '').slice(0, 10) || null;
  const hoje = new Date().toISOString().slice(0, 10);
  if (d2 && (l.primeiro_leilao_concluido === '1' || (d1 && d1 < hoje))) return d2;
  return d1 || d2;
}

// Foto: imagens_leilao[0].arquivo.leilaoAbertoUrl.x2 (600px). URL ASSINADA
// (querystring `assinatura=`) — pode expirar; o refresh diário renova.
function linkFoto(l) {
  const img = Array.isArray(l.imagens_leilao) ? l.imagens_leilao[0] : null;
  const urls = img?.arquivo?.leilaoAbertoUrl || null;
  return urls?.x2 || urls?.x1 || urls?.x4 || null;
}

// Valores: com dois leilões, o lance da 1ª praça ≈ avaliação e o da 2ª é o
// mínimo real (amostra recon: 1ª 488.639,51 · 2ª 244.500). Com praça única,
// só há o lance inicial → valor_minimo, sem avaliação (não inventamos).
function valores(l) {
  const p1 = plaus(num(l.lanceInicialPrimeiroLote ?? l.menorlanceInicial));
  const p2 = plaus(num(l.lanceInicialSegLeilaoPrimeiroLote ?? l.menorlanceInicialSegLeilao));
  const dois = l.dois_leiloes === '1' || Number(l.dois_leiloes) === 1;
  if (dois && p1 && p2) return { valor_minimo: Math.min(p1, p2), valor_avaliacao: Math.max(p1, p2) };
  return { valor_minimo: p1 || p2, valor_avaliacao: 0 };
}

function statusOk(l) {
  const s = l.status_leilao || {};
  if (s.arquivado === '1' || s.completo === '1' || s.suspenso === '1' || s.retirado_pelo_comitente === '1') return false;
  // Recon só viu identificador 'ABERTO'; aceitamos qualquer status não-terminal
  // que ainda receba lances, p/ não perder venda direta/proposta.
  if (s.identificador && /cancelad|encerrad|finalizad/i.test(s.identificador)) return false;
  if (l.segundo_leilao_concluido === '1') return false;
  return true;
}

function montarRow(l) {
  const { cidade, estado } = cidadeUF(l.descricao, l.titulo);
  const { valor_minimo, valor_avaliacao } = valores(l);
  const comitente = l.comitente?.nome_fantasia || null;
  // TODO(rota): o recon não capturou a rota pública do leilão (SPA sem hrefs).
  // /leilao/{id} é o palpite mais comum nessa plataforma — o 1º run real valida
  // (se 404, testar /lote/{id}, /leiloes/{id} e atualizar aqui + leiloeiro_conhecimento).
  const url = l.externo === '1' && l.link_parceiro ? l.link_parceiro : `${BASE}/leilao/${l.id}`;
  const va = valor_avaliacao, vm = valor_minimo;
  return {
    fonte: FONTE,
    // fonte_id no id do LEILÃO (só gravamos lotes_count===1, então leilão = lote).
    // TODO(lotes): quando o endpoint de lotes for descoberto, ids por lote
    // deverão ser `sato_${idLeilao}_${idLote}` — manter `sato_${id}` p/ único lote.
    fonte_id: `sato_${l.id}`,
    titulo: (l.titulo || '').replace(/\s+/g, ' ').trim().slice(0, 180) || `Imóvel ${LEILOEIRO} ${l.id}`,
    tipo: inferirTipo(l.titulo || ''),
    modalidade: modalidadeDe(l),
    cidade, estado,
    valor_minimo: vm, valor_avaliacao: va,
    area_m2: extrairArea(l.titulo || ''),
    descricao: [l.descricao, comitente ? `Comitente: ${comitente}` : null]
      .filter(Boolean).join(' · ').replace(/\s+/g, ' ').trim().slice(0, 500) || null,
    link_edital: url, // API da home não expõe documentos — TODO(detalhe): edital real
    url_lote: url,
    link_foto: linkFoto(l),
    anexos: [],
    leiloeiro: LEILOEIRO,
    data_leilao: dataLeilao(l),
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: va > 0 ? (1 - vm / va) >= 0.3 : null,
    score_viabilidade: va > 0 ? Math.min(100, Math.round((1 - vm / va) * 150)) : 30,
    desconto_percentual: va > 0 ? Math.round((1 - vm / va) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// ─── COLETA ──────────────────────────────────────────────────────────────────
async function fetchPagina(page) {
  const url = `${API}?page=${page}&type=leilao`;
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 20_000);
  try {
    const r = await fetch(url, {
      signal: c.signal,
      headers: { 'User-Agent': UA, 'Accept': 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': `${BASE}/` },
    });
    if (!r.ok) return { erro: `HTTP ${r.status}` };
    const ct = r.headers.get('content-type') || '';
    // Se vier HTML, é challenge/bloqueio de datacenter — abortar, não parsear lixo.
    if (!ct.includes('json')) return { erro: `content-type ${ct.slice(0, 40)} (challenge/bloqueio?)` };
    const data = await r.json();
    if (!Array.isArray(data)) return { erro: 'payload não é array' };
    return { leiloes: data };
  } catch (e) {
    return { erro: e.name === 'AbortError' ? 'timeout' : e.message };
  } finally {
    clearTimeout(t);
  }
}

async function coletar() {
  const vistos = new Set();
  const leiloes = [];
  for (let p = 1; p <= MAX_PAGES; p++) {
    const { leiloes: pagina, erro } = await fetchPagina(p);
    if (erro) {
      console.log(`  pág ${p}: ${erro}${p === 1 ? ' — abortando (nada coletado)' : ' — parando aqui'}`);
      if (p === 1) return null; // 1ª página falhou = fonte inacessível, não é "fim"
      break;
    }
    if (!pagina.length) { if (DEBUG) console.log(`  pág ${p}: vazia — fim da paginação`); break; }
    const antes = vistos.size;
    for (const l of pagina) {
      if (l?.id == null || vistos.has(l.id)) continue;
      vistos.add(l.id);
      leiloes.push(l);
    }
    if (DEBUG) console.log(`  pág ${p}: ${pagina.length} leilões (+${vistos.size - antes} novos)`);
    if (vistos.size === antes) break; // página repetida = fim
    await sleep(400);
  }
  return leiloes;
}

async function main() {
  console.log(`SATO ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · max ${MAX_ROWS} linhas · até ${MAX_PAGES} págs`);
  const runStart = new Date().toISOString();
  const leiloes = await coletar();
  if (leiloes === null) { console.error('Fonte inacessível via fetch direto (ver log). Nada feito.'); process.exit(1); }
  console.log(`  ${leiloes.length} leilões enumerados na API`);
  if (DEBUG && leiloes[0]) {
    const { imagens_leilao, ...resto } = leiloes[0];
    console.log('  amostra bruta (1º leilão, sem imagens):', JSON.stringify(resto).slice(0, 1500));
  }

  let naoImovel = 0, multiLote = 0, statusRuim = 0, semValor = 0;
  const prontos = [];
  for (const l of leiloes) {
    if (!statusOk(l)) { statusRuim++; continue; }
    if (!ehImovel(l.titulo, l.descricao)) { naoImovel++; continue; }
    if (Number(l.lotes_count) !== 1) { multiLote++; continue; } // TODO(detalhe): endpoint de lotes
    const row = montarRow(l);
    const q = checarQualidade(row, { estrito: false });
    if (q.descartar) { semValor++; continue; } // sem valor plausível = sentinela/lixo
    prontos.push(row);
    if (prontos.length >= MAX_ROWS) break;
  }
  console.log(`  prontos ${prontos.length} · não-imóvel ${naoImovel} · multi-lote (TODO detalhe) ${multiLote} · status terminal ${statusRuim} · sem valor ${semValor}`);

  if (!prontos.length) { console.log('nada a gravar.'); return; }
  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log('\nPara gravar, rode com SATO_DRYRUN=0.');
    return;
  }

  // Upsert em lotes de 500 por fonte_id (padrão do repo).
  for (let i = 0; i < prontos.length; i += 500) {
    const fatia = prontos.slice(i, i + 500);
    const { error } = await supabase.from('imoveis_leilao').upsert(fatia, { onConflict: 'fonte_id', ignoreDuplicates: false });
    if (error) { console.error(`erro ao gravar ${i + 1}-${i + fatia.length}:`, error.message); process.exit(1); }
  }
  console.log(`✅ ${prontos.length} imóveis SATO gravados/atualizados.`);

  // Desativação de obsoletos SÓ com coleta saudável (>50) — trava do repo p/ um
  // erro de rede/HTML de challenge não zerar o acervo da fonte.
  //
  // padrao-ok: o gate cita o COLETADO (`prontos.length`), mas aqui isso é seguro porque o laço
  // de upsert acima faz `process.exit(1)` na primeira falha — chegar nesta linha já prova que
  // TODAS as fatias gravaram. É a diferença para o scraper-puppeteer e o scraper-leiloeiros,
  // onde o erro do upsert era só um console.error e a execução seguia até o sweep.
  if (prontos.length > 50) {
    const { error, count } = await supabase
      .from('imoveis_leilao')
      .update({ ativo: false }, { count: 'exact' })
      .eq('fonte', FONTE)
      .eq('ativo', true)
      .lt('atualizado_em', runStart);
    if (error) console.error('  Erro ao desativar SATO obsoletos:', error.message);
    else console.log(`  🔻 SATO: ${count ?? 0} lotes obsoletos desativados`);
  } else {
    console.log(`  ⚠️ SATO coletou ${prontos.length} (≤50) — pulando desativação por segurança`);
  }

  // SAÚDE DA FONTE: a linha que ONBOARDA o SATO no monitor de regressão.
  await registrarSaude(supabase, FONTE, prontos, 'api_publica');
  // Auto-aprendizado (leiloeiro_conhecimento) — o monitor baseline assume daqui.
  await registrarConhecimento(supabase, {
    fonte: FONTE, plataforma: 'sato_spa_quasar', acesso: 'api_publica_json', custo: 'gratis',
    anti_bot: 'nenhum_observado', enumeracao: 'api-publica/stale/dados-home?page=N&type=leilao (15/pág)',
    url_lote: '/leilao/{id} (palpite — validar no 1º run)',
    scraper: 'scraper-sato.mjs', qualidade: qualidadeColeta(prontos),
  });
}

main().catch(e => { console.error(e); process.exit(1); });
