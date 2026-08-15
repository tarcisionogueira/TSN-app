/**
 * /api/publico — PÁGINAS PÚBLICAS INDEXÁVEIS (o que o Google consegue ler).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * O PROBLEMA QUE ISTO RESOLVE (diagnóstico de 02/08, a partir do dono: "pesquisando
 * palavras-chave de leilão o meu site não aparece"):
 *
 * O app é uma SPA com HashRouter — tudo mora depois do `#`. E o Google DESCARTA o
 * fragmento: `/#/buscar` e `/#/planos` são, para ele, a MESMA URL que `/`. Ou seja, um
 * site com 33 mil imóveis tinha exatamente UMA página indexável — a home. Não havia como
 * ranquear para "casa em leilão em Campinas": essa página simplesmente não existia para o
 * buscador. O sitemap listava 7 URLs com `#`, que colapsam todas na raiz.
 *
 * A CORREÇÃO, sem mexer no roteador do app (risco alto, ganho igual): rotas SEM hash,
 * renderizadas NO SERVIDOR, com conteúdo de verdade:
 *   /leiloes                    → índice nacional (todos os estados com acervo)
 *   /leiloes/:uf                → estado: cidades com mais imóveis
 *   /leiloes/:uf/:cidade        → cidade: lista os imóveis (paginada)
 *   /leilao/:id                 → ficha pública do imóvel
 *
 * NÍVEL DE EXPOSIÇÃO — decidido para não dar de graça o que é o produto: estas páginas
 * mostram EXATAMENTE o que o visitante não logado já vê hoje no teaser (`ImovelGate`) e o
 * que a RLS "Leitura pública" de `imoveis_leilao` já libera: título, tipo, cidade/UF,
 * bairro, área, valores, datas e foto. O que é o PRODUTO — análise de viabilidade, parecer
 * jurídico, documentos, Índice — continua atrás do cadastro. É o funil clássico: o buscador
 * traz a pessoa pelo imóvel, o cadastro entrega a análise.
 *
 * NÃO É a mesma coisa que `/i/:id` (og-share): aquele existe para o preview de link
 * compartilhado, é `noindex` e redireciona para o app. Este aqui é conteúdo para ser lido —
 * não redireciona ninguém, porque página que redireciona não indexa.
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const config = { runtime: 'nodejs', maxDuration: 15 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SITE = 'https://www.bidprobrasil.com.br';
const POR_PAGINA = 36;

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const UF_NOME = { AC:'Acre', AL:'Alagoas', AM:'Amazonas', AP:'Amapá', BA:'Bahia', CE:'Ceará', DF:'Distrito Federal', ES:'Espírito Santo', GO:'Goiás', MA:'Maranhão', MG:'Minas Gerais', MS:'Mato Grosso do Sul', MT:'Mato Grosso', PA:'Pará', PB:'Paraíba', PE:'Pernambuco', PI:'Piauí', PR:'Paraná', RJ:'Rio de Janeiro', RN:'Rio Grande do Norte', RO:'Rondônia', RR:'Roraima', RS:'Rio Grande do Sul', SC:'Santa Catarina', SE:'Sergipe', SP:'São Paulo', TO:'Tocantins' };
const TIPO_LABEL = { casa:'Casa', apartamento:'Apartamento', terreno:'Terreno', comercial:'Imóvel comercial', rural:'Imóvel rural', galpao:'Galpão', sala:'Sala comercial', vaga:'Vaga de garagem', imovel:'Imóvel' };

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const brl = (v) => (Number(v) > 0 ? `R$ ${Math.round(Number(v)).toLocaleString('pt-BR')}` : null);
// A data da praça vem do scraper em formatos variados. Só reformata o que for ISO reconhecível
// e devolve o resto como veio — inventar formato é pior que repetir a fonte. Sem isto a página
// mostrava "2026-08-31" ao visitante, que é data de banco, não de gente.
const dataBR = (s) => { const t = String(s || '').trim(); if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[3]}/${m[2]}/${m[1]}` : t.slice(0, 40); };
const MODALIDADE_LABEL = { judicial: 'Leilão judicial', extrajudicial: 'Leilão extrajudicial', licitacao_aberta: 'Licitação aberta', venda_direta: 'Venda direta' };
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 70);

async function sb(path) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Prefer: 'count=exact' },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) return { linhas: null, total: 0 };
    const total = Number(String(r.headers.get('content-range') || '').split('/')[1]) || 0;
    return { linhas: await r.json(), total };
  } catch { return { linhas: null, total: 0 }; }
}

/**
 * CONTAGEM VEM DO BANCO, NUNCA DE UM `select` CRU.
 * A primeira versão desta página contava no JavaScript, pedindo as linhas com `limit=100000`.
 * O PostgREST corta em 1.000 linhas SEM avisar: a página foi ao ar anunciando "980 imóveis em
 * 5 estados" quando o acervo tem 33.032 em 28 UFs — erro com cara de acerto, e no lugar mais
 * caro possível (o texto que o Google indexa). Agora quem agrega é o Postgres, devolvendo UM
 * valor jsonb, que não tem teto de linhas.
 */
async function rpc(nome, corpo = {}) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo), signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── Casca HTML. Uma só, para todas as páginas ────────────────────────────────
// Sem framework e sem JS de aplicação: a página tem que estar PRONTA no HTML que o
// servidor devolve. Se depender de JS para aparecer, volta ao problema de origem.
function pagina({ titulo, desc, canonical, corpo, jsonld, indexar = true, migalha = [] }) {
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${esc(titulo)}</title>
<meta name="description" content="${esc(desc)}"/>
<meta name="robots" content="${indexar ? 'index, follow, max-image-preview:large' : 'noindex, follow'}"/>
<link rel="canonical" href="${esc(canonical)}"/>
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48.png?v=4"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="BidPro Brasil"/>
<meta property="og:title" content="${esc(titulo)}"/>
<meta property="og:description" content="${esc(desc)}"/>
<meta property="og:url" content="${esc(canonical)}"/>
<meta property="og:image" content="${SITE}/og-image.png?v=4"/>
<meta property="og:locale" content="pt_BR"/>
<meta name="twitter:card" content="summary_large_image"/>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld)}</script>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&family=League+Spartan:wght@700;800;900&display=swap" rel="stylesheet">
<style>
/* ═══ Alinhado ao docs/MARCA.md (14/08, pedido do dono: "revisar o layout para ficar de
   acordo com os padrões"). O conteúdo desta página já estava certo; o que destoava era a
   casca — ela nasceu como HTML de SEO e não seguia o código da marca:
     • as fontes da marca (League Spartan nos títulos, Inter nos textos) NÃO eram carregadas:
       o font-family Inter do CSS caía no fallback do sistema, e a página parecia de outro
       produto ao lado do app;
     • o cabeçalho era um texto "BidPro Brasil" em vez do lockup (/logo.svg) que toda tela
       usa, sem a sub-linha "LEILÃO & INVESTIMENTOS";
     • tinta #0f172a em vez do preto da marca (#111111), e raios/bordas fora da escala do app
       (cartões 16px, superfícies #f8fafc, linha #e2e8f0).
   Nada de JS foi acrescentado: a página continua pronta no HTML que o servidor devolve. */
