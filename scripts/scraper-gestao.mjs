/**
 * Scraper cluster "Gestão de Leilões" (PHP) — extrajust, lancetotal, lancenoleilao,
 * granado (e afins) via Bright Data Web Unlocker.
 * ────────────────────────────────────────────────────────────────────────────
 * Recon (23/07) mostrou que os 4 domínios rodam o MESMO back-office PHP ("Gestão de
 * Leilões", CDN d335luupugsy2.cloudfront.net) atrás de Cloudflare. Peculiaridades que
 * exigem scraper próprio (nenhuma via grátis):
 *   1) ENCODING ISO-8859-1/windows-1252 → decodificar os bytes crus (senão vira mojibake).
 *   2) `leilao.php?idLeilao=N` NÃO é um imóvel — é um EVENTO com N lotes RENDERIZADOS
 *      INLINE (Total de lotes 588…). Cada lote é um "card" (div.lotePadraoValor +
 *      div.lote-descricao) com id via onClick="goTo('lote.php?idLote=NNN')". Não há
 *      necessidade de abrir cada lote — o card já carrega todos os campos.
 *   3) Mistura IMÓVEL × MÓVEIS/veículos → filtrar por CATEGORIA (só imóvel).
 *   4) Página pode voltar HTTP 200 vazia/bloqueada (len ~1.5k) → detectar e pular.
 *
 * Dedup GLOBAL por idLote (backend compartilhado; o mesmo lote aparece em +de 1 domínio)
 * → fonte única 'GESTAOLEILOES', leiloeiro por-linha lido do <title> do evento.
 *
 * SEGURANÇA DE CUSTO (cada request = 1 Bright Data, proposito 'gestao' → sub-cota + teto):
 *   - GESTAO_MAX_EVENTOS (default 25): teto de eventos/execução.
 *   - GESTAO_DRYRUN (default '1'): NÃO grava — parseia e loga o que inseriria.
 *   - GESTAO_DEBUG (default '0'): dumpa enumeração + 1 evento parseado.
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import { createClient } from '@supabase/supabase-js';
import { fetchViaBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { checarQualidade, normalizarData } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';

const DOMINIOS = (process.env.GESTAO_DOMINIOS ||
  'granadoleiloes.com.br,lancenoleilao.com.br,extrajustleiloes.com.br,lancetotal.com.br')
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_EVENTOS = Number(process.env.GESTAO_MAX_EVENTOS || 25);
const DRYRUN = process.env.GESTAO_DRYRUN !== '0';
const DEBUG = process.env.GESTAO_DEBUG === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// Busca via Web Unlocker e DECODIFICA windows-1252 (o back-office serve latin1).
async function bd(url, { timeoutMs = 60000 } = {}) {
  const r = await fetchViaBrightData(url, { proposito: 'gestao', timeoutMs });
  if (!r || !r.ok) return null;
  try {
    const buf = await r.arrayBuffer();
    return new TextDecoder('windows-1252').decode(buf);
  } catch { return null; }
}

// Página válida? (o back-office às vezes devolve 200 com um stub minúsculo/challenge).
const paginaOk = h => !!h && h.length > 5000 && /lotePadrao|Total de lotes|idLote/i.test(h);

function inferirTipo(txt = '') {
  const t = txt.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio|unidade aut/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote de terreno|gleba|data de terra/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio|barrac/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

// Extrai os idLeilao de uma home: links diretos + links de compartilhamento (whatsapp).
function extrairIdLeiloes(html) {
  const ids = new Set();
  for (const m of html.matchAll(/leilao\.php\?idLeilao=(\d+)/gi)) ids.add(m[1]);
  for (const m of html.matchAll(/idLeilao(?:=|%3D)(\d+)/gi)) ids.add(m[1]);
  return [...ids];
}

// Title-case Unicode-safe (o \w quebra em acentos → "NegóCio"; \p{L} com /u resolve).
function tituloCase(s) {
  return s.toLowerCase().replace(/(^|[\s'"–—-])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
}

// Nome do leiloeiro a partir do <title>: fica só com a MARCA (corta no 1º separador —
// "::", "-", "|" — que separa a marca da tagline "Gestão de Leilões"/"O melhor negócio…").
function leiloeiroDoTitulo(html, dominio) {
  let t = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
  t = t.split(/\s*(?:::|[|–—-])\s*/)[0].trim();
  if (t && t.length >= 3 && !/gest[ãa]o de leil/i.test(t)) return tituloCase(t).slice(0, 80);
  // Fallback: deriva do domínio (ex.: granadoleiloes → Granado Leilões).
  const base = dominio.replace(/^www\./, '').split('.')[0].replace(/leiloes?$/i, '');
  return `${base.charAt(0).toUpperCase()}${base.slice(1)} Leilões`;
}

