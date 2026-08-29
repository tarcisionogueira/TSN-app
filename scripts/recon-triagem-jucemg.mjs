/**
 * TRIAGEM DOS LEILOEIROS DA JUCEMG (29/08) — descobre QUAL PLATAFORMA cada site roda.
 *
 * POR QUE EXISTE: o dono trouxe a lista oficial da Junta Comercial de MG (236 leiloeiros).
 * Cruzada com o acervo, só 6 estavam no sistema — sobram 141 sites. A pergunta dele foi
 * "quanto custa trazer", e a resposta honesta é: **depende da plataforma, não do leiloeiro**.
 * As 34 fontes que já temos não são 34 parsers — SOLEON serve 4 (CALIL, VEGAS, TORRES3,
 * RJLEILOES) e a família Superbid serve outras 4. Se 40 destes 141 rodarem SOLEON, os 40
 * entram configurando um array. Sem saber a plataforma, qualquer estimativa é chute.
 *
 * ESTE SCRIPT NÃO COLETA IMÓVEL. Ele visita a home (e no máximo dois caminhos de catálogo),
 * lê a assinatura da plataforma e grava em `leiloeiro_triagem`. Uma requisição por site na
 * maioria dos casos.
 *
 * ⚠️ **SÓ VIA GRÁTIS, DE PROPÓSITO — o Bright Data NÃO é chamado aqui.** O teto semanal já
 * ficou saturado 4 semanas seguidas, e gastar cota paga para DESCOBRIR o que existe seria
 * gastar antes de saber se vale. Site que bloqueia o acesso grátis é justamente o resultado
 * que interessa: ele entra na lista "custa dinheiro", que é o que o dono pediu separado.
 *
 * ⚠️ E BLOQUEIO NÃO É AUSÊNCIA. `status_http` e `bloqueado` são gravados sempre, separados de
 * `plataforma`. Fundir "não consegui ler" com "não achei nada" produziria uma lista de sites
 * "sem imóveis" que na verdade nunca foram lidos — a forma de falha nº 1 do CLAUDE.md, aqui
 * capaz de fazer o dono descartar 30 leiloeiros bons.
 *
 * Env: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY. Opcionais: TRIAGEM_CONC (6), TRIAGEM_LIMITE.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fetchHeadless, fecharHeadless } from './lib/fetch-residencial.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const CONC = Number(process.env.TRIAGEM_CONC || 6);
const LIMITE = Number(process.env.TRIAGEM_LIMITE || 0);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

// ── MODO RESIDENCIAL: LER O QUE O CLOUDFLARE RECUSOU, DE GRAÇA (29/08) ─────────────────────
// A triagem da JUCEMG deixou **53 sites como `bloqueado`** — 51 deles com `plataforma: null`,
// e o null aqui NÃO quer dizer "não roda plataforma conhecida": quer dizer que o Cloudflare
// devolveu "Just a moment..." e o HTML nunca foi lido. São 53 leiloeiros que hoje entram na
// conta como "custa Bright Data" sem que ninguém saiba se dois deles já teriam parser pronto
// (dois JÁ SE SABE que sim: adrianoleiloeiro e angelabecharaleiloes, ambos Superbid).
//
// O runner residencial existe exatamente para isso — Chromium real, IP de casa, ZERO cota
// paga. Com `TRIAGEM_HEADLESS=1` o `pegar()` cai no navegador quando o fetch simples é
// bloqueado; com `TRIAGEM_BLOQUEADOS=1` a lista vem do BANCO (os que já falharam), em vez do
// JSON — então a rodada custa 53 páginas e não 141, e serve QUALQUER junta, não só a de MG.
//
// ⚠️ Continua valendo a regra do arquivo: Bright Data NÃO é chamado aqui em hipótese nenhuma.
// Descobrir o que existe segue sendo de graça; o que muda é que agora o "de graça" alcança
// quem estava atrás do Cloudflare.
const HEADLESS = process.env.TRIAGEM_HEADLESS === '1';
const SO_BLOQUEADOS = process.env.TRIAGEM_BLOQUEADOS === '1';

// ── MOTOR REPETÍVEL, NÃO SCRIPT DE UMA VEZ (item 8, 29/08) ──────────────────────────────────
// Classificar os 141 sites da JUCEMG levou 2 minutos e custou zero. O mesmo script serve
// qualquer junta comercial — JUCESP, JUCERJA, JUCEES — trocando o arquivo de entrada. Em vez de
// descobrir leiloeiro por acaso, vira varredura por junta.
//
// `TRIAGEM_LISTA` aponta o arquivo (default: a JUCEMG). O formato é o mesmo:
//   [{ "dominio": "exemplo.com.br", "leiloeiros": ["Fulano de Tal"] }, …]
// e `scripts/dados/` guarda um por junta. O extrator do PDF vive em `docs/` como receita —
// juntas publicam a lista em PDF com fonte de CMap próprio, que precisa ser decodificado.
const ARQUIVO = process.env.TRIAGEM_LISTA || './dados/jucemg-dominios.json';
let lista;
if (SO_BLOQUEADOS) {
  // A lista vem do BANCO: exatamente quem já foi medido e recusou o acesso grátis. Reprocessar
  // os 141 do JSON gastaria Chromium em 88 sites que o fetch simples já lê bem.
  const { data, error } = await supabase.from('leiloeiro_triagem')
    .select('dominio, leiloeiros').eq('bloqueado', true).order('dominio');
  // `error` conferido: sem isto uma falha de leitura viraria "lista vazia" e o script diria
  // "0 domínios · concluído" — sucesso relatado sobre nada feito.
  if (error) { console.error('[triagem] leitura dos bloqueados falhou:', error.message); process.exit(1); }
  lista = (data || []).map(r => ({ dominio: r.dominio, leiloeiros: r.leiloeiros || [] }));
  if (!lista.length) { console.log('[triagem] nenhum site bloqueado pendente — nada a fazer.'); process.exit(0); }
  console.log(`[triagem] BLOQUEADOS do banco · ${lista.length} domínio(s)${HEADLESS ? ' · via Chromium residencial' : ''}`);
} else {
  lista = JSON.parse(readFileSync(new URL(ARQUIVO, import.meta.url), 'utf8'));
  console.log(`[triagem] lista: ${ARQUIVO} · ${lista.length} domínio(s)`);
}
const alvos = LIMITE ? lista.slice(0, LIMITE) : lista;

/**
 * ASSINATURAS. A ordem importa: as específicas vêm antes das genéricas, senão um site SOLEON
 * feito em WordPress seria classificado como "WordPress" — e WordPress não diz nada sobre como
 * enumerar lote, que é a única coisa que interessa aqui.
 *
 * `parser` aponta para o que JÁ EXISTE no repositório. É o campo que separa "grátis de
 * verdade" (configurar um tenant) de "grátis mas dá trabalho" (escrever parser novo).
 */
