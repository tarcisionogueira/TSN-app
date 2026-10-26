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
 *   - GESTAO_MAX_EVENTOS (default 25 no pago, 80 no residencial): teto de eventos/execução,
 *     repartido em rodízio entre os domínios.
 *   - GESTAO_DOC_CAP (default 30): teto de lotes/execução pra busca de documento (item 8
 *     abaixo) — 1 request Bright Data por lote, à parte do teto de eventos.
 *   - GESTAO_DRYRUN (default '1'): NÃO grava — parseia e loga o que inseriria.
 *   - GESTAO_DEBUG (default '0'): dumpa enumeração + 1 evento parseado.
 *
 * 09/09: item 8 — parseCard() só lia matrícula em TEXTO (nº solto, sem link) e link_edital
 * sempre apontava pra página do EVENTO (placeholder repetido pra todos os lotes do mesmo
 * leilão) — link_matricula/anexos ficavam null em 100% dos casos. enriquecerDocumentos()
 * tentou fechar esse gap visitando url_lote com o MESMO padrão de scan de `<a href>` que
 * scraper-soleon.mjs usa — mas ficou em produção 1 semana inteira (09 a 16/09) sem achar
 * NADA (confirmado: 0 imóveis com anexo em nenhum domínio do cluster).
 *
 * 16/09: causa-raiz achada por recon ao vivo (workflow temporário, GH Actions). A página do
 * LOTE NUNCA tem o link em `<a href>` — "Edital" e "Matrícula e anexos" são botões
 * javascript:void(0) que abrem, num fancybox/iframe, uma página SEPARADA
 * (loteAnexos.php?idLote=N / leilaoAnexos.php?idLeilao=N&action=0) — e DENTRO dela o link
 * ainda não é `<a href>`, é `onClick="anexoCarregar('./sishp/.../arquivo.pdf')"`
 * (`function anexoCarregar(path){window.open(path)}`). Três camadas de indireção, nenhuma
 * delas um link estático — não é o parser errando formato, é o documento morando em duas
 * páginas que o scraper nunca visitava. enriquecerDocumentos() reescrita pra buscar as DUAS
 * páginas certas (extrairAnexosCarregar) em vez de url_lote; leilaoAnexos é por EVENTO
 * (compartilhado entre lotes do mesmo leilão) e cacheado por execução pra não pagar 1
 * request por lote à toa. Custo sobe de ~1 pra ~2 requests Bright Data por lote sem doc
 * (mais barato que parece: o 2º é amortizado entre todos os lotes do mesmo leilão).
 *
 * Env: BRIGHTDATA_API_TOKEN, BRIGHTDATA_ZONE, VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';   // carrega ~/.bidpro-runner.env quando rodado na mão
import { createClient } from '@supabase/supabase-js';
import { decodificarEntidades } from '../api/_texto-imovel.js';
// CORRIGIDO (18/08). A nota de 11/08 dizia que o `null` do `fetchViaBrightData` era um
// fallback DELIBERADO ("tenta o caminho grátis/residencial, e o pago é a segunda chance") e
// por isso o arquivo seguia na linha de base do verificador. **A justificativa não descrevia
// este código:** a escolha entre residencial e pago é feita por VARIÁVEL DE AMBIENTE, antes
// da chamada (`GESTAO_HEADLESS === '1'`, em `bd()`); no modo pago o `null` não tinha segunda
// chance nenhuma — virava `return null` seco. Ou seja, a isenção protegia um fallback que
// não existe neste caminho.
//
// O efeito medido: quando o teto SEMANAL do Bright Data recusa, todo fetch volta `null`, a
// home não vem em nenhum domínio, e a execução gravava `fonte_saude` como 'falhou' com
// "nada pronto (0 lotes brutos)". Em 5 manhãs (13, 14, 15, 16 e 18/08) isso aconteceu no
// MESMO segundo de cron em que CALIL e VEGAS — que passam pelo caminho honesto — gravaram
// 'sem_cota'. A recusa é do teto GLOBAL (475/450), não da sub-cota 'gestao' (30/150), então
// atinge os três juntos. Duas ações opostas (liberar orçamento × consertar parser) estavam
// saindo com o mesmo rótulo, e o rótulo errado é o que manda consertar o que não quebrou.
import { buscarViaBrightData, ErroBrightData, brightDataDisponivel } from '../api/_brightdata.js';
import { checarQualidade, normalizarData } from './lib/scraper-core.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';
// Monitor de fontes: sem esta linha a fonte fica INVISÍVEL ao bug bounty (ver _saude-fonte.mjs).
import { registrarSaude } from './_saude-fonte.mjs';
import { inferirUF } from './lib/inferir-uf.mjs';
import { fetchResidencial, fecharHeadless, estatisticaResidencial, decodificarCorpo } from './lib/fetch-residencial.mjs';
import { viaBanco } from './lib/motor/fetch-fonte.mjs';
import { repararLatin1Perdido } from './lib/reparar-latin1.mjs';
import { ehPadrao, fatiarCardsPadrao, pracasPadrao, parseCardPadrao } from './lib/gestao-padrao.mjs';

// vincoleiloes.com.br: recon 26/07 viu o MESMO back-office (leilao.php?idLeilao=N), mas é uma
// instalação PRÓPRIA (fotos em vincoleiloes.com.br/sishp, UTF-8, outro layout de lote — ver
// fatiarCardsGrade, 21/10). idLote do vinco NÃO é do backend compartilhado: fonte_id leva o domínio.
// 26/10 (junta): + Fidalgo (www.fidalgoleiloes.com.br, 51 leilões, layout "lotePadrao" — parseCardPadrao) e Central
// Judicial (www.centraljudicial.com.br, "Central Judicial :: Gestão de Leilões", 1 evento na home e ele dá 404 hoje:
// entra vazio). Instalações PRÓPRIAS (fotos em <dominio>/sishp, sem a CDN d335 do backend compartilhado) — o idLote
// é deles, então o fonte_id leva o domínio (DOMINIOS_ID_PROPRIO), como o vinco.
const DOMINIOS_PADRAO_CLUSTER = 'granadoleiloes.com.br,lancenoleilao.com.br,extrajustleiloes.com.br,lancetotal.com.br,vincoleiloes.com.br,www.fidalgoleiloes.com.br,www.centraljudicial.com.br';
const DOMINIOS_ID_PROPRIO = /(?:^|\.)(?:vincoleiloes|fidalgoleiloes|centraljudicial)\.com\.br$/i;
const DOMINIOS = (process.env.GESTAO_DOMINIOS || DOMINIOS_PADRAO_CLUSTER)
  .split(',').map(s => s.trim()).filter(Boolean);