// Datas de praça do cabeçalho do evento: "1ª Praça: Abertura 13/Ago/2026..." (mês PT abrev).
const MESES = { jan:'01', fev:'02', mar:'03', abr:'04', mai:'05', jun:'06', jul:'07', ago:'08', set:'09', out:'10', nov:'11', dez:'12' };
function dataEvento(txt) {
  // Prioriza a data da 1ª praça/leilão; aceita "13/Ago/2026" e "13/08/2026".
  const mAbrev = txt.match(/(\d{1,2})\/([A-Za-zç]{3})\/(\d{4})/);
  if (mAbrev) {
    const mm = MESES[mAbrev[2].toLowerCase().slice(0, 3)];
    if (mm) return `${mAbrev[3]}-${mm}-${mAbrev[1].padStart(2, '0')}`;
  }
  return normalizarData(txt);
}

// Divide o HTML do evento em "cards" de lote (cada um começa no div com onClick goTo).
function fatiarCards(html) {
  const marca = /col-lg-8 col-sm-12 px-lg-1"\s+onClick="goTo\('(lote|loteVendaDireta)\.php\?idLote=(\d+)'\)/gi;
  const pontos = [];
  let m;
  while ((m = marca.exec(html))) pontos.push({ i: m.index, tipo: m[1], idLote: m[2] });
  const cards = [];
  for (let k = 0; k < pontos.length; k++) {
    const ini = pontos[k].i;
    const fim = k + 1 < pontos.length ? pontos[k + 1].i : Math.min(html.length, ini + 8000);
    cards.push({ idLote: pontos[k].idLote, vendaDireta: pontos[k].tipo === 'loteVendaDireta', html: html.slice(ini, fim) });
  }
  return cards;
}

