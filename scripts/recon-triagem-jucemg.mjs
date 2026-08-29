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

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);

const CONC = Number(process.env.TRIAGEM_CONC || 6);
const LIMITE = Number(process.env.TRIAGEM_LIMITE || 0);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const lista = JSON.parse(readFileSync(new URL('./dados/jucemg-dominios.json', import.meta.url), 'utf8'));
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
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, redirect: 'follow', signal: ctrl.signal });
    const html = (await r.text()).slice(0, 400000);
    return { status: r.status, html, url: r.url, headers: r.headers, servidor: r.headers.get('server') || null };
  } catch (e) {
    return { status: 0, html: '', url, headers: new Headers(), erro: String(e?.message || e).slice(0, 120) };
  } finally { clearTimeout(t); }
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