const MAX_EVENTOS_PADRAO = 25;
// Residencial (Chromium em IP de casa) não paga por request: teto maior. O pago segue em 25.
// VIA GRÁTIS DO GITHUB (26/10): GESTAO_GRATIS=1 — fetch direto do runner e, quando o Cloudflare recusa (todos os
// domínios menos o vinco, medido em 26/10), a página pelo BANCO (pg_net, grátis). Nunca Bright Data. O banco entrega
// o latin1 do back-office com U+FFFD no lugar das acentuadas — repararLatin1Perdido reconstrói pelo léxico.
const GRATIS = process.env.GESTAO_GRATIS === '1';
const MAX_EVENTOS = Number(process.env.GESTAO_MAX_EVENTOS || (process.env.GESTAO_HEADLESS === '1' || GRATIS ? 160 : MAX_EVENTOS_PADRAO));
// ESCOPO REDUZIDO (10/09): um dispatch manual com domínio/evento cortado (ex.: recon pontual
// de 1 dos 5 domínios do cluster) não pode entrar no monitor com a MESMA etiqueta de uma
// coleta de produção — foi exatamente isso que fez `fonte_regressao_suspeita()` acusar
// "total=1 vs piso=63" num dia em que o cluster inteiro seguia com 123 lotes saudáveis
// (ver HANDOFF, achado do dono pedindo revisão geral dos scrapers). `registrarSaude` e as
// funções SQL (`fonte_baseline_aprendida`/`fonte_regressao_suspeita`) reconhecem o sufixo
// `-escopo-reduzido` em `estrategia` e excluem essas linhas da comparação/aprendizado.
const ESCOPO_REDUZIDO = !!process.env.GESTAO_DOMINIOS || MAX_EVENTOS < MAX_EVENTOS_PADRAO;
const ESTRATEGIA = ESCOPO_REDUZIDO ? 'principal-escopo-reduzido' : 'principal';
// 22/10: 30 era o teto pensado para o Bright Data (pago). No runner residencial a busca é grátis
// (2 páginas por lote, o edital do evento em cache) — o teto de 30 deixava o Vinco inteiro sem doc.
const DOC_CAP = Number(process.env.GESTAO_DOC_CAP || (process.env.GESTAO_HEADLESS === '1' ? 400 : GRATIS ? 120 : 30));
const DRYRUN = process.env.GESTAO_DRYRUN !== '0';
const DEBUG = process.env.GESTAO_DEBUG === '1';
const RESIDENCIAL = process.env.GESTAO_HEADLESS === '1';
const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const num = s => parseFloat(String(s || '').replace(/[^\d.,]/g, '').replace(/\./g, '').replace(',', '.')) || 0;

if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

// O freio de custo agiu em ALGUM fetch desta execução? É a única coisa que separa "a fonte
// mudou" de "eu não fui olhar". Fica no módulo porque a decisão acontece lá embaixo, no
// fetch, e só é PERGUNTADA no fim, quando se grava a saúde da fonte.
let semCotaVisto = false;

// Busca via Web Unlocker e DECODIFICA windows-1252 (o back-office serve latin1).
// Caminho grátis (GESTAO_GRATIS): direto → banco. Devolve null com o motivo no log (nunca engole).
const viaGratis = { direto: 0, banco: 0, falha: 0 };
async function fetchGratis(url, { timeoutMs = 45000, valido = null } = {}) {
  const serve = (h) => !!h && !/just a moment|cf-chl|challenge-platform\/h\//i.test(h.slice(0, 4000)) && (valido ? valido(h) : h.length > 0);
  let porQue;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36', 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const h = decodificarCorpo(await r.arrayBuffer(), 'auto');
    if (r.ok && serve(h)) { viaGratis.direto++; return h; }
    porQue = r.ok ? 'página inválida/challenge' : `HTTP ${r.status}`;
  } catch (e) { porQue = `rede: ${String(e?.cause?.code || e?.message || e).slice(0, 60)}`; }
  const b = await viaBanco(url);
  if (b.html) {
    const h = repararLatin1Perdido(b.html);
    if (serve(h)) { viaGratis.banco++; return h; }
    porQue += ' · banco: página inválida';
  } else porQue += ` · banco: ${b.motivo}`;
  viaGratis.falha++;
  console.error(`  [grátis] ${url}: ${porQue}`);
  return null;
}

async function bd(url, { timeoutMs = 60000, valido = null } = {}) {
  if (GRATIS) return fetchGratis(url, { valido });
  if (RESIDENCIAL) {
    // Runner residencial: fetch puro (decodificando windows-1252 na mão — o Chromium fazia isso
    // de graça), com o navegador de rede de segurança. `valido` é o marcador que o parser
    // precisa: sem ele, o stub de 1,5 kB que o back-office devolve bloqueado passaria como
    // página boa e o fallback nunca dispararia.
    return await fetchResidencial(url, { timeoutMs, charset: 'auto', valido });
  }
  // `buscarViaBrightData` LANÇA com o motivo em vez de devolver `null` para quatro causas
  // diferentes. Continuamos devolvendo `null` ao chamador — a enumeração por domínio/evento é
  // tolerante a falha de propósito, e deixar a exceção subir mataria a execução ANTES de
  // gravar `fonte_saude`, fazendo a fonte sumir do monitor (o buraco que o scraper-rj pagou em
  // 11/08). O que muda é que agora o motivo não se perde no caminho.
  let r;
  try {
    r = await buscarViaBrightData(url, { proposito: 'gestao', timeoutMs, exigirOk: false });
  } catch (e) {
    if (!(e instanceof ErroBrightData)) throw e;   // erro de verdade não vira "página vazia"
    if (e.semCota) semCotaVisto = true;
    console.error(`  [bd] ${url}: ${e.message}`);
    return null;
  }
  if (!r || !r.ok) return null;
  // Decodificação em catch PRÓPRIO: corpo ilegível sempre foi `null` aqui, e continuar
  // deixando-o subir junto do erro de transporte trocaria uma falha silenciosa por outra.
  try {
    const buf = await r.arrayBuffer();
    return decodificarCorpo(buf, 'auto');   // latin1 do back-office × UTF-8 do vinco
  } catch { return null; }
}

// Página válida? (o back-office às vezes devolve 200 com um stub minúsculo/challenge).
const paginaOk = h => !!h && h.length > 5000 && /lotePadrao|Total de lotes|idLote|Exibindo resultado/i.test(h);

// Home resiliente: tenta o apex e, se vier vazio (apex que redireciona p/ www e o Web Unlocker
// não segue — caso do vinco), tenta www.<dominio>. Barato: o 2º fetch só dispara quando o 1º falha.
async function fetchHome(dom) {
  // O `valido` da home NÃO pode ser "tem idLeilao". Leiloeiro pequeno ENTRE eventos tem home
  // sadia e zero evento — exigir o link faria o fallback gastar um Chromium à toa e, pior,
  // devolver `null`, que o chamador imprime como "home não veio". Seria trocar "sem leilão
  // agora" por "fui bloqueado": as duas ações são opostas, e é a confusão que o `sem_cota`
  // e o `vazio` já existem para evitar em `_saude-fonte.mjs`.
  // O que separa home boa de bloqueio é o TAMANHO — o back-office devolve stub ~1,5 kB com
  // HTTP 200, e o `> 5000` é o mesmo limiar que `paginaOk` já usa neste arquivo (as homes
  // medidas em 30/08 vieram entre 52 e 434 kB).
  const naoEhStub = h => h.length > 5000;
  let h = await bd(`https://${dom}/`, { valido: naoEhStub });
  if (!h && !/^www\./i.test(dom)) h = await bd(`https://www.${dom}/`, { valido: naoEhStub });
  return h;
}

function inferirTipo(txt = '') {
  const t = txt.toLowerCase();
  if (/apartament|apto|flat|kitnet|studio|unidade aut/.test(t)) return 'apartamento';
  if (/casa|sobrado|residenc/.test(t)) return 'casa';
  if (/terreno|lote de terreno|gleba|data de terra/.test(t)) return 'terreno';
  if (/comercial|loja|sala|gal[pã]|pr[ée]dio|escrit[óo]rio|barrac/.test(t)) return 'comercial';
  if (/rural|fazenda|s[íi]tio|ch[áa]cara/.test(t)) return 'rural';
  return 'outros';
}