function parseCard(card, ctx) {
  const html = card.html;
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();

  // CATEGORIA (filtro imóvel × móveis/veículos).
  const categoria = (txt.match(/CATEGORIA:\s*([A-Za-zÀ-ÿ ]+?)\s+(?:ESTADO|ID\d|[A-Z]{2,})/i) || [])[1]
    || (txt.match(/CATEGORIA:\s*([A-Za-zÀ-ÿ]+)/i) || [])[1] || '';
  const ehImovel = /im[óo]ve/i.test(categoria) || /ESTADO:\s*[A-Z]{2}\s*-\s*CIDADE:/i.test(txt);
  if (!ehImovel) return null;

  // Valores rotulados no card. Venda direta: só "Valor para proposta".
  const val = re => num((txt.match(re) || [])[1]);
  const avaliacao = val(/Avalia[çc][ãa]o:\s*R\$\s*([\d.]+,\d{2})/i)
    || val(/VALOR DE AVALIA[ÇC][ÃA]O:\s*R\$\s*([\d.]+,\d{2})/i);
  const inicial = val(/Inicial:\s*R\$\s*([\d.]+,\d{2})/i);
  const praca2 = val(/2[ªa]\s*Pra[çc]a:\s*R\$\s*([\d.]+,\d{2})/i);
  const proposta = val(/Valor para proposta:\s*R\$\s*([\d.]+,\d{2})/i);
  // Lance mínimo = o menor preço de ENTRADA disponível (2ª praça < inicial), ou proposta.
  let valorMinimo = proposta || praca2 || inicial || 0;
  const valorAval = avaliacao || inicial || proposta || 0;

  // Campos do bloco DESCRIÇÃO: "ESTADO: XX - CIDADE: Y - ENDEREÇO: Z - BAIRRO: W - DESCRIÇÃO: ..."
  let estado = (txt.match(/ESTADO:\s*([A-Z]{2})\b/i) || [])[1] || null;
  let cidade = (txt.match(/CIDADE:\s*([^-]+?)\s*-\s*(?:ENDERE|BAIRRO|DESCRI)/i) || [])[1]?.trim() || null;
  const endereco = (txt.match(/ENDERE[ÇC]O:\s*(.+?)\s*-\s*(?:BAIRRO|DESCRI|IPTU|MATR)/i) || [])[1]?.trim() || null;
  const bairro = (txt.match(/BAIRRO:\s*([^-]+?)\s*-\s*(?:DESCRI|IPTU|MATR)/i) || [])[1]?.trim() || null;
  // Fallback venda-direta: o card usa "CIDADE (UF)" (ex.: "ID75411 CURITIBA (PR) - Portão").
  if (!cidade) {
    const m2 = txt.match(/\b([A-ZÀ-Ý][A-Za-zÀ-ÿ. ]{2,30}?)\s*\(([A-Z]{2})\)/);
    if (m2) { cidade = tituloCase(m2[1].trim()); estado = estado || m2[2]; }
  }
  // Matrícula: aceita "MATRÍCULA: 44034" e "Matrícula 101339 do 6º CRI" (venda direta, sem ":").
  const matricula = (txt.match(/matr[íi]cula[:\s]*n?[ºo°.]?\s*(\d[\d.\-\/]{2,})/i) || [])[1] || null;
  const area = num((txt.match(/([\d.]+,\d{2}|\d+(?:,\d+)?)\s*M2?\s*DE\s*[ÁA]REA\s*(?:PRIVATIVA|TOTAL|ÚTIL|UTIL|CONSTRU)/i) || [])[1])
    || num((txt.match(/([\d.]+,\d{2}|\d+)\s*m²/i) || [])[1]);

  // Modalidade: venda direta explícita; SFI/Caixa = extrajudicial; senão heurística.
  const modalidade = card.vendaDireta || /venda\s*direta/i.test(txt) ? 'venda_direta'
    : /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : 'extrajudicial';

  // Foto do lote: snapshot/fotos do próprio back-office (o card carrega a thumb).
  const foto = (html.match(/(?:src|data-src)=["']([^"']*\/(?:leilao|bem_foto|fotos)\/[^"']+\.(?:jpe?g|png|webp|jfif)[^"']*)["']/i) || [])[1] || null;
  const fotoAbs = foto ? (foto.startsWith('http') ? foto : `https://${ctx.dominio}/${foto.replace(/^\//, '')}`) : null;

  const descricao = (txt.match(/DESCRI[ÇC][ÃA]O:\s*(.+?)(?:\s*-\s*VALOR DE AVALIA|\s*IPTU:|$)/i) || [])[1]?.trim()?.slice(0, 500) || null;
  const tituloBase = [inferirRotulo(txt), cidade, estado].filter(Boolean).join(' - ');

  const row = {
    fonte: 'GESTAOLEILOES',
    fonte_id: `gestao_${card.idLote}`,
    titulo: (tituloBase || `Imóvel ${ctx.leiloeiro} ${card.idLote}`).slice(0, 180),
    tipo: inferirTipo(txt),
    modalidade,
    estado, cidade, bairro,
    endereco: endereco ? endereco.slice(0, 200) : null,
    valor_avaliacao: valorAval,
    valor_minimo: valorMinimo,
    area_m2: area || 0,
    descricao,
    numero_matricula: matricula,
    link_edital: `https://${ctx.dominio}/leilao.php?idLeilao=${ctx.idLeilao}`,
    url_lote: `https://${ctx.dominio}/lote.php?idLote=${card.idLote}`,
    link_foto: fotoAbs,
    leiloeiro: ctx.leiloeiro,
    data_leilao: ctx.data_leilao || null,
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: valorAval > 0 ? (1 - valorMinimo / valorAval) >= 0.3 : null,
    score_viabilidade: valorAval > 0 ? Math.min(100, Math.round((1 - valorMinimo / valorAval) * 150)) : 30,
    desconto_percentual: valorAval > 0 ? Math.round((1 - valorMinimo / valorAval) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
  return row;
}

// Rótulo curto do imóvel: 1º pelo início da DESCRIÇÃO; senão pela 1ª palavra-tipo do card
// (cobre venda direta, que usa "Descrição legal: Imóvel Urbano: Prédio Comercial…").
function inferirRotulo(txt) {
  const TIPOS = /\b(CASA|APARTAMENTO|APTO|TERRENO|SALA|LOJA|GALP[ÃA]O|PR[ÉE]DIO|CH[ÁA]CARA|S[ÍI]TIO|FAZENDA|BARRAC[ÃA]O|IM[ÓO]VEL)\b/i;
  const m = txt.match(new RegExp(`DESCRI[ÇC][ÃA]O:[^.]*?${TIPOS.source}`, 'i')) || txt.match(TIPOS);
  return m ? m[1].toUpperCase() : 'IMÓVEL';
}

async function coletarEvento(dominio, idLeilao) {
  const url = `https://${dominio}/leilao.php?idLeilao=${idLeilao}`;
  const html = await bd(url);
  if (!paginaOk(html)) return { rows: [], bloqueado: true };
  const cabecalho = html.slice(0, 6000).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const ctx = {
    dominio, idLeilao,
    leiloeiro: leiloeiroDoTitulo(html, dominio),
    data_leilao: dataEvento(cabecalho),
  };
  const cards = fatiarCards(html);
  const rows = [];
  for (const c of cards) {
    const row = parseCard(c, ctx);
    if (row) rows.push(row);
  }
  return { rows, bloqueado: false, total: cards.length, leiloeiro: ctx.leiloeiro };
}

async function debugRecon() {
  console.log('🔎 GESTÃO RECON — enumeração + 1 evento parseado por domínio\n');
  for (const dom of DOMINIOS) {
    console.log(`\n════ ${dom}`);
    const home = await bd(`https://${dom}/`);
    if (!home) { console.log('  home não veio (challenge/teto).'); continue; }
    const ids = extrairIdLeiloes(home);
    console.log(`  home ${home.length} bytes · idLeilao (${ids.length}): ${JSON.stringify(ids.slice(0, 15))}`);
    const alvo = ids[0];
    if (!alvo) continue;
    const { rows, bloqueado, total, leiloeiro } = await coletarEvento(dom, alvo);
    console.log(`  evento ${alvo} · leiloeiro="${leiloeiro}" · cards=${total ?? 0} · imóveis=${rows.length}${bloqueado ? ' · BLOQUEADO' : ''}`);
    console.log('  amostra:', JSON.stringify(rows.slice(0, 2), null, 1));
    await sleep(600);
  }
  console.log('\n✅ RECON concluído.');
}

async function main() {
  if (!brightDataDisponivel()) {
    console.error('BRIGHTDATA_API_TOKEN/ZONE ausentes — cluster só acessível via Web Unlocker. Abortado.');
    process.exit(1);
  }
  if (DEBUG) { await debugRecon(); return; }

  console.log(`GESTÃO ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · domínios: ${DOMINIOS.join(', ')} · max ${MAX_EVENTOS} eventos`);

  // 1) Enumera idLeilao de todos os domínios (dedup global de eventos por par domínio+id).
  const eventos = [];
  const vistos = new Set();
  for (const dom of DOMINIOS) {
    const home = await bd(`https://${dom}/`);
    if (!home) { console.log(`  [${dom}] home não veio.`); continue; }
    const ids = extrairIdLeiloes(home).filter(id => !vistos.has(`${dom}:${id}`));
    for (const id of ids) { vistos.add(`${dom}:${id}`); eventos.push({ dom, id }); }
    console.log(`  [${dom}] ${ids.length} evento(s)`);
    await sleep(400);
  }
  const alvo = eventos.slice(0, MAX_EVENTOS);
  console.log(`Enumerados ${eventos.length} evento(s); processando ${alvo.length}.`);

  // 2) Coleta cada evento; dedup GLOBAL de lotes por idLote (fonte_id).
  const porId = new Map();
  let bloq = 0;
  for (const { dom, id } of alvo) {
    const { rows, bloqueado } = await coletarEvento(dom, id);
    if (bloqueado) { bloq++; continue; }
    for (const r of rows) if (!porId.has(r.fonte_id)) porId.set(r.fonte_id, r);
    console.log(`  [${dom}] evento ${id}: +${rows.length} imóvel(is) (total únicos ${porId.size})`);
    await sleep(500);
  }

  const todos = [...porId.values()];
  const prontos = todos.filter(r => !checarQualidade(r, { estrito: false }).descartar);
  console.log(`\n${todos.length} lotes-imóvel · ${prontos.length} passam na qualidade · ${bloq} evento(s) bloqueado(s).`);
  if (!prontos.length) { console.log('nada a gravar.'); return; }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log('\nPara gravar, rode com GESTAO_DRYRUN=0.');
    return;
  }
  const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${prontos.length} imóveis do cluster Gestão de Leilões gravados/atualizados.`);
  await registrarConhecimento(supabase, {
    fonte: 'GESTAOLEILOES', plataforma: 'GestaoDeLeiloes(PHP)', acesso: 'brightdata', custo: 'pago',
    anti_bot: 'cloudflare', enumeracao: 'home_idLeilao→evento_inline', url_lote: '/lote.php?idLote={id}',
    scraper: 'scraper-gestao.mjs', qualidade: qualidadeColeta(prontos),
  });
}

main().catch(e => { console.error(e); process.exit(1); });