:root{--azul:#0D63DB;--azul-fundo:#0B4BA6;--tinta:#111111;--cinza:#64748b;--linha:#e2e8f0;--superficie:#f8fafc}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%;text-size-adjust:100%}
body{margin:0;font-family:'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:var(--tinta);background:var(--superficie);line-height:1.6}
a{color:var(--azul);text-decoration:none}a:hover{text-decoration:underline}
/* ═══ CABEÇALHO — espelha src/components/Header.jsx (15/08, pedido do dono: "manter o
   layout, dessa forma fica desconectado do padrão"). A revisão de 14/08 trocou a tinta e a
   fonte, mas manteve uma casca com medidas próprias, e era isso que destoava ao navegar
   entre esta página e o app: logo de 34px contra 40px, faixa de 1080 contra 1280, uma
   sub-linha "LEILÃO & INVESTIMENTOS" que NENHUMA tela do app tem, e — o que mais pesava —
   nenhum dos links de navegação, então o cabeçalho parecia de outro site.
   Agora as medidas são as do app: faixa 1280 (o app também usa header mais largo que o
   conteúdo), altura mínima 62, logo 40, links em 13px/#94a3b8 com o ativo em #084BA6, e o
   "Entrar" com borda #334155. O "Criar conta grátis" NÃO existe no app e fica: aqui ele é
   o CTA da página de aquisição, e tirá-lo custaria conversão sem aproximar o layout.
   Continua sem JS — o menu do celular é um <details>, que é o hambúrguer do app em HTML
   puro. A página segue pronta no HTML que o servidor devolve. */
header{background:#111111;color:#fff}
header .in{max-width:1280px;margin:0 auto;padding:8px 20px;min-height:62px;display:flex;align-items:center;justify-content:space-between;gap:12px}
header .marca{display:flex;align-items:center;min-width:0;flex-shrink:0}
header .marca img{height:40px;width:auto;display:block}
header nav{display:flex;gap:4px;align-items:center;flex-wrap:wrap;justify-content:flex-end;min-width:0}
header nav a{display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;color:#94a3b8;font-weight:600;font-size:13px;text-decoration:none!important;white-space:nowrap}
header nav a:hover{color:#fff}
header nav a.ativo{background:#084BA6;color:#fff}
header nav a.entrar{border:1px solid #334155;margin-left:4px}
.cta{background:var(--azul);color:#fff!important;padding:7px 14px;border-radius:8px;font-weight:700;font-size:13px;text-decoration:none!important;white-space:nowrap;flex-shrink:0;margin-left:4px}
.cta:hover{background:var(--azul-fundo)}
/* O CTA existe duas vezes de propósito: dentro da <nav> no desktop (última posição, como
   um item do menu) e solto ao lado do ☰ no celular, onde a <nav> inteira some. Só um dos
   dois é exibido por vez. */
.cta-mob{display:none}
/* Menu do celular sem uma linha de JS. O <summary> vira o ☰ e o painel abre abaixo do
   cabeçalho, como o menu mobile do app. */
.menu-mob{display:none;position:relative;flex-shrink:0}
.menu-mob summary{list-style:none;cursor:pointer;color:#fff;padding:6px 8px;line-height:1;font-size:22px}
.menu-mob summary::-webkit-details-marker{display:none}
.menu-mob .drop{position:absolute;right:0;top:calc(100% + 8px);background:#111111;border:1px solid #1e293b;border-radius:12px;padding:8px;display:flex;flex-direction:column;gap:4px;min-width:210px;z-index:50;box-shadow:0 12px 32px rgba(0,0,0,.4)}
.menu-mob .drop a{padding:10px 14px;border-radius:8px;color:#94a3b8;font-weight:600;font-size:14px;text-decoration:none!important;white-space:nowrap}
.menu-mob .drop a.ativo{background:#084BA6;color:#fff}
main{max-width:1080px;margin:0 auto;padding:24px 20px 56px}
.mig{font-size:12.5px;color:var(--cinza);margin-bottom:14px}
h1,h2,h3{font-family:'League Spartan','Inter',sans-serif;letter-spacing:-0.2px}
h1{font-size:28px;font-weight:900;line-height:1.2;margin:0 0 8px}
h2{font-size:20px;font-weight:800;margin:32px 0 12px}
.sub{color:var(--cinza);margin:0 0 22px;font-size:15px}
/* 768px é o MESMO ponto de virada do app (a regra .hide-mobile/.show-mobile do Header.jsx):
   abaixo dele os links saem da barra e vão para o ☰, como lá. */
@media(max-width:768px){
  header nav{display:none}
  .menu-mob{display:block}
  .cta-mob{display:inline-block}
}
@media(max-width:560px){
  h1{font-size:23px}h2{font-size:18px}
  main{padding:18px 16px 48px}
  header .in{padding:8px 16px}
  header .marca img{height:34px}
  .cta{padding:7px 12px;font-size:12.5px}
}
/* 360px e abaixo: o texto do CTA encolhe mais um pouco para caber ao lado do logo e do ☰
   sem empurrar a barra (o verificador de responsivo reprova rolagem horizontal). */
@media(max-width:360px){
  header .marca img{height:30px}
  .cta{padding:6px 10px;font-size:12px}
}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.card{background:#fff;border:1px solid var(--linha);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:box-shadow .15s,border-color .15s}
.card:hover{box-shadow:0 6px 20px rgba(15,23,42,.08);border-color:#cbd5e1}
.card img{width:100%;height:150px;object-fit:cover;background:#e2e8f0;display:block}
.card .c{padding:12px 14px;display:flex;flex-direction:column;gap:4px;flex:1}
.card .t{font-weight:700;font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .l{font-size:12.5px;color:var(--cinza)}
.card .v{font-size:17px;font-weight:900;color:var(--azul);margin-top:auto;padding-top:6px}
.tag{display:inline-block;font-size:11px;font-weight:800;color:#15803d;background:#dcfce7;padding:3px 9px;border-radius:999px}
.lista{display:flex;flex-wrap:wrap;gap:8px;margin:0;padding:0;list-style:none}
.lista li a{display:inline-block;background:#fff;border:1px solid var(--linha);border-radius:999px;padding:7px 15px;font-size:13.5px;font-weight:600}
.lista li a:hover{border-color:var(--azul);text-decoration:none}
.painel{background:#fff;border:1px solid var(--linha);border-radius:16px;padding:22px;margin-bottom:20px}
/* Ficha de valores no padrão dos cartões do app: rótulo pequeno em caixa alta, número
   grande. O minmax de 140px cabe em duas colunas num iPhone de 390 e nunca vaza. */
.dados{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin:18px 0 4px}
.dados div{background:var(--superficie);border:1px solid var(--linha);border-radius:12px;padding:12px 14px;min-width:0}
.dados div span{display:block;font-size:10.5px;color:var(--cinza);text-transform:uppercase;letter-spacing:.6px;font-weight:800;margin-bottom:3px}
.dados div strong{font-size:19px;font-weight:900;line-height:1.25;display:block;overflow-wrap:anywhere}
.pag{display:flex;gap:10px;justify-content:center;margin-top:28px;font-size:14px}
/* Busca por cidade — HTML puro, sem JS: a página pública precisa abrir rápido e funcionar
   para o robô do buscador tanto quanto para a pessoa. */
.busca{background:#fff;border:1px solid var(--linha);border-radius:14px;padding:18px;margin:0 0 24px}
.busca form{display:flex;gap:10px;flex-wrap:wrap}
/* 16px, não 15: abaixo disso o Safari do iOS dá zoom na página inteira ao focar o campo e
   NÃO desfaz — a pessoa fica com a página torta até pinçar na mão. Mesmo defeito corrigido
   no app em 14/08; esta página é servida por outro caminho e tem o CSS dela. */
.busca input{flex:1;min-width:220px;padding:12px 14px;border:1px solid var(--linha);border-radius:10px;font-size:16px;font-family:inherit;color:inherit;background:#fff}
.busca input:focus{outline:2px solid var(--azul);outline-offset:1px}
.busca button{padding:12px 22px;border:none;border-radius:10px;background:var(--azul);color:#fff;font-weight:800;font-size:15px;cursor:pointer;font-family:inherit}
.busca .dica{font-size:12.5px;color:var(--cinza);margin:10px 0 0}
/* Bloco de cadastro no lote: o que é do assinante fica visível como PROMESSA, não escondido. */
.trava{background:linear-gradient(180deg,#eff6ff,#fff);border:1px solid #bfdbfe;border-radius:16px;padding:22px;margin:22px 0}
.trava h3{margin:0 0 12px;font-size:17px;font-weight:800}
.trava ul{margin:0 0 18px;padding-left:20px;color:#475569;font-size:14px;line-height:1.9}
.trava .cta{display:inline-block}
.trava .obs{font-size:12.5px;color:var(--cinza);margin:12px 0 0}
footer{border-top:1px solid var(--linha);padding:26px 20px;color:var(--cinza);font-size:12.5px;background:#fff}
footer .in{max-width:1080px;margin:0 auto}
/* O app é claro em toda tela; a página pública seguia o tema do sistema e ficava escura para
   metade das pessoas — duas caras para a mesma marca. Mantém-se clara, como o resto. */
</style>
</head><body>
<header><div class="in">
  <a class="marca" href="${SITE}/" aria-label="BidPro Brasil — página inicial">
    <!-- 150×40 é a proporção real do lockup (viewBox 180×48) na altura que o app usa:
         atributos certos evitam o pulo de layout enquanto o SVG carrega. O CSS manda. -->
    <img src="/logo.svg" alt="BidPro Brasil" width="150" height="40"/>
  </a>
  <!-- Os MESMOS quatro links do menu de visitante do app, na mesma ordem. "Buscar Leilões"
       entra como ativo porque toda página servida daqui é do acervo público. -->
  <nav>
    <a href="${SITE}/">Home</a>
    <a href="${SITE}/#/calculadora">Calculadora</a>
    <a class="ativo" href="${SITE}/leiloes">Buscar Leilões</a>
    <a href="${SITE}/#/planos">Planos</a>
    <a class="entrar" href="${SITE}/#/login">Entrar</a>
    <a class="cta" href="${SITE}/#/login?modo=cadastro">Criar conta grátis</a>
  </nav>
  <a class="cta cta-mob" href="${SITE}/#/login?modo=cadastro">Criar conta grátis</a>
  <details class="menu-mob">
    <summary aria-label="Abrir menu" role="button">&#9776;</summary>
    <div class="drop">
      <a href="${SITE}/">Home</a>
      <a href="${SITE}/#/calculadora">Calculadora</a>
      <a class="ativo" href="${SITE}/leiloes">Buscar Leilões</a>
      <a href="${SITE}/#/planos">Planos</a>
      <a href="${SITE}/#/login">Entrar</a>
    </div>
  </details>
</div></header>
<main>
${migalha.length ? `<nav class="mig">${migalha.map((m, i) => (m.url ? `<a href="${esc(m.url)}">${esc(m.nome)}</a>` : esc(m.nome)) + (i < migalha.length - 1 ? ' › ' : '')).join('')}</nav>` : ''}
${corpo}
</main>
<footer><div class="in">
  <p><strong>BidPro Brasil</strong> — leilões de imóveis com análise de viabilidade, parecer jurídico e assessoria para arrematar com segurança.
  Também escrito como <em>Bid Pro Brasil</em>.</p>
  <p><a href="${SITE}/leiloes">Imóveis em leilão por estado</a> · <a href="${SITE}/#/planos">Planos</a> · <a href="${SITE}/#/termos">Termos</a> · <a href="${SITE}/#/privacidade">Privacidade</a></p>
</div></footer>
<!-- MEDIÇÃO DO ACERVO PÚBLICO (12/08). Estas páginas são servidas FORA do React, então o
     tracker de src/utils/tracker.js — que monta no main.jsx — nunca rodou aqui: as ~33 mil
     páginas de SEO, o principal ativo de aquisição, eram um ponto cego total. Não dava para
     saber se o Google trazia gente, de quais cidades, nem quantos seguiam para o cadastro.
     Snippet mínimo, sem dependência, que reusa a MESMA chave bp_aid do tracker do app —
     é isso que costura a visita anônima com o Cliente 360 quando a pessoa cria conta depois.
     Não guarda a URL do referrer, só o HOST (é o que interessa para aquisição e evita
     arrastar query string de terceiro para o nosso banco). -->
<script>
(function(){try{
  // Bot que executa JS (Googlebot renderiza) encheria o funil de visita que não é gente.
  if(/bot|crawl|spider|slurp|bingpreview|headless|lighthouse/i.test(navigator.userAgent||''))return;
  if(navigator.webdriver)return;
  var id=null;try{id=localStorage.getItem('bp_aid');if(!id){id=(window.crypto&&crypto.randomUUID?crypto.randomUUID():Date.now().toString(36)+Math.random().toString(36).slice(2,12));localStorage.setItem('bp_aid',id);}}catch(e){}
  if(!id)return;
  // '(direto)' EXPLÍCITO quando não há referrer. Se mandássemos null, o banco não distinguiria
  // "veio direto" de "não foi medido" — e o painel diria "213 vieram direto" para um período em
  // que a origem simplesmente não era coletada. Conclusão errada e cara: parece que SEO e
  // anúncio não trazem ninguém.
  var ref='(direto)';try{if(document.referrer){var h=new URL(document.referrer).hostname;if(h&&h!==location.hostname)ref=h;else ref='(interno)';}}catch(e){}
  // ORIGEM DO CLIQUE, primeiro toque. Estas paginas sao a porta de entrada do Ads e do SEO —
  // se o gclid nao for capturado AQUI, ele se perde no primeiro clique interno e a campanha
  // fica sem atribuicao nenhuma. Guardado no navegador; o servidor grava uma vez por anon_id.
  var orig=null;try{
    var sv=localStorage.getItem('bp_orig');
    if(sv){orig=JSON.parse(sv);}
    else{var q=new URLSearchParams(location.search),gt=function(k){return q.get(k)||null;};
      var o={gclid:gt('gclid'),gbraid:gt('gbraid'),wbraid:gt('wbraid'),utm_source:gt('utm_source'),
        utm_medium:gt('utm_medium'),utm_campaign:gt('utm_campaign'),utm_term:gt('utm_term'),
        utm_content:gt('utm_content'),referrer_host:(ref==='(direto)'||ref==='(interno)')?null:ref,
        landing:location.pathname};
      var temAlgo=false;for(var k in o){if(k!=='landing'&&o[k])temAlgo=true;}
      if(temAlgo){orig=o;localStorage.setItem('bp_orig',JSON.stringify(o));}}
  }catch(e){}
  var env=function(tipo,alvo,det){try{fetch('/api/track',{method:'POST',headers:{'Content-Type':'application/json'},keepalive:true,
    body:JSON.stringify({anon_id:id,origem:orig,eventos:[{tipo:tipo,rota:location.pathname,alvo:alvo||null,detalhe:det||null,ts:Date.now()}]})});}catch(e){}};
  env('pageview',location.pathname,ref);
  // Só o clique que INTERESSA (ir para cadastro/planos/lote): é o passo seguinte do funil.
  document.addEventListener('click',function(e){try{
    var a=e.target&&e.target.closest?e.target.closest('a'):null;if(!a)return;
    var h=a.getAttribute('href')||'',t=(a.textContent||'').trim().slice(0,60);
    if(/login|planos|criar conta|cadastro/i.test(h+' '+t))env('click',t||h,null);
  }catch(err){}},{passive:true});
}catch(e){}})();
</script>
</body></html>`;
}

function cardImovel(im) {
  const t = TIPO_LABEL[String(im.tipo || '').toLowerCase()] || 'Imóvel';
  const local = [im.bairro, im.cidade, im.estado].filter(Boolean).join(', ');
  const lance = brl(im.valor_minimo);
  const aval = brl(im.valor_avaliacao);
  const desc = Number(im.desconto_percentual) > 0 ? `${im.desconto_percentual}% abaixo da avaliação` : null;
  return `<article class="card">
    ${im.link_foto ? `<img src="${esc(im.link_foto)}" alt="${esc(t)} em leilão em ${esc(im.cidade || '')}" loading="lazy"/>` : ''}
    <div class="c">
      <a class="t" href="${SITE}/leilao/${esc(im.id)}/${slug(im.titulo || t)}">${esc(im.titulo || `${t} em leilão`)}</a>
      <div class="l">${esc(t)}${im.area_m2 > 0 ? ` · ${Math.round(im.area_m2)} m²` : ''}</div>
      <div class="l">${esc(local)}</div>
      ${desc ? `<div><span class="tag">${esc(desc)}</span></div>` : ''}
      <div class="v">${lance ? esc(lance) : aval ? esc(aval) : 'Consulte'}</div>
    </div>
  </article>`;
}

// Caixa de busca por cidade. Aparece no topo das páginas de lista — é o caminho que o
// visitante de anúncio espera ("digito minha cidade e vejo o que tem"), em vez de descer
// por Brasil → estado → cidade. Formulário GET simples: sem JS, funciona no robô e no
// celular ruim, e a URL do resultado é compartilhável.
function caixaBusca(valor = '') {
  return `<div class="busca">
    <form action="${SITE}/leiloes/buscar" method="get">
      <input name="cidade" value="${esc(valor)}" placeholder="Digite a cidade — ex.: Campinas, Rio de Janeiro, Goiânia" aria-label="Cidade" autocomplete="off"/>
      <button type="submit">Ver imóveis</button>
    </form>
    <p class="dica">Ou navegue por estado abaixo.</p>
  </div>`;
}

// ── /leiloes/buscar?cidade= ──────────────────────────────────────────────────
async function paginaBusca(termo) {
  const q = String(termo || '').trim().slice(0, 60);
  const achados = q.length >= 2 ? await rpc('acervo_busca_cidade', { p_q: q }) : [];
  const lista = Array.isArray(achados) ? achados : [];

  // Resultado da busca NÃO entra no índice: é conteúdo gerado por consulta, muda a cada
  // digitação e geraria milhares de URLs rasas — exatamente o que já nos custou o aviso de
  // "cópia" no Search Console. A página serve à PESSOA; o buscador continua pelas de cidade.
  return pagina({
    titulo: q ? `Imóveis em leilão em ${q} | BidPro Brasil` : 'Buscar imóveis em leilão | BidPro Brasil',
    desc: 'Encontre imóveis em leilão pela cidade.',
    canonical: `${SITE}/leiloes`, indexar: false,
    migalha: [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão', url: `${SITE}/leiloes` }, { nome: 'Busca' }],
    corpo: `<h1>${q ? `Resultados para “${esc(q)}”` : 'Buscar imóveis em leilão'}</h1>
      ${caixaBusca(q)}
      ${!q || q.length < 2 ? '<p class="sub">Digite ao menos duas letras do nome da cidade.</p>' : ''}
      ${q.length >= 2 && !lista.length ? `<p class="sub">Não encontramos lotes ativos em uma cidade com esse nome. O acervo muda toda semana —
        <a href="${SITE}/leiloes">veja todos os estados</a> ou tente outra grafia.</p>` : ''}
      ${lista.length ? `<p class="sub">${lista.length === 1 ? '1 cidade encontrada' : `${lista.length} cidades encontradas`}. Clique para ver os lotes.</p>
      <ul class="lista">${lista.map((c) => `<li><a href="${SITE}/leiloes/${String(c.uf).toLowerCase()}/${esc(c.cidade_norm)}">${esc(c.cidade)}/${esc(c.uf)} <strong>(${Number(c.total).toLocaleString('pt-BR')})</strong></a></li>`).join('')}</ul>` : ''}`,
  });
}

// ── /leiloes — índice nacional ───────────────────────────────────────────────
async function paginaBrasil() {
  const dados = await rpc('acervo_uf_contagem');
  const ufs = (Array.isArray(dados) ? dados : [])
    .filter((r) => UF_NOME[r.uf]).map((r) => [r.uf, Number(r.total) || 0]);
  const total = ufs.reduce((s, [, n]) => s + n, 0);
  return pagina({
    titulo: 'Imóveis em leilão no Brasil — casas, apartamentos e terrenos | BidPro Brasil',
    desc: `${total.toLocaleString('pt-BR')} imóveis em leilão judicial e extrajudicial em ${ufs.length} estados. Veja lance mínimo, avaliação e desconto — e analise a viabilidade antes de arrematar.`,
    canonical: `${SITE}/leiloes`,
    migalha: [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão' }],
    corpo: `<h1>Imóveis em leilão no Brasil</h1>
      <p class="sub">${total.toLocaleString('pt-BR')} imóveis de leilão judicial e extrajudicial acompanhados hoje, em ${ufs.length} estados.</p>
      ${caixaBusca()}
      <h2>Ou escolha o estado</h2>
      <ul class="lista">${ufs.map(([uf, n]) => `<li><a href="${SITE}/leiloes/${uf.toLowerCase()}">${esc(UF_NOME[uf])} <strong>(${n.toLocaleString('pt-BR')})</strong></a></li>`).join('')}</ul>
      <h2>Como funciona a BidPro Brasil</h2>
      <p class="sub">Reunimos os lotes dos leiloeiros e da Caixa num só lugar e entregamos, para cada imóvel, uma análise de mercado, um parecer jurídico e o cálculo de viabilidade do arremate — o que ninguém consegue fazer sozinho antes de dar um lance.
      <a href="${SITE}/#/login?modo=cadastro">Crie uma conta grátis</a> para ver a ficha completa de qualquer imóvel.</p>`,
    jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Imóveis em leilão no Brasil', url: `${SITE}/leiloes`, isPartOf: { '@type': 'WebSite', name: 'BidPro Brasil', url: SITE } },
  });
}

// ── /leiloes/:uf ─────────────────────────────────────────────────────────────
async function paginaUF(uf) {
  const nomeUF = UF_NOME[uf];
  const dados = await rpc('acervo_cidades_uf', { p_uf: uf });
  const cidades = (Array.isArray(dados) ? dados : [])
    .map((r) => [r.cidade_norm, { nome: r.cidade, n: Number(r.total) || 0 }]);
  const total = cidades.reduce((s, [, c]) => s + c.n, 0);
  return pagina({
    titulo: `Imóveis em leilão em ${nomeUF} — ${total.toLocaleString('pt-BR')} oportunidades | BidPro Brasil`,
    desc: `Casas, apartamentos e terrenos em leilão em ${nomeUF}: ${total.toLocaleString('pt-BR')} lotes em ${cidades.length} cidades, com lance mínimo, avaliação e desconto.`,
    canonical: `${SITE}/leiloes/${uf.toLowerCase()}`,
    indexar: total > 0,
    migalha: [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão', url: `${SITE}/leiloes` }, { nome: nomeUF }],
    corpo: `<h1>Imóveis em leilão em ${esc(nomeUF)}</h1>
      <p class="sub">${total.toLocaleString('pt-BR')} imóveis em leilão em ${cidades.length} cidades de ${esc(nomeUF)}.</p>
      ${caixaBusca()}
      <h2>Cidades de ${esc(nomeUF)}</h2>
      <ul class="lista">${cidades.map(([cn, c]) => `<li><a href="${SITE}/leiloes/${uf.toLowerCase()}/${cn}">${esc(c.nome)} <strong>(${c.n.toLocaleString('pt-BR')})</strong></a></li>`).join('')}</ul>
      <h2>Antes de dar um lance em ${esc(nomeUF)}</h2>
      <p class="sub">Cada imóvel de leilão tem uma história: ocupação, dívidas de condomínio e IPTU, ônus na matrícula, prazo de desocupação. A BidPro Brasil produz a análise de mercado, o parecer jurídico e o cálculo de viabilidade de cada lote. <a href="${SITE}/#/login?modo=cadastro">Comece grátis</a>.</p>`,
    jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Imóveis em leilão em ${nomeUF}`, url: `${SITE}/leiloes/${uf.toLowerCase()}` },
  });
}

// ── /leiloes/:uf/:cidade ─────────────────────────────────────────────────────
async function paginaCidade(uf, cidadeNorm, page) {
  const desloc = (page - 1) * POR_PAGINA;
  const campos = 'id,titulo,tipo,cidade,estado,bairro,area_m2,valor_minimo,valor_avaliacao,desconto_percentual,link_foto';
  const { linhas, total } = await sb(
    `imoveis_leilao?ativo=eq.true&estado=eq.${uf}&cidade_norm=eq.${encodeURIComponent(cidadeNorm)}` +
    `&select=${campos}&order=desconto_percentual.desc.nullslast&offset=${desloc}&limit=${POR_PAGINA}`);
  const itens = Array.isArray(linhas) ? linhas : [];
  const nomeCidade = itens[0]?.cidade || cidadeNorm;
  const base = `${SITE}/leiloes/${uf.toLowerCase()}/${cidadeNorm}`;
  const ultima = Math.max(1, Math.ceil(total / POR_PAGINA));

  // Cidade sem lote hoje NÃO entra no índice: página vazia é conteúdo raso, e conteúdo raso
  // derruba a reputação do site inteiro. Fica acessível (o acervo muda toda semana), só não
  // é oferecida ao buscador.
  if (!itens.length) {
    return pagina({
      titulo: `Imóveis em leilão em ${nomeCidade} — ${UF_NOME[uf]} | BidPro Brasil`,
      desc: `No momento não há lotes ativos em ${nomeCidade}/${uf}. Veja as demais cidades de ${UF_NOME[uf]}.`,
      canonical: base, indexar: false,
      migalha: [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão', url: `${SITE}/leiloes` }, { nome: UF_NOME[uf], url: `${SITE}/leiloes/${uf.toLowerCase()}` }, { nome: nomeCidade }],
      corpo: `<h1>Imóveis em leilão em ${esc(nomeCidade)}</h1>
        <p class="sub">Nenhum lote ativo nesta cidade agora — o acervo muda toda semana.
        <a href="${SITE}/leiloes/${uf.toLowerCase()}">Ver outras cidades de ${esc(UF_NOME[uf])}</a>.</p>`,
    });
  }

  const menor = itens.map(i => Number(i.valor_minimo)).filter(v => v > 0).sort((a, b) => a - b)[0];
  return pagina({
    titulo: `${total.toLocaleString('pt-BR')} imóveis em leilão em ${nomeCidade}/${uf}${page > 1 ? ` — página ${page}` : ''} | BidPro Brasil`,
    desc: `Casas, apartamentos e terrenos em leilão em ${nomeCidade}/${uf}${menor ? `, a partir de ${brl(menor)}` : ''}. Lance mínimo, avaliação, desconto e análise de viabilidade antes de arrematar.`,
    canonical: page > 1 ? `${base}?pagina=${page}` : base,
    migalha: [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão', url: `${SITE}/leiloes` }, { nome: UF_NOME[uf], url: `${SITE}/leiloes/${uf.toLowerCase()}` }, { nome: nomeCidade }],
    corpo: `<h1>Imóveis em leilão em ${esc(nomeCidade)}/${esc(uf)}</h1>
      <p class="sub">${total.toLocaleString('pt-BR')} lotes ativos${menor ? `, a partir de <strong>${esc(brl(menor))}</strong>` : ''}. Ordenados pelo maior desconto sobre a avaliação.</p>
      <div class="grade">${itens.map(cardImovel).join('')}</div>
      ${ultima > 1 ? `<nav class="pag">
        ${page > 1 ? `<a href="${base}${page - 1 > 1 ? `?pagina=${page - 1}` : ''}">← anterior</a>` : ''}
        <span>página ${page} de ${ultima}</span>
        ${page < ultima ? `<a href="${base}?pagina=${page + 1}">próxima →</a>` : ''}
      </nav>` : ''}
      <h2>Vale a pena arrematar em ${esc(nomeCidade)}?</h2>
      <p class="sub">Desconto grande nem sempre é bom negócio: o que decide é o valor de mercado do bairro, os débitos que vêm junto e o risco jurídico do processo.
      A BidPro Brasil entrega os três relatórios por imóvel — mercadológico, documental e jurídico —
      além do lance máximo que preserva o seu lucro. <a href="${SITE}/#/login?modo=cadastro">Crie sua conta grátis</a>.</p>`,
    jsonld: {
      '@context': 'https://schema.org', '@type': 'ItemList',
      name: `Imóveis em leilão em ${nomeCidade}/${uf}`, numberOfItems: total,
      itemListElement: itens.slice(0, 20).map((im, i) => ({
        '@type': 'ListItem', position: desloc + i + 1,
        url: `${SITE}/leilao/${im.id}/${slug(im.titulo || 'imovel')}`,
        name: im.titulo || 'Imóvel em leilão',
      })),
    },
  });
}

// ── /leilao/:id ──────────────────────────────────────────────────────────────
async function paginaImovel(id) {
  // `fonte_id` e `data_fim` entram para o JSON-LD (identificador e priceValidUntil) — ver
  // o bloco `jsonld` mais abaixo, que responde aos avisos do Search Console de 04/08.
  const campos = 'id,titulo,tipo,cidade,cidade_norm,estado,bairro,area_m2,valor_minimo,valor_minimo_2,valor_avaliacao,desconto_percentual,data_leilao,data_fim,fonte_id,link_foto,fonte,modalidade,descricao,ativo';
  const { linhas } = await sb(`imoveis_leilao?id=eq.${encodeURIComponent(id)}&select=${campos}&limit=1`);
  const im = Array.isArray(linhas) ? linhas[0] : null;
  if (!im) return null;

  const uf = String(im.estado || '').toUpperCase();
  const t = TIPO_LABEL[String(im.tipo || '').toLowerCase()] || 'Imóvel';
  const local = [im.bairro, im.cidade, uf].filter(Boolean).join(', ');
  const lance = brl(im.valor_minimo), aval = brl(im.valor_avaliacao);
  const canonical = `${SITE}/leilao/${im.id}/${slug(im.titulo || t)}`;
  const migalha = [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão', url: `${SITE}/leiloes` }];
  if (UF_NOME[uf]) migalha.push({ nome: UF_NOME[uf], url: `${SITE}/leiloes/${uf.toLowerCase()}` });
  if (im.cidade_norm && UF_NOME[uf]) migalha.push({ nome: im.cidade, url: `${SITE}/leiloes/${uf.toLowerCase()}/${im.cidade_norm}` });
  migalha.push({ nome: t });

  const linha = (r, v) => (v ? `<div><span>${esc(r)}</span><strong>${esc(v)}</strong></div>` : '');
  return pagina({
    // TÍTULO PRECISA SER ÚNICO (08/08 — resposta ao "Cópia, o Google e o usuário selecionaram
    // uma página canônica diferente" do Search Console). Medido no acervo: 1.000 lotes ativos
    // com o título EXATAMENTE igual ("Apartamento — SANTA CRUZ RIO DE JANEIRO RJ"), 479 com
    // outro, 302 com outro. O título vem do scraper, é montado por template e não distingue
    // um lote do vizinho — para o buscador são mil cópias, e ele indexa uma. Aqui somamos o
    // que de fato DIFERENCIA cada lote (área, lance e o identificador do lote na fonte), sem
    // inventar texto: são dados reais que já estão na página.
    titulo: [
      im.titulo || `${t} em leilão`,
      im.area_m2 > 0 ? `${Math.round(im.area_m2)} m²` : null,
      lance ? `lance ${lance}` : null,
      `lote ${String(im.fonte_id || im.id).slice(-8)}`,
    ].filter(Boolean).join(' · ') + ` | BidPro Brasil`,
    desc: `${t} em leilão em ${local}${im.area_m2 > 0 ? `, ${Math.round(im.area_m2)} m²` : ''}${lance ? `, lance a partir de ${lance}` : ''}${aval ? ` (avaliação ${aval})` : ''}. Veja análise de viabilidade e parecer jurídico antes de arrematar.`,
    canonical,
    // Lote inativo sai do índice, mas a página continua abrindo: quem chegou por um link
    // antigo merece ver o que aconteceu, e não um 404 seco.
    indexar: !!im.ativo,
    migalha,
    // O H1 segue a mesma lógica do <title>: com mil lotes de título idêntico, um H1 repetido
    // é o segundo sinal que leva o Google a tratar as páginas como cópias.
    corpo: `<h1>${esc([im.titulo || `${t} em leilão em ${im.cidade || ''}`, im.area_m2 > 0 ? `${Math.round(im.area_m2)} m²` : null].filter(Boolean).join(' · '))}</h1>
      <p class="sub">${esc(t)} em leilão · ${esc(local)}${im.modalidade ? ` · ${esc(MODALIDADE_LABEL[String(im.modalidade).toLowerCase()] || im.modalidade)}` : ''}</p>
      ${!im.ativo ? `<p class="painel"><strong>Este lote não está mais ativo</strong> no acervo — provavelmente foi arrematado ou saiu do edital. <a href="${SITE}/leiloes/${uf.toLowerCase()}${im.cidade_norm ? `/${im.cidade_norm}` : ''}">Ver imóveis disponíveis em ${esc(im.cidade || UF_NOME[uf] || 'sua região')}</a>.</p>` : ''}
      <div class="painel">
        ${im.link_foto ? `<img src="${esc(im.link_foto)}" alt="${esc(t)} em leilão em ${esc(im.cidade || '')}" style="width:100%;max-height:420px;object-fit:cover;border-radius:10px"/>` : ''}
        <div class="dados">
          ${linha('Lance mínimo', lance)}
          ${linha('Avaliação', aval)}
          ${linha('Desconto', Number(im.desconto_percentual) > 0 ? `${im.desconto_percentual}%` : null)}
          ${linha('Área', im.area_m2 > 0 ? `${Math.round(im.area_m2)} m²` : null)}
          ${linha('Tipo', t)}
          ${linha('Cidade', im.cidade ? `${im.cidade}/${uf}` : null)}
          ${linha('Bairro', im.bairro)}
          ${linha('Data do leilão', dataBR(im.data_leilao))}
        </div>
      </div>
      ${im.descricao ? `<h2>Descrição do lote</h2><p>${esc(String(im.descricao).slice(0, 1200))}</p>` : ''}

      <!-- O GATE (08/08, pedido do dono: "ao abrir o imóvel ele solicita o cadastro para ver
           as informações"). Feito como PROMESSA VISÍVEL, não como parede.
           POR QUE NÃO ESCONDER TUDO: estas 31 mil páginas são o ativo de busca orgânica da
           empresa — elas só rankeiam porque têm conteúdo legível. Página que exige login não
           é indexada, e mostrar ao Google algo diferente do que a pessoa vê é cloaking, que
           dá penalidade. Então o público continua vendo o FATO (o que qualquer site de
           leilão mostra: preço, área, cidade, desconto) e o cadastro abre o que é NOSSO e
           ninguém mais tem: endereço exato, edital, matrícula, análise e lance máximo.
           Robô e pessoa veem exatamente a mesma coisa. -->
      <div class="trava">
        <h3>Crie sua conta grátis para ver a ficha completa deste imóvel</h3>
        <ul>
          <li><strong>Endereço exato</strong> e localização no mapa</li>
          <li><strong>Edital e matrícula</strong> do lote, quando o leiloeiro publica</li>
          <li><strong>Análise de mercado</strong> — quanto vale de verdade no bairro</li>
          <li><strong>Parecer jurídico</strong> — ocupação, dívidas e ônus na matrícula</li>
          <li><strong>Lance máximo</strong> que ainda preserva o seu lucro</li>
        </ul>
        <a class="cta" href="${SITE}/#/login?modo=cadastro&amp;imovel=${esc(im.id)}">Criar conta grátis e ver a ficha</a>
        <p class="obs">São 3 análises gratuitas ao criar a conta, sem cartão. Já tem conta? <a href="${SITE}/#/imovel/${esc(im.id)}">Entrar e abrir este imóvel</a>.</p>
      </div>

      <h2>O que checar antes de dar um lance</h2>
      <p class="sub">Desconto sozinho não decide nada. O que decide é o preço real de mercado do bairro, os débitos que vêm junto (IPTU, condomínio, ônus na matrícula), a situação de ocupação e o risco jurídico do processo.</p>
      ${im.cidade_norm && UF_NOME[uf] ? `<p><a href="${SITE}/leiloes/${uf.toLowerCase()}/${im.cidade_norm}">← Todos os imóveis em leilão em ${esc(im.cidade)}/${esc(uf)}</a></p>` : ''}`,
    // JSON-LD do lote. Campos acrescentados em 04/08 respondendo aos avisos NÃO CRÍTICOS
    // de "Snippets do produto" do Search Console — os dois clássicos são identificador
    // global ausente e `priceValidUntil` ausente. Ambos são preenchíveis com dado REAL que
    // já temos, sem inventar nada:
    //   • `sku` = o id do lote no leiloeiro (identificador estável e verdadeiro);
    //   • `priceValidUntil` = `data_fim`, o prazo para dar lance (mantido pelo trigger
    //     trg_data_fim_leilao). É literalmente até quando aquele preço vale.
    // NÃO acrescentamos `aggregateRating`/`review` (não existe avaliação de imóvel aqui —
    // marcação de nota falsa é violação de política do Google e rende penalidade), nem
    // `shippingDetails`/`hasMerchantReturnPolicy` (não há frete nem devolução de imóvel).
    // ⚠️ PENDÊNCIA DE FUNDO: `Product` é o tipo de PRODUTO DE VAREJO. Para imóvel o tipo
    // correto é `RealEstateListing`, e é por estar como Product que o Google aplica as
    // validações de loja (identificador, frete, devolução, nota) que nunca farão sentido
    // aqui. Trocar o tipo afeta as 33 mil páginas recém-enviadas — decisão do dono.
    // ERRO CRÍTICO do Search Console (07/08): "Especifique offers, review ou aggregateRating".
    // A causa NÃO é o dilema Product×RealEstateListing anotado acima — é que o bloco `offers`
    // sempre foi CONDICIONAL ao preço. Lote sem `valor_minimo` publicava um `Product` sem
    // offers, sem review e sem aggregateRating: para o Google, um produto que não é comprável
    // nem avaliável, ou seja, marcação inválida. Medido hoje: 7 lotes de 33.327 (0,02%),
    // concentrados em PESTANA e SUPERBID.
    // A saída é NÃO publicar Product quando não há preço. Não se perde nada: sem preço não
    // existe rich snippet de preço a exibir, então o JSON-LD só podia gerar erro. E preservar
    // `Product` nos 33 mil lotes COM preço mantém o rich snippet que a troca para
    // `RealEstateListing` custaria — por isso a troca deixa de ser necessária para fechar
    // este erro (a pendência de fundo segue registrada acima, mas sem urgência).
    jsonld: Number(im.valor_minimo) > 0 ? {
      '@context': 'https://schema.org', '@type': 'Product',
      name: im.titulo || `${t} em leilão em ${im.cidade || ''}`,
      description: `${t} em leilão em ${local}.`,
      url: canonical,
      ...(im.fonte_id ? { sku: String(im.fonte_id) } : {}),
      ...(im.link_foto ? { image: im.link_foto } : {}),
      offers: {
        '@type': 'Offer', price: Math.round(Number(im.valor_minimo)), priceCurrency: 'BRL',
        availability: im.ativo ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
        url: canonical,
        // Só quando existe prazo de verdade — data inventada seria pior que campo ausente.
        ...(im.data_fim ? { priceValidUntil: String(im.data_fim).slice(0, 10) } : {}),
      },
    } : null,
  });
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY) return res.status(500).send('indisponível');
  const u = new URL(req.url, 'http://x');
  const tipo = u.searchParams.get('tipo') || 'brasil';
  const uf = String(u.searchParams.get('uf') || '').toUpperCase();
  const cidade = norm(u.searchParams.get('cidade') || '');
  const id = String(u.searchParams.get('id') || '').slice(0, 40);
  const page = Math.max(1, Math.min(200, Number(u.searchParams.get('pagina')) || 1));

  try {
    let html = null;
    if (tipo === 'busca') {
      // O termo cru (com acento e espaço) — quem normaliza é a função de busca no banco.
      html = await paginaBusca(u.searchParams.get('cidade') || '');
    } else if (tipo === 'imovel') {
      if (!/^[0-9a-f-]{20,40}$/i.test(id)) return res.status(404).send('Imóvel não encontrado.');
      html = await paginaImovel(id);
      if (!html) return res.status(404).send('Imóvel não encontrado.');
    } else if (tipo === 'cidade') {
      if (!UFS.includes(uf) || !cidade) return res.status(404).send('Página não encontrada.');
      html = await paginaCidade(uf, cidade, page);
    } else if (tipo === 'uf') {
      if (!UFS.includes(uf)) return res.status(404).send('Estado não encontrado.');
      html = await paginaUF(uf);
    } else {
      html = await paginaBrasil();
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    // Cache na borda: estas páginas são iguais para todo mundo e o acervo muda por dia,
    // não por segundo. Sem isto, cada visita de robô viraria consulta ao banco.
    // A BUSCA é a exceção: o resultado depende do que a pessoa digitou, então cachear por
    // hora encheria a borda de páginas de uso único. Cache curto, só para absorver o
    // duplo-clique e o "voltar" do navegador.
    res.setHeader('Cache-Control', tipo === 'busca'
      ? 'public, max-age=0, s-maxage=60'
      : 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    return res.status(200).send(html);
  } catch (e) {
    console.error('[publico]', e?.message || e);
    return res.status(500).send('Erro ao montar a página.');
  }
}