const STATUS_EVENTO_VIVO = /aberto para lances|aguardando abertura|em loteamento|em andamento/i;

// Extrai os idLeilao de uma home: links diretos + links de compartilhamento (whatsapp).
function extrairIdLeiloes(html) {
  const ids = new Set();
  for (const m of html.matchAll(/leilao\.php\?idLeilao=(\d+)/gi)) ids.add(m[1]);
  for (const m of html.matchAll(/idLeilao(?:=|%3D)(\d+)/gi)) ids.add(m[1]);
  // 21/10 (Vinco): a home do vinco NÃO linka os eventos. O card só tem "ID: 448" e a foto
  // `sishp/leilao/448/fotos/snapshot.jpg`; o clique é JS. Só o 447 (carrossel) tinha link, e
  // o domínio rodou meses com 1 de ~21 eventos vivos e 0 lote gravado, sem alarme: a fonte é o
  // cluster inteiro e os outros domínios seguravam o total. Lemos o ID da foto, só de card VIVO:
  // "Divulgação"/"Encerrado"/"Sustado" é evento passado, e "SFrazão…"/"WLeilões…" no rodapé é
  // evento hospedado no site do parceiro (o FRAZAO já é coletado por conta própria).
  for (const card of html.split(/<div class="card card-1\b/).slice(1)) {
    const id = (card.match(/\/sishp\/leilao\/(\d+)\/fotos\/snapshot/) || [])[1];
    const status = (card.match(/title="Ir para o leil[^"]*"[^>]*>\s*<span>([^<]+)<\/span>/i) || [])[1] || '';
    if (id && STATUS_EVENTO_VIVO.test(status)) ids.add(id);
  }
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

// LAYOUT EM GRADE (21/10, Vinco): card `div.lote-borda` com link `<a href=…lote.php?idLote=N>`,
// 20 por página (`&pagina=N`; `&pagina=-1&action=0&todos=1` traz todos numa página só). O card
// não tem CATEGORIA nem DESCRIÇÃO — só título ("Sala coml. c/ 42,120m² em Tamboré, Barueri/SP"),
// avaliação e lance mínimo. O imóvel sai pelo título; descrição/endereço/matrícula vêm da
// página do lote (completarDetalheGrade).
const ehGrade = h => /class="lote-borda\b/.test(h);
function fatiarCardsGrade(html) {
  return html.split(/<div class="lote-borda\b/).slice(1).map((pedaco) => {
    const idLote = (pedaco.match(/lote\.php\?idLote=(\d+)/) || [])[1];
    return idLote ? { idLote, vendaDireta: /loteVendaDireta\.php/.test(pedaco), html: pedaco.slice(0, 8000) } : null;
  }).filter(Boolean);
}
// Local no fim do título (ou do endereço), nas formas vistas em 21/10: "em Tamboré, Barueri/SP",
// "no Jardim X, São Carlos/SP", "em São Bernardo do Campo - São Paulo/SP" (cidade - estado por
// extenso) e "no Bairro do Cristal - Mairinque-SP". Vírgula só conta seguida de espaço: "293,09m²".
function localDoTexto(texto = '') {
  const t = String(texto).replace(/[.\s]+$/, '');
  const m = t.match(/(,\s+|\s[-–]\s*|\b(?:em|no|na)\s+)(?!\d)([^,\-–/]+?)\s*[/-]\s*([A-Z]{2})$/i);
  if (!m) return { cidade: null, estado: null, bairro: null };
  const estado = m[3].toUpperCase();
  let cidade = m[2].trim();
  let antes = t.slice(0, m.index);
  // "São Bernardo do Campo - São Paulo/SP": o que casou é o ESTADO por extenso; a cidade vem antes.
  if (/^\s[-–]/.test(m[1]) && /^s[ãa]o paulo$/i.test(cidade) && estado === 'SP') {
    const c2 = antes.match(/(?:,\s+|\b(?:em|no|na)\s+)([^,]+?)\s*$/i);
    if (c2) { cidade = c2[1].trim(); antes = antes.slice(0, c2.index); }
  }
  let bairro = (antes.match(/\b(?:em|no|na)\s+([^,]+?)\s*$/i) || [])[1]?.trim() || null;
  if (bairro && /\d/.test(bairro)) bairro = null;   // "… c/ 42m² em" não é bairro
  const caixa = (x) => tituloCase(x).replace(/ (Da|De|Do|Das|Dos|E) /g, (y) => y.toLowerCase());
  return { cidade: caixa(cidade), estado, bairro: bairro && bairro.toLowerCase() !== cidade.toLowerCase() ? caixa(bairro) : null };
}
const NAO_IMOVEL = /ve[íi]culo|\bcarro\b|\bmoto|caminh[ãa]o|sucata|\bm[áa]quina|equipamento|eletro|\bm[óo]veis\b|mercadoria/i;
function parseCardGrade(card, ctx) {
  // O `alt` da miniatura tem a grafia do leiloeiro; o span de `lote-nome` vem em caixa alta
  // feita byte a byte no servidor ("PARAISóPOLIS") e às vezes cortado ("BOM JESUS/P").
  const titulo = decodificarEntidades((card.html.match(/lote-miniatura[^"]*"\s+alt="([^"]+)"/) || card.html.match(/lote-nome[^>]*>\s*<span[^>]*>([^<]+)</) || [])[1] || '')
    .replace(/\s+/g, ' ').trim();
  const tipo = inferirTipo(titulo);
  if (!titulo || tipo === 'outros' || NAO_IMOVEL.test(titulo)) return null;
  const txt = decodificarEntidades(card.html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const valorAval = num((txt.match(/Avalia[çc][ãa]o:\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  const valorMinimo = num((txt.match(/Lance m[íi]nimo:\s*R\$\s*([\d.]+,\d{2})/i) || [])[1]);
  let { cidade, estado, bairro } = localDoTexto(titulo);
  if (!estado) {
    const x = inferirUF({ cidade, titulo, endereco: null, descricao: titulo });
    if (x) { estado = x.uf; if (x.cidade && !cidade) cidade = tituloCase(x.cidade); }
  }
  const area = num((titulo.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,3})?)\s*m²/i) || [])[1]);
  const reFotoLote = new RegExp(`["']([^"']*/${card.idLote}_[^"'/]*\\.(?:jpe?g|png|webp|jfif)[^"']*)["']`, 'i');
  const foto = (String(ctx.htmlEvento || card.html).match(reFotoLote) || [])[1] || null;
  const temDesconto = valorAval > 0 && valorMinimo > 0 && valorMinimo <= valorAval;
  const base = ctx.dominio.replace(/^www\./, '').split('.')[0];
  return {
    fonte: 'GESTAOLEILOES',
    fonte_id: `gestao_${base}_${card.idLote}`,
    titulo: titulo.slice(0, 180),
    tipo,
    modalidade: card.vendaDireta ? 'venda_direta' : (ctx.judicial ? 'judicial' : 'extrajudicial'),
    estado, cidade, bairro,
    endereco: null,
    valor_avaliacao: valorAval,
    valor_minimo: valorMinimo || valorAval,
    area_m2: area || 0,
    descricao: null,
    numero_matricula: null,
    link_edital: `https://${ctx.dominio}/leilao.php?idLeilao=${ctx.idLeilao}`,
    url_lote: `https://${ctx.dominio}/lote.php?idLote=${card.idLote}`,
    link_foto: foto ? (foto.startsWith('http') ? foto : `https://${ctx.dominio}/${foto.replace(/^\//, '')}`) : null,
    leiloeiro: ctx.leiloeiro,
    data_leilao: card.vendaDireta ? null : (ctx.data_leilao || null),
    forma_pagamento: 'a_vista',
    ativo: true,
    viavel: temDesconto ? (1 - valorMinimo / valorAval) >= 0.3 : null,
    score_viabilidade: temDesconto ? Math.min(100, Math.round((1 - valorMinimo / valorAval) * 150)) : 30,
    desconto_percentual: temDesconto ? Math.round((1 - valorMinimo / valorAval) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
}

// Página do lote (layout em grade): "Descrição do lote" (título em <strong> + texto) e
// "Endereço:" (link do Maps). 1 request por imóvel — só no residencial (grátis), com teto.
const DETALHE_CAP = Number(process.env.GESTAO_DETALHE_CAP || (RESIDENCIAL ? 200 : 0));
function extrairDetalheGrade(html) {
  const bloco = (html.match(/Descri[çc][ãa]o do lote<\/span>\s*<div[^>]*>\s*<div[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || '';
  const descricao = decodificarEntidades(bloco.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || null;
  const endereco = decodificarEntidades((html.match(/Endere[çc]o:<\/strong>\s*<a[^>]*>([^<]+)<\/a>/i) || [])[1] || '').trim() || null;
  const matricula = descricao ? ((descricao.match(/matr[íi]cula[:\s]*n?[ºo°.]?\s*(\d[\d.\-\/]{2,})/i) || [])[1] || null) : null;
  return { descricao, endereco, matricula };
}
async function completarDetalheGrade(rows) {
  const alvo = rows.filter(r => !r.descricao && /^gestao_[a-z]/.test(r.fonte_id)).slice(0, DETALHE_CAP);
  if (!alvo.length) return;
  let ok = 0;
  for (const r of alvo) {
    const h = await bd(r.url_lote, { valido: x => !!x && /Descri[çc][ãa]o do lote/i.test(x) });
    if (h) {
      const d = extrairDetalheGrade(h);
      if (d.descricao) { r.descricao = d.descricao.slice(0, 8000); ok++; }
      if (d.endereco) r.endereco = d.endereco.slice(0, 200);
      // Título cortado na fonte ("Bom Jesus/P"): o endereço da página do lote completa.
      if (d.endereco && !r.estado) { const l = localDoTexto(d.endereco); if (l.estado) Object.assign(r, { cidade: l.cidade, estado: l.estado, bairro: r.bairro || l.bairro }); }
      if (d.matricula) r.numero_matricula = d.matricula.replace(/[.\s]/g, '');
    }
    await sleep(300);
  }
  // Sem descrição o lote ainda entra (título/valor/cidade bastam para a busca), mas o número
  // vai para o log: "0 de N" é o sinal de que a página do lote mudou de layout.
  console.log(`  📝 detalhe (layout em grade): ${ok}/${alvo.length} com descrição (teto ${DETALHE_CAP}).`);
}

function parseCard(card, ctx) {
  const html = card.html;
  // Decodifica entidades antes de qualquer regex (18/08): `Leil&atilde;o`, `1&ordm;`,
  // `matr&iacute;cula` e `m&sup2;` nao casam com regex acentuada, e o resultado nao e erro —
  // e valor faltando com cara de ausencia. Ver `api/_texto-imovel.js`.
  const txt = decodificarEntidades(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

  // CATEGORIA (filtro imóvel × móveis/veículos).
  const categoria = (txt.match(/CATEGORIA:\s*([A-Za-zÀ-ÿ ]+?)\s+(?:ESTADO|ID\d|[A-Z]{2,})/i) || [])[1]
    || (txt.match(/CATEGORIA:\s*([A-Za-zÀ-ÿ]+)/i) || [])[1] || '';
  const ehImovel = /im[óo]ve/i.test(categoria) || /ESTADO:\s*[A-Z]{2}\s*-\s*CIDADE:/i.test(txt);
  if (!ehImovel) return null;

  // Valores rotulados. Fontes, em ordem de confiabilidade:
  //  - cabeçalho do card: "Avaliação"/"Inicial"/"2ª Praça"/"Valor para proposta" (venda direta);
  //  - DESCRIÇÃO (CAIXA/SFI): "VALOR DE AVALIAÇÃO / VALOR DE VENDA 1º/2º LEILÃO" — canônicos.
  // O 2º leilão/2ª praça é o MÍNIMO real (com desconto). No CAIXA o "Inicial" (1º) às vezes
  // supera a avaliação → nunca deixamos um valor ACIMA da avaliação virar o "mínimo".
  const val = re => num((txt.match(re) || [])[1]);
  const avaliacao = val(/Avalia[çc][ãa]o:\s*R\$\s*([\d.]+,\d{2})/i);
  const inicial = val(/Inicial:\s*R\$\s*([\d.]+,\d{2})/i);
  const praca2 = val(/2[ªaº°]\s*Pra[çc]a:\s*R\$\s*([\d.]+,\d{2})/i);
  const proposta = val(/Valor para proposta:\s*R\$\s*([\d.]+,\d{2})/i);
  const dAval = val(/VALOR DE AVALIA[ÇC][ÃA]O:\s*R\$\s*([\d.]+,\d{2})/i);
  const dVenda1 = val(/VALOR DE VENDA 1[ºo°ª]?\s*LEIL[ÃA]O:\s*R\$\s*([\d.]+,\d{2})/i);
  const dVenda2 = val(/VALOR DE VENDA 2[ºo°ª]?\s*LEIL[ÃA]O:\s*R\$\s*([\d.]+,\d{2})/i);

  const valorAval = dAval || avaliacao || inicial || proposta || 0;
  // Mínimo: prefere o 2º leilão/2ª praça (entrada com desconto); nunca o "Inicial" quando
  // há um valor menor; cai p/ o menor candidato positivo se faltarem os rótulos de 2º.
  let valorMinimo = proposta || dVenda2 || praca2 || dVenda1 || inicial || 0;
  const candMin = [proposta, dVenda2, praca2, dVenda1, inicial].filter(v => v > 0);
  if (candMin.length) valorMinimo = Math.min(valorMinimo || Infinity, ...candMin);

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
  // Sem o bloco "ESTADO:" (28/09: 2 lotes do lancenoleilao/granado sem UF, invisíveis em
  // /leiloes, com "CEP sob nº 05449-050" no texto) — mesmo recuperador do motor, só com prova.
  if (!estado) {
    const x = inferirUF({ cidade, titulo: null, endereco, descricao: txt });
    if (x) { estado = x.uf; if (x.cidade && !cidade) cidade = tituloCase(x.cidade); }
  }
  // Matrícula: aceita "MATRÍCULA: 44034" e "Matrícula 101339 do 6º CRI" (venda direta, sem ":").
  const matricula = (txt.match(/matr[íi]cula[:\s]*n?[ºo°.]?\s*(\d[\d.\-\/]{2,})/i) || [])[1] || null;
  // ACHADO DO BLOCO 3 (03/09): `[\d.]+,\d{2}` exige decimal colado; sem ele, o fallback
  // (`\d+`/`\d+(?:,\d+)?`) não aceita ponto de milhar e casava só os últimos 3 dígitos de um
  // número maior ("1.813" → 813) — mesmo defeito achado em WEBLEILOES/SOLEON/RJLEILOES.
  // Padrão correto: 1-3 dígitos + grupos de milhar de 3 dígitos, decimal opcional.
  const area = num((txt.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*M2?\s*DE\s*[ÁA]REA\s*(?:PRIVATIVA|TOTAL|ÚTIL|UTIL|CONSTRU)/i) || [])[1])
    || num((txt.match(/(\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?)\s*m²/i) || [])[1]);

  // Modalidade: venda direta explícita (card.vendaDireta vem da URL do site — loteVendaDireta.php
  // vs lote.php, sinal estrutural confiável) OU heurística de texto; SFI/Caixa = extrajudicial.
  //
  // GATE DE PRAÇA (09/09, achado no BAYIT — mesma classe de defeito, regra literal do dono:
  // praça com data ⇒ nunca venda direta): a checagem de texto solto (`/venda\s*direta/i.test(txt)`)
  // não tinha proteção — bastava a palavra aparecer em QUALQUER lugar do card pra sobrepor um
  // lote com praça de verdade. card.vendaDireta continua incondicional (é estrutural, não texto);
  // só o fallback textual passa a exigir ausência de valor de praça rotulado (inicial/2ª praça/
  // venda 1º ou 2º leilão) — os mesmos valores já extraídos acima pra avaliação/mínimo.
  const temPracaValor = inicial > 0 || praca2 > 0 || dVenda1 > 0 || dVenda2 > 0;
  // 28/09: o fallback TEXTUAL também exige ausência de DATA de praça (ctx.data_leilao) — 13 lotes do
  // lancenoleilao (lote.php, não loteVendaDireta.php) saíam venda_direta COM data 10/09, contra a
  // regra do dono "praça com data ⇒ nunca venda direta". O sinal estrutural segue incondicional.
  const modalidade = card.vendaDireta || (!temPracaValor && !ctx.data_leilao && /venda\s*direta/i.test(txt)) ? 'venda_direta'
    : /(?<!extra)judicial/i.test(txt) ? 'judicial'
    : 'extrajudicial';

  // Foto do lote: o nome do arquivo é SEMPRE prefixado pelo idLote (<idLote>_NN.jpg).
  // BUG CRÍTICO corrigido: os cards são fatiados pela COLUNA DE TEXTO (col-lg-8), e a
  // imagem de cada lote fica na coluna que PRECEDE o texto do próximo lote → pegar a
  // "1ª foto da fatia" trazia a foto do PRÓXIMO lote (foto de outro imóvel, perda de
  // credibilidade). Buscamos no HTML INTEIRO do evento a foto cujo nome começa com
  // ESTE idLote; se não achar, fica SEM foto (melhor nenhuma que a de outro imóvel).
  const reFotoLote = new RegExp(`["']([^"']*/${card.idLote}_[^"'/]*\\.(?:jpe?g|png|webp|jfif)[^"']*)["']`, 'i');
  const foto = (String(ctx.htmlEvento || html).match(reFotoLote) || [])[1] || null;
  const fotoAbs = foto ? (foto.startsWith('http') ? foto : `https://${ctx.dominio}/${foto.replace(/^\//, '')}`) : null;

  // 20/09 (pedido do dono: descrição completa, como o leiloeiro publica) — GESTAOLEILOES
  // batia no teto de 500 em produção (23/153 lotes truncados exatamente nesse tamanho).
  const descricao = (txt.match(/DESCRI[ÇC][ÃA]O:\s*(.+?)(?:\s*-\s*VALOR DE AVALIA|\s*IPTU:|$)/i) || [])[1]?.trim()?.slice(0, 8000) || null;
  const tituloBase = [inferirRotulo(txt), cidade, estado].filter(Boolean).join(' - ');
  const temDesconto = valorAval > 0 && valorMinimo > 0 && valorMinimo <= valorAval;

  const row = {
    fonte: 'GESTAOLEILOES',
    fonte_id: DOMINIOS_ID_PROPRIO.test(ctx.dominio) ? `gestao_${ctx.dominio.replace(/^www\./, '').split('.')[0]}_${card.idLote}` : `gestao_${card.idLote}`,
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
    // venda direta estrutural não tem praça: a data do EVENTO não é prazo do lote.
    data_leilao: modalidade === 'venda_direta' ? null : (ctx.data_leilao || null),
    forma_pagamento: 'a_vista',
    ativo: true,
    // Só há desconto quando o mínimo é ABAIXO da avaliação; senão (lote premium/CAIXA sem 2º
    // leilão OU rótulo faltante) não inventa um desconto NEGATIVO — deixa nulo/neutro.
    viavel: temDesconto ? (1 - valorMinimo / valorAval) >= 0.3 : null,
    score_viabilidade: temDesconto ? Math.min(100, Math.round((1 - valorMinimo / valorAval) * 150)) : 30,
    desconto_percentual: temDesconto ? Math.round((1 - valorMinimo / valorAval) * 100) : null,
    atualizado_em: new Date().toISOString(),
  };
  return row;
}

// Rótulo curto do imóvel: 1º pelo início da DESCRIÇÃO; senão pela 1ª palavra-tipo do card
// (cobre venda direta, que usa "Descrição legal: Imóvel Urbano: Prédio Comercial…").
// Recon 16/09 (workflow temporário, confirmado ao vivo): a página do LOTE (url_lote) NUNCA
// tem o link do documento em `<a href>` — "Edital" e "Matrícula e anexos" são botões
// javascript:void(0) que abrem, num fancybox/iframe, uma página SEPARADA:
//   - loteAnexos.php?idLote=<idLote>      → matrícula/anexos do LOTE
//   - leilaoAnexos.php?idLeilao=<idLeilao>&action=0 → edital/regras do EVENTO (idLeilao),
//     compartilhado por todos os lotes do mesmo leilão
// E DENTRO dessas páginas o link ainda não é `<a href>` — é
//   <a ... onClick="anexoCarregar('./sishp/leilao/<idLeilao>/anexos/<arquivo>.pdf');">RÓTULO</a>
// com `function anexoCarregar(path){ window.open(path); }`. extrairDocsDoHtml() (scan de
// `<a href>`) nunca poderia achar isso — não é o parser errando um formato, é o documento
// morando em outra página. Esta função lê ESSE padrão.
function extrairAnexosCarregar(html, urlBase) {
  const docs = [];
  for (const m of html.matchAll(/<a\b[\s\S]*?anexoCarregar\((['"])([^'"]+)\1\)[\s\S]*?>([\s\S]*?)<\/a>/gi)) {
    const caminho = m[2];
    const label = decodificarEntidades((m[3] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    let abs; try { abs = new URL(caminho, urlBase); } catch { continue; }
    if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
    // "Auto de Penhora e Avaliação" (Vinco, 22/10) é o laudo do processo judicial.
    const tipo = /matr[íi]cula/i.test(label) ? 'matricula' : (/edital/i.test(label) ? 'edital' : (/laudo|avalia[çc][ãa]o/i.test(label) ? 'laudo' : 'outro'));
    docs.push({ tipo, nome: (label || 'Documento').slice(0, 80), url: abs.href });
  }
  return docs;
}

function inferirRotulo(txt) {
  const TIPOS = /\b(CASA|APARTAMENTO|APTO|TERRENO|SALA|LOJA|GALP[ÃA]O|PR[ÉE]DIO|CH[ÁA]CARA|S[ÍI]TIO|FAZENDA|BARRAC[ÃA]O|IM[ÓO]VEL)\b/i;
  const m = txt.match(new RegExp(`DESCRI[ÇC][ÃA]O:[^.]*?${TIPOS.source}`, 'i')) || txt.match(TIPOS);
  return m ? m[1].toUpperCase() : 'IMÓVEL';
}

// Escaneia <a href> da página do LOTE por link .pdf ou rótulo edital/matrícula/laudo —
// MESMO padrão de scraper-soleon.mjs (parseDetalhe). Precisa do HTML CRU (não do `txt`
// sem tags que parseCard usa pros outros campos): o link mora no atributo href.
function extrairDocsDoHtml(html, urlBase) {
  const docs = [];
  for (const m of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1];
    const label = decodificarEntidades((m[2] || '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
    if (/\.pdf(\?|#|$)/i.test(href) || /edital|matr[íi]cula|laudo/i.test(label)) {
      let abs; try { abs = new URL(href, urlBase); } catch { continue; }
      // 12/09: alguns botões do site não têm link real — são "javascript:void(0)" com o
      // documento aberto via onclick/AJAX. `new URL()` aceita esse esquema sem erro, e o
      // rótulo casava "edital"/"matrícula" — gravava um link MORTO como se fosse documento
      // (30 de 153 imóveis com link_edital=link_matricula='javascript:void(0);'). Melhor
      // ficar sem link (cai em "não lido", categoria correta) do que um link que não abre.
      if (abs.protocol !== 'http:' && abs.protocol !== 'https:') continue;
      docs.push({ url: abs.href, label: label.slice(0, 60) });
    }
  }
  const findDoc = re => (docs.find(d => re.test(d.label) || re.test(d.url)) || {}).url || null;
  const anexos = docs.map(d => ({
    tipo: /matr[íi]cula/i.test(d.label + d.url) ? 'matricula' : (/edital/i.test(d.label + d.url) ? 'edital' : (/laudo/i.test(d.label + d.url) ? 'laudo' : 'outro')),
    nome: (d.label || 'Documento').slice(0, 80),
    url: d.url,
  }));
  return { link_edital: findDoc(/edital/i), link_matricula: findDoc(/matr[íi]cula/i), anexos };
}

// Busca o documento real pra um subconjunto dos lotes SEM documento — cap pequeno de
// propósito (GESTAO_DOC_CAP, default 30): contra o MESMO teto semanal que CALIL/VEGAS/
// RJLEILOES dependem. Mesmo espírito do enrichCap que scraper-puppeteer.mjs já usa pra
// SUPERBID/SOLD/ZUK/SODRE.
// 16/09: recon confirmou que o documento NUNCA está na página do LOTE (url_lote) — está em
// duas páginas separadas (ver extrairAnexosCarregar acima). `leilaoAnexos.php` é por EVENTO
// (idLeilao), não por lote: cacheado aqui pra não pagar 1 request por lote do mesmo leilão.
async function enriquecerDocumentos(rows) {
  // DOCUMENTO JÁ LIDO NÃO SE PERDE (22/10, Vinco 7399 sem edital/matrícula na tela de relatório).
  // Dois defeitos somados: (1) o filtro "sem documento" olhava o lote RECÉM-LIDO, que nunca tem
  // anexo — eram sempre os MESMOS 30 primeiros da lista (o Vinco nunca chegava); (2) o row sai do
  // parser com link_edital = página do evento, e o upsert devolvia esse placeholder (e anexos/
  // matrícula nulos) por cima do documento gravado na rodada anterior. Agora o que o banco já tem
  // volta para o row antes de gravar, e só quem está SEM documento entra na fila — os de leilão
  // mais próximo primeiro.
  const ja = new Map();
  const ids = rows.map(r => r.fonte_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('imoveis_leilao').select('fonte_id,anexos,link_edital,link_matricula')
      .in('fonte_id', ids.slice(i, i + 200));
    if (error) { console.warn(`  documentos já gravados ilegíveis (${error.message}) — busca todos`); ja.clear(); break; }
    for (const r of data || []) if (Array.isArray(r.anexos) && r.anexos.length) ja.set(r.fonte_id, r);
  }
  for (const row of rows) {
    const a = ja.get(row.fonte_id);
    if (!a) continue;
    row.anexos = a.anexos;
    if (a.link_matricula) row.link_matricula = a.link_matricula;
    if (a.link_edital && !/leilao\.php\?idLeilao=/.test(a.link_edital)) row.link_edital = a.link_edital;
  }
  const alvo = rows.filter(r => !(r.anexos && r.anexos.length))
    .sort((x, y) => String(x.data_leilao || '9999').localeCompare(String(y.data_leilao || '9999')))
    .slice(0, DOC_CAP);
  console.log(`\n📄 ${ja.size} lote(s) já com documento (mantidos) · ${rows.length - ja.size} sem`);
  if (!alvo.length) return;
  console.log(`\n📄 Buscando documento (loteAnexos/leilaoAnexos) pra ${alvo.length}/${rows.length} sem doc, cap ${DOC_CAP}...`);
  const cacheEdital = new Map(); // idLeilao -> docs[] (edital/regras), evita refetch por lote
  let achados = 0;
  for (const row of alvo) {
    const docs = [];

    // 1) Matrícula/anexos do LOTE — sempre 1 request por lote (não dá pra cachear).
    const urlLoteAnexos = row.url_lote.replace(/lote\.php\?idLote=/, 'loteAnexos.php?idLote=');
    const htmlLote = await bd(urlLoteAnexos, { valido: h => !!h && h.length > 500 });
    if (htmlLote) docs.push(...extrairAnexosCarregar(htmlLote, urlLoteAnexos), ...extrairDocsDoHtml(htmlLote, urlLoteAnexos).anexos);
    await sleep(400);

    // 2) Edital/regras do EVENTO — compartilhado por todos os lotes do mesmo leilão.
    const mLeilao = row.link_edital && row.link_edital.match(/leilao\.php\?idLeilao=(\d+)/);
    if (mLeilao) {
      const idLeilao = mLeilao[1];
      if (!cacheEdital.has(idLeilao)) {
        const urlLeilaoAnexos = row.link_edital.replace(/leilao\.php\?idLeilao=(\d+)/, 'leilaoAnexos.php?idLeilao=$1') + '&action=0';
        const htmlLeilao = await bd(urlLeilaoAnexos, { valido: h => !!h && h.length > 500 });
        cacheEdital.set(idLeilao, htmlLeilao ? extrairAnexosCarregar(htmlLeilao, urlLeilaoAnexos) : []);
        await sleep(400);
      }
      docs.push(...cacheEdital.get(idLeilao));
    }

    if (docs.length) {
      row.anexos = docs;
      const matr = docs.find(d => d.tipo === 'matricula');
      const ed = docs.find(d => d.tipo === 'edital');
      if (matr) row.link_matricula = matr.url;
      if (ed) row.link_edital = ed.url; // substitui o placeholder do evento
      achados++;
    }
  }
  console.log(`  ${achados}/${alvo.length} lote(s) com documento encontrado.`);
}

async function coletarEvento(dominio, idLeilao) {
  const url = `https://${dominio}/leilao.php?idLeilao=${idLeilao}`;
  const html = await bd(url, { valido: paginaOk });
  if (!paginaOk(html)) return { rows: [], bloqueado: true };
  const cabecalho = decodificarEntidades(html.slice(0, 6000).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  // JANELA DE DATA ANCORADA (20/09, v2 — a v1 buscava o ancorador no HTML CRU e nunca achava:
  // "Data:" e "Abertura" vêm separados por tags/entidades no markup real, então só casam depois
  // de decodificar entidades e tirar as tags — exatamente o que `achadosCrus()` do recon fazia e
  // o `html.search()` direto no cru não fazia. Corrigido decodificando/tirando tag do documento
  // INTEIRO primeiro, e só então procurando o ancorador). Recon real (Bright Data, idLeilao
  // 1044/1051, páginas de 90-190 kB) mostrou "Data: Abertura 24/Ago/2026..." existindo no texto
  // mas fora do slice(0,6000) que dataEvento() lia — 153 ativos do GESTAOLEILOES em 0% de
  // data_leilao apesar de a página vir completa.
  const textoCompleto = decodificarEntidades(html.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
  const idxData = textoCompleto.search(/Data:\s*Abertura|1[ªa]\s*Pra[çc]a|Data:\s*\d{1,2}\/[A-Za-zç]{3}\/\d{4}/i);
  const textoData = idxData >= 0 ? textoCompleto.slice(Math.max(0, idxData - 100), idxData + 200) : cabecalho;
  // ENCERRAMENTO, não ABERTURA (21/10). O cabeçalho é "Data: Abertura 14/Out/2026, 10h00
  // Encerramento 04/Nov/2026" — a abertura é quando os LANCES começam; o leilão é o encerramento.
  // Gravar a 1ª data da janela punha a abertura em `data_leilao`, e o gatilho de praça vencida
  // desligava o lote NA GRAVAÇÃO: granado/extrajust/lancetotal com 0 ativos, 195 lotes do cluster
  // gravados inativos em 21/10. Sem "Encerramento" (vinco: "Data: 22/Out/2026"), segue a 1ª data.
  const mEnc = textoData.match(/Encerramento\s*(\d{1,2}\/[A-Za-zç]{3}\/\d{4})/i);
  const ctx = {
    dominio, idLeilao,
    leiloeiro: leiloeiroDoTitulo(html, dominio),
    data_leilao: dataEvento(mEnc ? mEnc[1] : textoData),
    htmlEvento: html, // p/ resolver a foto pelo idLote no HTML INTEIRO (ver parseCard)
  };
  let cards = fatiarCards(html);
  let parse = parseCard;
  // EVENTO INTEIRO NO LAYOUT CLÁSSICO (21/10). A página traz 20 lotes de "Total de lotes N" (granado
  // 109: 20 de 497) e só o layout em grade buscava o resto. Mesmo back-office, mesmo `todos=1`
  // (medido: 497 cards). Fica com a resposta que trouxer MAIS cards — nunca troca para pior.
  const totalClassico = Number((textoCompleto.match(/Total de lotes\s*(\d+)/i) || [])[1] || 0);
  if (cards.length && totalClassico > cards.length) {
    const hTodos = await bd(`${url}&pagina=-1&action=0&todos=1`, { valido: paginaOk });
    const cTodos = paginaOk(hTodos) ? fatiarCards(hTodos) : [];
    if (cTodos.length > cards.length) { cards = cTodos; ctx.htmlEvento = hTodos; }
    else console.error(`  [${dominio}] evento ${idLeilao}: todos=1 não trouxe mais lotes — fico com ${cards.length}/${totalClassico}.`);
  }
  if (!cards.length && ehGrade(html)) {
    // Layout em grade (vinco): a 1ª página traz 20 de "LOTES EM LEILÃO N". Se faltar lote,
    // 1 request a mais com `todos=1` traz o evento inteiro (o próprio site monta essa URL).
    let h = html;
    const total = Number((textoCompleto.match(/LOTES EM LEIL[ÃA]O\s*(\d+)/i) || [])[1] || 0);
    if (total > fatiarCardsGrade(h).length) {
      const hTodos = await bd(`${url}&pagina=-1&action=0&todos=1`, { valido: paginaOk });
      if (paginaOk(hTodos)) h = hTodos;
      else console.error(`  [${dominio}] evento ${idLeilao}: todos=1 não veio — fico com a 1ª página (${fatiarCardsGrade(h).length}/${total}).`);
    }
    cards = fatiarCardsGrade(h);
    ctx.htmlEvento = h;
    ctx.judicial = /Tipo:\s*Judicial/i.test(textoCompleto);
    parse = parseCardGrade;
  }
  if (!cards.length && ehPadrao(html)) {
    let h = html;
    const total = Number((textoCompleto.match(/Exibindo resultado\s*\d+\s*a\s*\d+\s*de\s*(\d+)/i) || [])[1] || 0);
    if (total > fatiarCardsPadrao(h).length) {
      const hTodos = await bd(`${url}&pagina=-1&action=0&todos=1`, { valido: paginaOk });
      if (paginaOk(hTodos) && fatiarCardsPadrao(hTodos).length > fatiarCardsPadrao(h).length) h = hTodos;
      else console.error(`  [${dominio}] evento ${idLeilao}: todos=1 não trouxe mais lotes — fico com ${fatiarCardsPadrao(h).length}/${total}.`);
    }
    cards = fatiarCardsPadrao(h);
    ctx.htmlEvento = h;
    ctx.judicial = /Leil[ãa]o:\s*Judicial/i.test(textoCompleto);
    Object.assign(ctx, pracasPadrao(textoCompleto));
    ctx.totalDeclarado = total;
    parse = parseCardPadrao;
  }
  const rows = [];
  for (const c of cards) {
    const row = parse(c, ctx);
    if (row) rows.push(row);
  }
  return { rows, bloqueado: false, total: cards.length, leiloeiro: ctx.leiloeiro };
}

async function debugRecon() {
  console.log('🔎 GESTÃO RECON — enumeração + 1 evento parseado por domínio\n');
  for (const dom of DOMINIOS) {
    console.log(`\n════ ${dom}`);
    const home = await fetchHome(dom);
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
  // Bright Data só é exigido no modo pago (CI); no runner RESIDENCIAL (GESTAO_HEADLESS=1)
  // o Chromium real passa o Cloudflare de graça — o guard antigo abortava o modo de casa.
  if (!brightDataDisponivel() && !RESIDENCIAL && !GRATIS) {
    console.error('BRIGHTDATA_API_TOKEN/ZONE ausentes — cluster só acessível via Web Unlocker (ou use GESTAO_HEADLESS=1 num IP residencial). Abortado.');
    process.exit(1);
  }
  if (DEBUG) { await debugRecon(); return; }

  console.log(`GESTÃO ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · domínios: ${DOMINIOS.join(', ')} · max ${MAX_EVENTOS} eventos`);

  // 1) Enumera idLeilao de todos os domínios (dedup global de eventos por par domínio+id).
  // RODÍZIO (09/10, #38): a lista era concatenada na ordem dos domínios e cortada no teto — granado
  // e lancenoleilao enchiam as 25 vagas e extrajust/lancetotal/vinco NUNCA eram processados (o
  // lancetotal tinha terreno em Piracicaba no ar; o vinco, 70 eventos na home). O corte parecia
  // cobertura do cluster e era cobertura de 2 de 5 domínios. Agora cada domínio entra por vez.
  const porDominio = [];
  const vistos = new Set();
  for (const dom of DOMINIOS) {
    const home = await fetchHome(dom);
    if (!home) { console.log(`  [${dom}] home não veio.`); continue; }
    const ids = extrairIdLeiloes(home).filter(id => !vistos.has(`${dom}:${id}`));
    for (const id of ids) vistos.add(`${dom}:${id}`);
    porDominio.push(ids.map((id) => ({ dom, id })));
    console.log(`  [${dom}] ${ids.length} evento(s)`);
    await sleep(400);
  }
  // Só no RESIDENCIAL (grátis, teto 80). No pago (teto 25, fallback) a ordem fica a de antes: o
  // rodízio ali tiraria eventos do lancenoleilao e o acervo dele encolheria numa rodada paga.
  const eventos = [];
  if (RESIDENCIAL) {
    for (let i = 0; porDominio.some((l) => i < l.length); i++) for (const l of porDominio) if (i < l.length) eventos.push(l[i]);
  } else for (const l of porDominio) eventos.push(...l);
  const alvo = eventos.slice(0, MAX_EVENTOS);
  console.log(`Enumerados ${eventos.length} evento(s); processando ${alvo.length}.`);

  // 2) Coleta cada evento; dedup GLOBAL de lotes por idLote (fonte_id).
  const porId = new Map();
  let bloq = 0;
  for (const { dom, id } of alvo) {
    const { rows, bloqueado, total } = await coletarEvento(dom, id);
    if (bloqueado) { bloq++; continue; }
    for (const r of rows) if (!porId.has(r.fonte_id)) porId.set(r.fonte_id, r);
    console.log(`  [${dom}] evento ${id}: ${total ?? 0} card(s) lido(s) · +${rows.length} imóvel(is) (total únicos ${porId.size})`);
    await sleep(500);
  }

  const todos = [...porId.values()];
  if (!DRYRUN) await completarDetalheGrade(todos);   // 1 request por imóvel: só quando vai gravar
  const prontos = todos.filter(r => !checarQualidade(r, { estrito: false }).descartar);
  console.log(`\n${todos.length} lotes-imóvel · ${prontos.length} passam na qualidade · ${bloq} evento(s) bloqueado(s).`);
  // Zero pronto não é "a fonte está vazia" — é coleta quebrada até prova em contrário.
  // Sai com erro E deixa a linha em `fonte_saude`: sem isso a fonte some do monitor
  // (nenhuma linha nova) e o acervo encolhe em silêncio. Ver scraper-rj.mjs, 11/08.
  if (!prontos.length) {
    // ZERO POR ORÇAMENTO ≠ ZERO POR QUEBRA. `semCota` faz `registrarSaude` gravar status
    // 'sem_cota' em vez de 'falhou' e suprimir a acusação de regressão — a ação que resolve é
    // liberar cota, não mexer no parser. O exit 1 FICA nos dois casos: "não coletei" é
    // verdade em ambos, e sair com 0 seria o check verde sobre acervo parado de 11/08.
    await registrarSaude(supabase, 'GESTAOLEILOES', [], ESTRATEGIA,
      { ok: false, semCota: semCotaVisto, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: semCotaVisto
          ? 'SEM COTA Bright Data — coleta não tentada (decisão de orçamento, não regressão da fonte)'
          : `nada pronto (${todos.length} lotes brutos, ${bloq} evento(s) bloqueado(s))` });
    console.error(semCotaVisto
      ? 'sem cota do fornecedor: nada coletado. Saindo com erro — não coletei, mas a fonte não é a culpada.'
      : 'nada a gravar. Saindo com erro para não carimbar coleta que não coletou.');
    process.exitCode = 1;
    return;
  }

  if (DRYRUN) {
    console.log('DRY-RUN: não gravei. Amostra:');
    console.log(JSON.stringify(prontos.slice(0, 3), null, 2));
    console.log('\nPara gravar, rode com GESTAO_DRYRUN=0.');
    return;
  }
  // Depois do DRYRUN de propósito: busca de documento gasta Bright Data por lote, e não
  // faz sentido pagar isso numa execução que não vai gravar nada mesmo.
  await enriquecerDocumentos(prontos);
  // Upsert em GRUPOS de mesmo conjunto de colunas (22/10): num lote misto o PostgREST grava NULL na
  // coluna que falta — e o lote sem anexo nesta rodada apagava o de quem tinha (mesma regra dos outros coletores).
  const grupos = new Map();
  for (const r of prontos) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  for (const g of grupos.values()) {
    const { error } = await supabase.from('imoveis_leilao').upsert(g, { onConflict: 'fonte_id', ignoreDuplicates: false });
    if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  }
  console.log(`✅ ${prontos.length} imóveis do cluster Gestão de Leilões gravados/atualizados.`);
  // SAÚDE DA FONTE (08/08): entra no monitor de regressão junto das demais. Antes esta fonte
  // não escrevia em `fonte_saude`, então nunca ganhava piso aprendido e uma quebra passaria batido.
  // COLETA PARCIAL TAMBÉM PRECISA DO SINAL: se a cota acabou no MEIO da rodada, o total sai
  // legitimamente menor e o teste de regressão gritaria "queda vs anterior" sobre um número
  // que a nossa própria decisão de orçamento encolheu. `semCota` suprime a acusação sem
  // mascarar o total — o número gravado continua sendo o que de fato foi coletado.
  await registrarSaude(supabase, 'GESTAOLEILOES', prontos, ESTRATEGIA,
    semCotaVisto ? { semCota: true } : undefined);
  await registrarConhecimento(supabase, {
    // `acesso`/`custo` são o caminho que ESTA execução usou, não o que o scraper sabe fazer:
    // gravar 'pago' numa coleta residencial é o instrumento reportando outra coisa (forma #10).
    fonte: 'GESTAOLEILOES', plataforma: 'GestaoDeLeiloes(PHP)',
    acesso: GRATIS ? 'gratis-direto+banco' : RESIDENCIAL ? 'residencial' : 'brightdata', custo: RESIDENCIAL || GRATIS ? 'gratis' : 'pago',
    anti_bot: 'cloudflare', enumeracao: 'home_idLeilao→evento_inline', url_lote: '/lote.php?idLote={id}',
    scraper: 'scraper-gestao.mjs', qualidade: qualidadeColeta(prontos),
  });
}

// Qual caminho serviu esta execução. Sem este número, "o Chromium nunca precisou entrar" e
// "o Chromium entrou em tudo" ficam idênticos no log — e a segunda é o sinal de que o site
// endureceu, que é justamente o que a rede de segurança existe para não esconder.
function logPlacarResidencial(tag) {
  if (GRATIS) console.log(`  🆓 [${tag}] via grátis: ${viaGratis.direto} direto · ${viaGratis.banco} pelo banco · ${viaGratis.falha} sem resposta`);
  const p = estatisticaResidencial();
  if (p.fetch + p.navegador + p.falha === 0) return;   // rodou pelo caminho pago: nada a dizer
  console.log(`  🏠 [${tag}] caminho residencial: ${p.fetch} por fetch puro · ${p.navegador} pelo Chromium (rede de segurança) · ${p.falha} sem resposta`);
}

// `process.exit(0)` FIXO apagava o `process.exitCode = 1` que o caminho "nada a gravar"
// acabara de definir — a coleta falhava e o processo saía verde mesmo assim. Agora o
// código de saída é o que o main decidiu (0 por padrão, 1 quando não coletou nada).

main()
  .then(() => { logPlacarResidencial('GESTAO'); return fecharHeadless().finally(() => process.exit(process.exitCode || 0)); })
  .catch(e => { console.error(e); logPlacarResidencial('GESTAO'); fecharHeadless().finally(() => process.exit(1)); });