const ASSINATURAS = [
  { chave: 'SOLEON',      parser: 'scripts/scraper-soleon.mjs',    re: /soleon|\/item\/\d+\/detalhes/i },
  { chave: 'SUPERBID',    parser: 'scripts/lib/motor/fontes/emiliomatos.mjs', re: /superbid|\/busca\/segmento\/|mbv\.com/i },
  { chave: 'GESTAOPHP',   parser: 'scripts/scraper-gestao.mjs',    re: /lote\.php\?idlote|gestaodeleiloes/i },
  { chave: 'LEILAOPRO',   parser: 'scripts/scraper-leilaopro.mjs', re: /lote_id\/\d+|artisticweb|\/leilao\/lotes\//i },
  { chave: 'DEFAULTCLEAN',parser: 'scripts/scraper-pecini.mjs',    re: /__VIEWSTATE/i },
  { chave: 'SATO',        parser: 'scripts/scraper-sato.mjs',      re: /api-publica\/stale|q-app|quasar/i },
  { chave: 'LEILOFY',     parser: 'scripts/scraper-puppeteer.mjs', re: /leilofy|leiloaria\s*smart/i },
  // Genéricas: dizem só COMO renderiza, não como enumerar. Viram nível 2 (parser novo).
  { chave: 'NEXTJS',      parser: null, re: /__NEXT_DATA__|\/_next\//i },
  { chave: 'NUXT',        parser: null, re: /__NUXT__|\/_nuxt\//i },
  { chave: 'WORDPRESS',   parser: null, re: /wp-content|wp-json/i },
  { chave: 'SPA',         parser: null, re: /<div id="(app|root)"><\/div>/i },
];

const CAMINHOS = ['', '/imoveis', '/lotes/imovel'];   // home + dois palpites baratos

/**
 * PISTAS: de onde o site carrega script e CSS, o que a meta `generator` declara e o título.
 * É isso que identifica o FORNECEDOR quando nenhuma assinatura conhecida bate — um
 * `cdn.plataformaX.com.br` em 20 sites diferentes é uma família nova que vale um parser só.
 * Sem isso, "DESCONHECIDA" seria um beco: 63 sites e nenhuma informação para agir.
 */
function pistasDe(html) {
  const hosts = new Set();
  for (const m of html.matchAll(/(?:src|href)=["']https?:\/\/([a-z0-9.-]+)/gi)) {
    const h = m[1].toLowerCase();
    if (/google|gstatic|facebook|jquery|bootstrapcdn|cloudflare\.com|fontawesome|jsdelivr|unpkg|youtube|instagram|whatsapp|gtm|doubleclick|hotjar|tawk|recaptcha/.test(h)) continue;
    hosts.add(h);
  }
  const gen = (html.match(/<meta[^>]+name=["']generator["'][^>]+content=["']([^"']{0,80})/i) || [])[1] || '';
  return [gen && `gen:${gen}`, ...[...hosts].slice(0, 8)].filter(Boolean).join(' ').slice(0, 400);
}
const tituloDe = (html) => ((html.match(/<title[^>]*>([^<]{0,150})/i) || [])[1] || '').replace(/\s+/g, ' ').trim();
const sleep = ms => new Promise(r => setTimeout(r, ms));

function ehBloqueio(status, html, headers) {
  if (status === 403 || status === 429 || status === 503) return true;
  if (/just a moment|cf-browser-verification|checking your browser|attention required/i.test(html)) return true;
  if (headers.get('cf-mitigated')) return true;
  return false;
}

async function pegar(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  let r0;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: ctrl.signal });
    const html = (await r.text()).slice(0, 400000);
    r0 = { status: r.status, html, url: r.url, headers: r.headers, servidor: r.headers.get('server') || null };
  } catch (e) {
    r0 = { status: 0, html: '', url, headers: new Headers(), erro: String(e?.message || e).slice(0, 120) };
  } finally { clearTimeout(t); }

  // O navegador só entra QUANDO O SIMPLES NÃO SERVIU — nunca por padrão. Chromium custa
  // segundos por página; gastá-lo em site que responde 200 ao fetch seria trocar uma rodada
  // de 2 minutos por uma de meia hora sem ganhar informação nenhuma.
  if (!HEADLESS || !(r0.erro || ehBloqueio(r0.status, r0.html, r0.headers))) return r0;
  const html = await fetchHeadless(url, { timeoutMs: 45000 });
  // `null` do headless é "não consegui", NÃO "a página está vazia" — devolve o resultado do
  // fetch simples (que já carrega o 403/erro) em vez de fabricar um 200 vazio. Fundir os dois
  // faria o site sair da lista de bloqueados sem nunca ter sido lido: a forma nº 1 do CLAUDE.md,
  // e aqui ela apagaria justamente os leiloeiros que esta rodada existe para recuperar.
  if (html == null) return { ...r0, headlessTentou: true };
  return { status: 200, html: html.slice(0, 400000), url, headers: new Headers(),
           servidor: r0.servidor, headlessTentou: true, viaHeadless: true };
}

async function triar(item) {
  const base = `https://www.${item.dominio}`;
  let melhor = null, bloqueado = false, erro = null, servidor = null;
  let statusHome = 0, urlFinal = base, titulo = '', pistas = '', catalogoOk = null;

  for (const c of CAMINHOS) {
    let r = await pegar(base + c);
    if (r.erro) {                       // tenta sem www antes de desistir do caminho
      const r2 = await pegar(`https://${item.dominio}${c}`);
      if (!r2.erro) r = r2;
    }
    servidor = r.servidor || servidor;

    // ⚠️ O STATUS DA HOME É GRAVADO SEPARADO DO STATUS DOS CAMINHOS CHUTADOS. Na v1 uma
    // variável só era sobrescrita a cada caminho, e como quase todo site devolve 404 em
    // `/lotes/imovel` (um palpite meu, não uma rota do site), a coluna acabava dizendo "404"
    // sobre sites cuja home respondia 200. O instrumento reportava o meu chute com o nome do
    // site — a mesma família de defeito que este arquivo existe para não cometer.
    if (!c) {
      statusHome = r.status; urlFinal = r.url;
      if (r.html) { titulo = tituloDe(r.html); pistas = pistasDe(r.html); }
    } else if (r.status === 200 && !r.erro) {
      catalogoOk = c;
    }

    if (r.erro) { erro = r.erro; continue; }
    if (ehBloqueio(r.status, r.html, r.headers)) { bloqueado = true; continue; }
    for (const a of ASSINATURAS) if (a.re.test(r.html)) { melhor = a; break; }
    if (melhor?.parser) break;          // assinatura específica encerra; genérica segue tentando
  }

  return {
    dominio: item.dominio,
    leiloeiros: item.leiloeiros,
    status_http: statusHome,
    catalogo_ok: catalogoOk,
    titulo: titulo.slice(0, 150),
    pistas,
    url_final: String(urlFinal).slice(0, 300),
    servidor,
    bloqueado,
    plataforma: melhor?.chave || (bloqueado ? null : 'DESCONHECIDA'),
    parser_existente: melhor?.parser || null,
    erro,
    medido_em: new Date().toISOString(),
  };
}

const resultados = [];
for (let i = 0; i < alvos.length; i += CONC) {
  const bloco = alvos.slice(i, i + CONC);
  const rs = await Promise.all(bloco.map(triar));
  resultados.push(...rs);
  console.log(`[triagem] ${resultados.length}/${alvos.length}`);
  await sleep(400);
}

// GRAVA EM LOTE, e o resultado do upsert é CONFERIDO. Um insert que não grava devolve
// `error` no supabase-js, mas ignorá-lo produziria um log dizendo "141 triados" com a
// tabela vazia — relatório bonito em cima de nada.
const { error } = await supabase.from('leiloeiro_triagem').upsert(resultados, { onConflict: 'dominio' });
if (error) { console.error('[triagem] NÃO gravou:', error.message); process.exit(1); }

const porPlat = {};
for (const r of resultados) {
  const k = r.bloqueado ? 'BLOQUEADO(pago)' : (r.plataforma || 'DESCONHECIDA');
  porPlat[k] = (porPlat[k] || 0) + 1;
}
console.log('[triagem] resumo', JSON.stringify(porPlat, null, 1));
console.log('[triagem] com parser pronto:', resultados.filter(r => r.parser_existente).length);

// ── O QUE ESTA RODADA RECUPEROU ──────────────────────────────────────────────────────────
// Medir o desfecho, não só o esforço: "53 sites visitados" não diz se algum saiu do balde
// pago. O que interessa é quantos DEIXARAM de estar bloqueados e, destes, quantos já têm
// parser — que é a diferença entre "configurar um tenant" e "escrever parser novo".
if (SO_BLOQUEADOS) {
  const destravados = resultados.filter(r => !r.bloqueado);
  const comParser = destravados.filter(r => r.parser_existente);
  console.log(`[triagem] DESTRAVADOS pelo residencial: ${destravados.length} de ${resultados.length}`);
  if (comParser.length) {
    console.log(`[triagem] …e ${comParser.length} JÁ TÊM PARSER (entram por configuração):`);
    for (const r of comParser) console.log(`           ${r.dominio} → ${r.plataforma} (${r.parser_existente})`);
  }
  const aindaPagos = resultados.filter(r => r.bloqueado);
  if (aindaPagos.length) console.log(`[triagem] seguem exigindo Bright Data: ${aindaPagos.length}`);
  // ⚠️ Plataforma descoberta NÃO é lote coletado. Antes de subir tenant, dry-run: em 29/08
  // 11 sites classificados como Superbid enumeraram ZERO lotes ("menciona" ≠ "roda").
  console.log('[triagem] ⚠️ antes de subir tenant: DRY-RUN. Assinatura de HTML não prova catálogo.');
}

await fecharHeadless();
