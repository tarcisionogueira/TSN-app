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
// ISO puro (YYYY-MM-DD) para a contagem regressiva no navegador — só quando a data da praça
// vem em formato reconhecível. Sem isto, o "encerra em N dias" viraria conta sobre texto solto.
const isoData = (s) => { const m = String(s || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };
const MODALIDADE_LABEL = { judicial: 'Leilão judicial', extrajudicial: 'Leilão extrajudicial', licitacao_aberta: 'Licitação aberta', venda_direta: 'Venda direta', venda_online: 'Venda online', primeiro_leilao: '1ª praça', segundo_leilao: '2ª praça', praca_unica: 'Praça única' };
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
function pagina({ titulo, desc, canonical, corpo, jsonld, indexar = true, migalha = [], hero = '', imovelId = '' }) {
  // O LOTE VIAJA NO CABEÇALHO (29/08). Os botões do topo aparecem em TODA página pública,
  // inclusive na do lote, e iam para `/#/login?modo=cadastro` sem o imóvel — enquanto o CTA
  // do corpo já levava `&imovel=<id>`. Quem estava olhando um apartamento e clicava no botão
  // de cima em vez do de baixo chegava ao cadastro indistinguível de quem veio da home.
  // Vale para "Entrar" também: cliente que já tem conta e volta por um lote tem a MESMA
  // intenção — e `modo=` no rastro separa os dois quando for hora de ler.
  // Hoje isto só melhora a MEDIÇÃO (`origem_lote` em api/track.js): nada ainda lê o parâmetro.
  const qs = imovelId ? `&imovel=${encodeURIComponent(imovelId)}` : '';
  const urlCadastro = `${SITE}/#/login?modo=cadastro${qs}`;
  const urlEntrar = imovelId ? `${SITE}/#/login?imovel=${encodeURIComponent(imovelId)}` : `${SITE}/#/login`;
  const migHtml = migalha.length ? migalha.map((m, i) => (m.url ? `<a href="${esc(m.url)}">${esc(m.nome)}</a>` : esc(m.nome)) + (i < migalha.length - 1 ? ' › ' : '')).join('') : '';
  return `<!doctype html><html lang="pt-BR"><head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<!-- Tag do Google (18/08): estas páginas serviam TODO o tráfego de SEO sem tag nenhuma —
     era o "páginas de destino sem tags" do diagnóstico de Qualidade de Tag, e deixava
     invisível justamente o tráfego para onde os anúncios devem apontar. Mesmos IDs do
     index.html; a guarda de hostname impede preview (*.vercel.app) de disparar — a causa
     do "outros domínios detectados" do mesmo diagnóstico. -->
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  if (/(^|\\.)bidprobrasil\\.com\\.br$/.test(location.hostname)) {
    var _gs = document.createElement('script'); _gs.async = true;
    _gs.src = 'https://www.googletagmanager.com/gtag/js?id=G-5YNHQB5F81';
    document.head.appendChild(_gs);
    gtag('js', new Date());
    gtag('config', 'G-5YNHQB5F81');
    gtag('config', 'AW-16850175262');
  }
</script>
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
<meta property="og:image" content="${SITE}/og-image.jpg"/>
<meta property="og:locale" content="pt_BR"/>
<meta name="twitter:card" content="summary_large_image"/>
${jsonld ? `<script type="application/ld+json">${JSON.stringify(jsonld).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')}</script>` : ''}
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;900&display=swap" rel="stylesheet">
<!-- League Spartan (títulos) AUTO-HOSPEDADA + fallback com métricas casadas: sem FOUT/pulo
     na 1ª visita (mesmo esquema do index.html). Precarregada; @font-face abaixo, no <style>. -->
<link rel="preload" as="font" type="font/woff2" href="/fonts/league-spartan-latin.woff2" crossorigin>
<style>
/* League Spartan auto-hospedada (variável, 700–900) + fallback com métricas casadas (Arial)
   — sem FOUT/pulo. Valores calculados das métricas reais do woff2 (ver index.html). */
@font-face{font-family:'League Spartan';font-style:normal;font-weight:100 900;font-display:swap;src:url('/fonts/league-spartan-latin.woff2') format('woff2')}
@font-face{font-family:'League Spartan Fallback';src:local('Arial');size-adjust:87.79%;ascent-override:79.74%;descent-override:25.06%;line-gap-override:0%}
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
h1,h2,h3{font-family:'League Spartan','League Spartan Fallback','Inter',sans-serif;letter-spacing:-0.2px}
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
/* HERO (25/08, pedido do dono) — esta página servia TODO o tráfego de busca, e agora o de
   anúncio, num documento chapado e branco do início ao fim: não conversava com a landing e
   cansava a vista. O hero traz o mesmo gradiente navy da Landing.jsx, o mesmo degradê
   azul→verde no destaque e o mesmo azul de CTA, e põe a BUSCA no lugar mais alto da página —
   a pessoa procura a cidade dela antes de qualquer lista. */
.hero{background:linear-gradient(135deg,#080f1a 0%,#0a1f3d 60%,#0d2a50 100%);color:#fff;padding:38px 20px 44px}
.hero-in{max-width:1100px;margin:0 auto}
.hero h1{color:#fff;font-size:34px;margin:0 0 10px}
.hero .destaque{background:linear-gradient(90deg,#60a5fa 0%,#34d399 100%);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent}
.hero .sub{color:#c7d6ea;font-size:16px;margin:0 0 22px;max-width:680px}
.mig-hero{color:#8fa9c6;margin-bottom:16px;font-size:12.5px}
.mig-hero a{color:#bcd2ea}
.busca-hero{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:16px}
.busca-hero form{display:flex;gap:10px;flex-wrap:wrap}
/* 16px no campo, não 15: abaixo disso o Safari do iOS dá zoom na página inteira ao focar e
   NÃO desfaz — a pessoa fica com a página torta até pinçar na mão. Mesmo defeito corrigido
   no app em 14/08; esta página é servida por outro caminho e tem o CSS dela. */
.busca-hero input{flex:1;min-width:220px;padding:14px 16px;border:1px solid rgba(255,255,255,.18);border-radius:12px;font-size:16px;font-family:inherit;background:#fff;color:#111}
.busca-hero input:focus{outline:3px solid rgba(96,165,250,.65);outline-offset:1px}
.busca-hero button{padding:14px 26px;background:var(--azul);color:#fff;border:none;border-radius:12px;font-weight:800;font-size:15px;cursor:pointer;box-shadow:0 8px 24px rgba(13,99,219,.42);font-family:inherit}
.busca-hero button:hover{background:var(--azul-fundo)}
.busca-hero .dica{margin:10px 2px 0;font-size:12.5px;color:#9fb6d0}
/* Estado/cidade como CARTÃO com peso visual, não pílula chapada em fila. */
.ufs{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));gap:10px}
.ufs a{display:flex;align-items:center;justify-content:space-between;gap:8px;background:#fff;border:1px solid var(--linha);border-radius:12px;padding:13px 15px;font-weight:700;font-size:14.5px;color:var(--tinta);transition:box-shadow .15s,border-color .15s,transform .15s}
.ufs a:hover{border-color:var(--azul);box-shadow:0 6px 18px rgba(13,99,219,.13);transform:translateY(-1px);text-decoration:none}
.ufs .n{font-size:12.5px;font-weight:800;color:var(--azul);background:#eff6ff;border-radius:999px;padding:3px 10px;white-space:nowrap}
/* UF sem lote hoje: aparece (para ninguém concluir que não cobrimos o estado), mas apagada e
   SEM link — clicar levaria a uma página vazia, que é pior que não clicar. */
.ufs .vazio{display:flex;align-items:center;justify-content:space-between;gap:8px;background:transparent;border:1px dashed var(--linha);border-radius:12px;padding:13px 15px;font-size:14.5px;font-weight:600;color:#94a3b8}
.ufs .n0{font-size:11.5px;font-weight:700;color:#94a3b8;white-space:nowrap}
/* Faixa em cartão para quebrar o branco contínuo do miolo. */
.faixa{background:#fff;border:1px solid var(--linha);border-radius:18px;padding:26px 24px;margin:30px 0 0}
.faixa h2{margin-top:0}
.faixa .sub{margin-bottom:0}
@media(max-width:560px){.hero{padding:26px 16px 32px}.hero h1{font-size:25px}.hero .sub{font-size:14.5px}}
.grade{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.card{background:#fff;border:1px solid var(--linha);border-radius:16px;overflow:hidden;display:flex;flex-direction:column;transition:box-shadow .15s,border-color .15s}
.card:hover{box-shadow:0 6px 20px rgba(15,23,42,.08);border-color:#cbd5e1}
.card img{width:100%;height:150px;object-fit:cover;background:#e2e8f0;display:block}
.card .c{padding:12px 14px;display:flex;flex-direction:column;gap:4px;flex:1}
.card .t{font-weight:700;font-size:14px;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.card .l{font-size:12.5px;color:var(--cinza)}
.card .v{font-size:17px;font-weight:900;color:var(--azul);margin-top:auto;padding-top:6px}
.tag{display:inline-block;font-size:11px;font-weight:800;color:#15803d;background:#dcfce7;padding:3px 9px;border-radius:999px}
/* Cartão do acervo público no MESMO padrão visual da tela de busca logada (Busca.jsx): o
   visitante que cria conta já reconhece o layout. Só campos que a linha JÁ traz (custo zero):
   foto com selo de desconto graduado, chips de tipo/modalidade, R$/m², selos de documento,
   data da praça e o par Lance mínimo/Avaliação. Sem Score/análise/mapa (produto pago + custo). */
.card .foto{position:relative;line-height:0}
.card .badge-desc{position:absolute;top:8px;left:8px;font-size:12px;font-weight:900;color:#fff;padding:3px 8px;border-radius:999px;letter-spacing:.2px}
.card .badge-desc.alto{background:#15803d}.card .badge-desc.medio{background:#d97706}.card .badge-desc.baixo{background:#64748b}
.card .chips{display:flex;flex-wrap:wrap;gap:5px}
.card .chip{font-size:10.5px;font-weight:800;padding:2px 8px;border-radius:999px;background:#eff6ff;color:#0D63DB;text-transform:uppercase;letter-spacing:.3px}
.card .chip.modal{background:#f1f5f9;color:#475569}
.card .selos{display:flex;flex-wrap:wrap;gap:6px;margin-top:2px}
.card .selo{font-size:11px;font-weight:700;color:#475569;background:var(--superficie);border:1px solid var(--linha);padding:2px 7px;border-radius:8px}
.card .praca{font-size:11.5px;color:var(--cinza);font-weight:600}
.card .valores{display:flex;align-items:flex-end;justify-content:space-between;gap:8px;margin-top:auto;padding-top:8px}
.card .valores .lbl{font-size:9.5px;color:var(--cinza);text-transform:uppercase;letter-spacing:.5px;font-weight:800}
.card .valores .lance{font-size:17px;font-weight:900;color:var(--azul);line-height:1.15}
.card .valores .aval{font-size:12px;font-weight:800;color:#94a3b8;text-align:right}
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
/* ── URGÊNCIA: contagem regressiva. Preenchida por um script mínimo no rodapé, para não ser
   congelada pelo cache da borda (a data é dia; o cache é de hora). Sem JS ou para o robô, o
   selo fica oculto e a DATA continua exibida como fato — nada some do que o Google lê. ── */
.prazo-badge{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;font-weight:800;padding:3px 9px;border-radius:999px;line-height:1.3}
.prazo-badge.prazo-hoje{background:#fee2e2;color:#b91c1c}
.prazo-badge.prazo-quente{background:#fef3c7;color:#b45309}
.prazo-badge.prazo-normal{background:#eff6ff;color:#1d4ed8}
.prazo-badge.prazo-fim{background:#f1f5f9;color:#64748b}
.card .prazo-badge{align-self:flex-start;margin-top:2px}
/* Selo da fonte/leiloeiro na foto do card, como na busca logada (Caixa em laranja). */
.card .foto .fonte{position:absolute;bottom:8px;left:8px;font-size:10px;font-weight:800;color:#fff;background:rgba(15,23,42,.82);padding:3px 8px;border-radius:8px;letter-spacing:.3px;text-transform:uppercase}
.card .foto .fonte.caixa{background:#c2410c}
/* ── FICHA DO IMÓVEL no padrão da tela interna (ImovelDetalhe.jsx): 2 colunas com sidebar
   sticky, cartões de seção com ícone, e o que é produto pago exibido como TEASER bloqueado
   (promessa visível, não parede) — mapa e análise mostram QUE existem e chamam o cadastro. ── */
.ficha{display:grid;grid-template-columns:1fr 320px;gap:22px;align-items:start;margin-top:4px}
.ficha-main{display:flex;flex-direction:column;gap:18px;min-width:0}
.ficha-side{position:sticky;top:20px;display:flex;flex-direction:column;gap:16px}
@media(max-width:860px){.ficha{grid-template-columns:1fr}.ficha-side{position:static}}
.foto-hero{position:relative;border-radius:16px;overflow:hidden;background:#111;line-height:0;min-height:200px}
.foto-hero img{width:100%;height:auto;max-height:420px;object-fit:cover;display:block;min-height:200px}
.foto-hero .over-tl{position:absolute;top:14px;left:14px;display:flex;gap:8px;flex-wrap:wrap}
.foto-hero .over-tr{position:absolute;top:14px;right:14px}
.foto-hero .over-bl{position:absolute;bottom:14px;left:14px}
.ficha .over-tl .chip{font-size:11px;font-weight:800;padding:3px 9px;border-radius:999px;background:rgba(17,17,17,.82);color:#fff;text-transform:uppercase;letter-spacing:.3px}
.ficha .over-tl .chip.modal{background:rgba(11,75,166,.9)}
.ficha .over-tr .badge-desc{font-size:16px;font-weight:900;color:#fff;padding:5px 12px;border-radius:10px;letter-spacing:.2px}
.ficha .over-tr .badge-desc.alto{background:#15803d}.ficha .over-tr .badge-desc.medio{background:#d97706}.ficha .over-tr .badge-desc.baixo{background:#64748b}
.ficha .over-bl .fonte{font-size:11px;font-weight:800;color:#fff;background:rgba(15,23,42,.82);padding:3px 9px;border-radius:8px;letter-spacing:.3px;text-transform:uppercase}
.ficha .over-bl .fonte.caixa{background:#c2410c}
.secao{background:#fff;border:1px solid var(--linha);border-radius:16px;padding:20px}
.secao>h2{font-size:17px;font-weight:800;margin:0 0 14px;display:flex;align-items:center;gap:8px}
.secao>h2 .ic{font-size:18px;line-height:1}
.secao .dados{margin:0}
.trava-vis{position:relative;border-radius:14px;overflow:hidden;border:1px solid var(--linha);min-height:140px}
.trava-vis .blur{position:absolute;inset:0;background:repeating-linear-gradient(45deg,#e2e8f0 0 16px,#eef2f7 16px 32px);filter:blur(1px);opacity:.55}
.trava-vis .lock{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:26px 18px;gap:6px;min-height:140px}
.trava-vis .lock .cad{font-size:26px;line-height:1}
.trava-vis .lock .tt{font-weight:800;font-size:14.5px;color:#1e293b}
.trava-vis .lock .ds{font-size:12.5px;color:#64748b;max-width:360px;line-height:1.5}
.acao{background:#fff;border:1px solid var(--linha);border-radius:16px;padding:20px}
.acao .lance-lbl{font-size:10.5px;color:var(--cinza);text-transform:uppercase;letter-spacing:.6px;font-weight:800}
.acao .lance-val{font-size:28px;font-weight:900;color:var(--azul);line-height:1.1;margin:2px 0 8px;overflow-wrap:anywhere}
.acao .desc-pill{display:inline-block;font-size:12px;font-weight:800;color:#15803d;background:#dcfce7;padding:4px 10px;border-radius:999px;margin-bottom:14px}
.score-lock{display:flex;align-items:center;gap:12px;background:var(--superficie);border:1px dashed #cbd5e1;border-radius:12px;padding:12px 14px;margin-bottom:14px}
.score-lock .n{width:44px;height:44px;border-radius:12px;background:#e2e8f0;color:#94a3b8;display:flex;align-items:center;justify-content:center;font-size:20px;flex-shrink:0}
.score-lock .tx{font-size:12px;color:#475569;line-height:1.4}
.score-lock .tx b{color:#1e293b}
.acao .cta{display:block;text-align:center;margin:0 0 12px}
.acao .bullets{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:7px}
.acao .bullets li{font-size:12.5px;color:#475569;display:flex;gap:7px;align-items:flex-start}
.acao .bullets li::before{content:'✓';color:#16a34a;font-weight:900}
/* ── ÍMÃ "avise-me": captura leve de e-mail (pré-conta). POST para /api/alerta-publico via
   o script no rodapé; duplo opt-in por e-mail. ── */
.avise{background:linear-gradient(180deg,#eff6ff,#fff);border:1px solid #bfdbfe;border-radius:16px;padding:20px;margin:24px 0}
.avise-t{font-weight:800;font-size:16px;margin:0 0 4px}
.avise-s{font-size:13px;color:var(--cinza);margin:0 0 12px}
.avise form{display:flex;gap:10px;flex-wrap:wrap;margin:0}
.avise input[type=email]{flex:1;min-width:220px;padding:11px 14px;border:1px solid var(--linha);border-radius:10px;font-size:16px;font-family:inherit;color:inherit;background:#fff}
.avise input[type=email]:focus{outline:2px solid var(--azul);outline-offset:1px}
.avise .avise-hp{position:absolute;left:-9999px;width:1px;height:1px;opacity:0}
.avise button{padding:11px 20px;border:none;border-radius:10px;background:var(--azul);color:#fff;font-weight:800;font-size:14px;cursor:pointer;font-family:inherit}
.avise button:hover{background:var(--azul-fundo)}
.avise button:disabled{opacity:.6;cursor:default}
.avise-ok{font-size:13px;font-weight:600;margin:10px 0 0;color:#15803d}
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
    <a class="entrar" href="${esc(urlEntrar)}">Entrar</a>
    <a class="cta" href="${esc(urlCadastro)}">Criar conta grátis</a>
  </nav>
  <a class="cta cta-mob" href="${esc(urlCadastro)}">Criar conta grátis</a>
  <details class="menu-mob">
    <summary aria-label="Abrir menu" role="button">&#9776;</summary>
    <div class="drop">
      <a href="${SITE}/">Home</a>
      <a href="${SITE}/#/calculadora">Calculadora</a>
      <a class="ativo" href="${SITE}/leiloes">Buscar Leilões</a>
      <a href="${SITE}/#/planos">Planos</a>
      <a href="${esc(urlEntrar)}">Entrar</a>
    </div>
  </details>
</div></header>
${hero ? `<section class="hero"><div class="hero-in">
${migHtml ? `<nav class="mig mig-hero">${migHtml}</nav>` : ''}
${hero}
</div></section>` : ''}
<main>
${!hero && migHtml ? `<nav class="mig">${migHtml}</nav>` : ''}
${corpo}
</main>
<footer><div class="in">
  <p><strong>BidPro Brasil</strong> — leilões de imóveis com análise de viabilidade, parecer jurídico e assessoria para arrematar com segurança.
  Também escrito como <em>Bid Pro Brasil</em>.</p>
  <p><a href="${SITE}/leiloes">Imóveis em leilão por estado</a> · <a href="${SITE}/#/planos">Planos</a> · <a href="${SITE}/#/termos">Termos</a> · <a href="${SITE}/#/privacidade">Privacidade</a></p>
</div></footer>
<!-- URGÊNCIA: preenche os selos de contagem regressiva (.prazo-badge[data-prazo]) no cliente.
     Fica fora do HTML servido de propósito (o cache da borda é de hora, a contagem é de dia);
     para o robô e sem JS o selo permanece oculto e a data segue visível como fato. -->
<script>
(function(){try{
  var now=new Date();now.setHours(0,0,0,0);
  var els=document.querySelectorAll('.prazo-badge[data-prazo]');
  for(var i=0;i<els.length;i++){(function(el){
    var p=el.getAttribute('data-prazo');if(!p)return;
    var d=new Date(p+'T00:00:00');if(isNaN(d.getTime()))return;
    var dias=Math.round((d-now)/86400000),txt,cls;
    if(dias<0){txt='Praça encerrada';cls='prazo-fim';}
    else if(dias===0){txt='🔴 Encerra hoje';cls='prazo-hoje';}
    else if(dias===1){txt='🔴 Encerra amanhã';cls='prazo-hoje';}
    else if(dias<=7){txt='🔥 Encerra em '+dias+' dias';cls='prazo-quente';}
    else{txt='🗓 Praça em '+dias+' dias';cls='prazo-normal';}
    el.textContent=txt;el.className='prazo-badge '+cls;el.style.display='';
  })(els[i]);}
}catch(e){}})();
</script>
<!-- ÍMÃ "avise-me": envia a caixa de captura para /api/alerta-publico (mesma origem → CSP ok).
     Duplo opt-in: o back-end manda o e-mail de confirmação; aqui só mostramos o retorno. -->
<script>
(function(){try{
  var boxes=document.querySelectorAll('.avise');
  for(var i=0;i<boxes.length;i++){(function(box){
    var f=box.querySelector('form');if(!f)return;
    f.addEventListener('submit',function(ev){
      ev.preventDefault();
      var email=(f.email&&f.email.value||'').trim();
      var hp=(f.website&&f.website.value||'').trim();
      var btn=f.querySelector('button');
      var ok=box.querySelector('.avise-ok');
      if(!email)return;
      if(btn){btn.disabled=true;btn.textContent='Enviando…';}
      fetch('/api/alerta-publico',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({email:email,uf:box.getAttribute('data-uf'),cidade:box.getAttribute('data-cidade'),website:hp,origem:location.pathname})})
        .then(function(r){return r.json().catch(function(){return {};});})
        .then(function(d){
          if(d&&d.ok){
            f.style.display='none';
            if(ok){ok.style.display='block';ok.style.color='#15803d';ok.textContent=d.jaConfirmado?'✅ Você já recebe alertas para este local.':'📬 Enviamos um e-mail para confirmar seu alerta. Confira sua caixa de entrada (e a pasta de spam).';}
          }else{
            if(btn){btn.disabled=false;btn.textContent='Quero ser avisado';}
            if(ok){ok.style.display='block';ok.style.color='#b91c1c';ok.textContent=(d&&d.error)||'Não foi possível agora. Tente novamente.';}
          }
        }).catch(function(){if(btn){btn.disabled=false;btn.textContent='Quero ser avisado';}
          if(ok){ok.style.display='block';ok.style.color='#b91c1c';ok.textContent='Não foi possível agora. Tente novamente.';}});
    });
  })(boxes[i]);}
}catch(e){}})();
</script>
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
      var o={gclid:gt('gclid'),gbraid:gt('gbraid'),wbraid:gt('wbraid'),oppref:gt('oppref'),utm_source:gt('utm_source'),
        utm_medium:gt('utm_medium'),utm_campaign:gt('utm_campaign'),utm_term:gt('utm_term'),
        utm_content:gt('utm_content'),referrer_host:(ref==='(direto)'||ref==='(interno)')?null:ref,
        landing:location.pathname};
      var temAlgo=false;for(var k in o){if(k!=='landing'&&o[k])temAlgo=true;}
      if(temAlgo){orig=o;localStorage.setItem('bp_orig',JSON.stringify(o));}}
  }catch(e){}
  // ATRIBUICAO PARA O CADASTRO (22/08): esta pagina de SEO e a porta do Ads, mas o SPA le a
  // origem da chave 'tsn_mkt' (src/utils/marketing.js) no signup — que so era gravada pelo app,
  // NUNCA aqui. Por isso o gclid ia para visita_origem mas perfis.mkt_* ficava vazio (0 cadastros
  // atribuidos ao Google apesar de centenas de visitas com gclid). localStorage e por dominio, entao
  // gravar aqui a MESMA chave/formato/precedencia do capturarMarketing() faz o cadastro atribuir.
  try{
    var Q=new URLSearchParams(location.search),g2=function(k){return (Q.get(k)||'').slice(0,300);};
    var mkt={gclid:g2('gclid'),fbclid:g2('fbclid'),oppref:g2('oppref'),utm_source:g2('utm_source'),utm_medium:g2('utm_medium'),utm_campaign:g2('utm_campaign')};
    var temAnuncio=false;for(var kk in mkt){if(mkt[kk])temAnuncio=true;}
    var refM=(ref==='(direto)'||ref==='(interno)')?'direto':ref;
    var reg=JSON.stringify({gclid:mkt.gclid,fbclid:mkt.fbclid,oppref:mkt.oppref,utm_source:mkt.utm_source,utm_medium:mkt.utm_medium,utm_campaign:mkt.utm_campaign,referrer:refM,landing:location.pathname,ts:Date.now()});
    if(temAnuncio)localStorage.setItem('tsn_mkt',reg);              // veio de anuncio → sobrescreve sempre
    else if(!localStorage.getItem('tsn_mkt'))localStorage.setItem('tsn_mkt',reg); // first-touch
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

// Rótulo curto de modalidade p/ o chip (o label longo fica na ficha do imóvel).
const MODAL_CURTO = { judicial: 'Judicial', extrajudicial: 'Extrajudicial', licitacao_aberta: 'Licitação', venda_direta: 'Venda direta', venda_online: 'Venda online', primeiro_leilao: '1ª praça', segundo_leilao: '2ª praça', praca_unica: 'Praça única' };

function cardImovel(im) {
  const t = TIPO_LABEL[String(im.tipo || '').toLowerCase()] || 'Imóvel';
  const local = [im.bairro, im.cidade, im.estado].filter(Boolean).join(', ');
  const lance = brl(im.valor_minimo);
  const aval = brl(im.valor_avaliacao);
  const pct = Number(im.desconto_percentual) || 0;
  // Selo de desconto graduado (mesma leitura da Busca: quanto maior o abatimento, mais verde).
  const grau = pct >= 40 ? 'alto' : pct >= 20 ? 'medio' : 'baixo';
  const modal = MODAL_CURTO[String(im.modalidade || '').toLowerCase()] || null;
  // R$/m² a partir de colunas já selecionadas (custo zero, só divisão).
  const area = Number(im.area_m2) || 0;
  const min = Number(im.valor_minimo) || 0;
  const m2 = area > 0 && min > 0 ? `R$ ${Math.round(min / area).toLocaleString('pt-BR')}/m²` : null;
  const praca = dataBR(im.data_leilao);
  const prazoISO = isoData(im.data_leilao);
  const fonteRaw = String(im.fonte || '').trim();
  const ehCaixa = /caixa|cef/i.test(fonteRaw);
  const fonteLabel = ehCaixa ? 'CAIXA' : (fonteRaw ? fonteRaw.toUpperCase().slice(0, 16) : '');
  const selos = [
    m2 ? `<span class="selo">${esc(m2)}</span>` : '',
    im.tem_edital_doc ? '<span class="selo">📄 Edital</span>' : '',
    im.tem_matricula_doc ? '<span class="selo">📄 Matrícula</span>' : '',
  ].filter(Boolean).join('');
  return `<article class="card">
    <div class="foto">
      ${im.link_foto ? `<img src="${esc(im.link_foto)}" alt="${esc(t)} em leilão em ${esc(im.cidade || '')}" loading="lazy"/>` : '<img alt="" loading="lazy"/>'}
      ${pct > 0 ? `<span class="badge-desc ${grau}">-${pct}%</span>` : ''}
      ${fonteLabel ? `<span class="fonte${ehCaixa ? ' caixa' : ''}">${esc(fonteLabel)}</span>` : ''}
    </div>
    <div class="c">
      <div class="chips"><span class="chip">${esc(t)}</span>${modal ? `<span class="chip modal">${esc(modal)}</span>` : ''}</div>
      <a class="t" href="${SITE}/leilao/${esc(im.id)}/${slug(im.titulo || t)}">${esc(im.titulo || `${t} em leilão`)}</a>
      <div class="l">${esc(local)}${area > 0 ? ` · ${Math.round(area)} m²` : ''}</div>
      ${selos ? `<div class="selos">${selos}</div>` : ''}
      ${praca ? `<div class="praca">🗓 Praça: ${esc(praca)}</div>` : ''}
      ${prazoISO ? `<span class="prazo-badge" data-prazo="${prazoISO}" style="display:none"></span>` : ''}
      <div class="valores">
        <div><div class="lbl">Lance mínimo</div><div class="lance">${lance ? esc(lance) : aval ? esc(aval) : 'Consulte'}</div></div>
        ${aval && lance ? `<div><div class="lbl">Avaliação</div><div class="aval">${esc(aval)}</div></div>` : ''}
      </div>
    </div>
  </article>`;
}

// Caixa de busca por cidade — o PRIMEIRO elemento acionável de toda página de lista, dentro
// do hero escuro (25/08). É o caminho que o visitante de anúncio espera ("digito minha cidade
// e vejo o que tem"), em vez de descer por Brasil → estado → cidade. Formulário GET simples:
// sem JS, funciona no robô e no celular ruim, e a URL do resultado é compartilhável.
function caixaBuscaHero(valor = '', dica = 'Ou escolha o estado logo abaixo.') {
  return `<div class="busca-hero">
    <form action="${SITE}/leiloes/buscar" method="get">
      <input name="cidade" value="${esc(valor)}" placeholder="Digite a sua cidade — ex.: Campinas, Rio de Janeiro, Goiânia" aria-label="Cidade" autocomplete="off"/>
      <button type="submit">Ver imóveis</button>
    </form>
    <p class="dica">${esc(dica)}</p>
  </div>`;
}

// Ímã "avise-me" — captura leve de e-mail (sem criar conta). `cidade` vazio = alerta por UF.
// O envio é feito pelo script no rodapé (POST /api/alerta-publico); duplo opt-in por e-mail.
function caixaAviseMe(cidade, uf) {
  const alvo = cidade ? `${esc(cidade)}/${esc(uf)}` : esc(UF_NOME[uf] || uf);
  return `<div class="avise" data-uf="${esc(uf)}" data-cidade="${esc(cidade || '')}">
    <div class="avise-t">📩 Avise-me quando surgir imóvel em ${alvo}</div>
    <div class="avise-s">Deixe seu e-mail e avisamos quando entrarem novos lotes em ${alvo} — sem precisar criar conta. Você confirma por e-mail e cancela quando quiser.</div>
    <form onsubmit="return false">
      <input type="email" name="email" placeholder="seu@email.com" aria-label="Seu e-mail" required/>
      <input type="text" name="website" class="avise-hp" tabindex="-1" autocomplete="off" aria-hidden="true"/>
      <button type="submit">Quero ser avisado</button>
    </form>
    <div class="avise-ok" role="status" style="display:none"></div>
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
    hero: `<h1>${q ? `Resultados para <span class="destaque">${esc(q)}</span>` : 'Buscar imóveis em <span class="destaque">leilão</span>'}</h1>
      ${caixaBuscaHero(q, 'Digite o nome da cidade — mostramos quantos lotes estão ativos hoje.')}`,
    corpo: `${!q || q.length < 2 ? '<p class="sub">Digite ao menos duas letras do nome da cidade.</p>' : ''}
      ${q.length >= 2 && !lista.length ? `<p class="sub">Não encontramos lotes ativos em uma cidade com esse nome. O acervo muda toda semana —
        <a href="${SITE}/leiloes">veja todos os estados</a> ou tente outra grafia.</p>` : ''}
      ${lista.length ? `<p class="sub">${lista.length === 1 ? '1 cidade encontrada' : `${lista.length} cidades encontradas`}. Clique para ver os lotes.</p>
      <ul class="ufs">${lista.map((c) => `<li><a href="${SITE}/leiloes/${String(c.uf).toLowerCase()}/${esc(c.cidade_norm)}"><span>${esc(c.cidade)}/${esc(c.uf)}</span><span class="n">${Number(c.total).toLocaleString('pt-BR')}</span></a></li>`).join('')}</ul>` : ''}`,
  });
}

// ── /leiloes — índice nacional ───────────────────────────────────────────────
async function paginaBrasil() {
  const dados = await rpc('acervo_uf_contagem');
  // ÍNDICE DIRETO DE CIDADES (30/08). As cidades JÁ eram linkadas — a partir da página do
  // estado — então isto não conserta órfão nenhum; conserta PROFUNDIDADE. As cidades de maior
  // demanda de busca ("leilão de imóveis no Rio de Janeiro") estavam a DOIS cliques da raiz da
  // seção, atrás de `/leiloes/{uf}`, e num domínio novo o orçamento de rastreamento é pequeno
  // demais para atravessar isso com folga. As 60 maiores passam a ficar a um clique.
  // Falha ABERTA: se a RPC cair, a página sai sem o bloco em vez de sair com erro — o índice
  // por estado, que é o caminho principal, não depende dela.
  let topCidades = [];
  try {
    const t = await rpc('acervo_cidades_top', { p_limite: 60 });
    if (Array.isArray(t)) topCidades = t.filter((c) => c && c.uf && c.cidade_norm && Number(c.total) > 0);
  } catch { /* bloco opcional: sem ele a página continua completa */ }
  // A RPC só devolve UF QUE TEM lote hoje — é a pergunta certa para o sitemap e a errada para
  // a pessoa. Quem é da Bahia abre /leiloes, não vê a Bahia na lista e conclui que não
  // cobrimos o estado dele; e o acervo esvazia e enche por UF toda semana, então a lista
  // mudava de tamanho sozinha. Pedido do dono (26/08): "todos ou nenhum". Mostramos as 27,
  // com a contagem em quem tem e um rótulo honesto em quem não tem — sem link, para não
  // mandar ninguém a uma página vazia.
  const contagem = new Map((Array.isArray(dados) ? dados : [])
    .filter((r) => UF_NOME[r.uf]).map((r) => [r.uf, Number(r.total) || 0]));
  const ufs = Object.keys(UF_NOME)
    .map((uf) => [uf, contagem.get(uf) || 0])
    .sort((a, b) => b[1] - a[1] || UF_NOME[a[0]].localeCompare(UF_NOME[b[0]], 'pt-BR'));
  const total = ufs.reduce((s, [, n]) => s + n, 0);
  const comLote = ufs.filter(([, n]) => n > 0).length;
  return pagina({
    titulo: 'Imóveis em leilão no Brasil — casas, apartamentos e terrenos | BidPro Brasil',
    desc: `${total.toLocaleString('pt-BR')} imóveis em leilão judicial e extrajudicial em ${comLote} estados. Veja lance mínimo, avaliação e desconto — e analise a viabilidade antes de arrematar.`,
    canonical: `${SITE}/leiloes`,
    migalha: [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão' }],
    hero: `<h1>Imóveis em <span class="destaque">leilão</span> no Brasil</h1>
      <p class="sub">${total.toLocaleString('pt-BR')} imóveis de leilão judicial e extrajudicial acompanhados hoje, em ${comLote} ${comLote === 1 ? 'estado' : 'estados'}. Comece pela sua cidade.</p>
      ${caixaBuscaHero('', 'Não sabe o nome exato? Escolha o estado logo abaixo.')}`,
    corpo: `<h2>Escolha o estado</h2>
      <ul class="ufs">${ufs.map(([uf, n]) => (n
        ? `<li><a href="${SITE}/leiloes/${uf.toLowerCase()}"><span>${esc(UF_NOME[uf])}</span><span class="n">${n.toLocaleString('pt-BR')}</span></a></li>`
        : `<li class="vazio"><span>${esc(UF_NOME[uf])}</span><span class="n0">sem lote hoje</span></li>`)).join('')}</ul>
      ${topCidades.length ? `<h2>Cidades com mais imóveis em leilão</h2>
      <p class="sub">As ${topCidades.length} cidades com maior acervo hoje. Para as demais, escolha o estado acima.</p>
      <ul class="ufs">${topCidades.map((c) => `<li><a href="${SITE}/leiloes/${String(c.uf).toLowerCase()}/${esc(c.cidade_norm)}"><span>${esc(c.cidade)}/${esc(c.uf)}</span><span class="n">${Number(c.total).toLocaleString('pt-BR')}</span></a></li>`).join('')}</ul>` : ''}
      <div class="faixa">
      <h2>Como funciona a BidPro Brasil</h2>
      <p class="sub">Reunimos os lotes dos leiloeiros e da Caixa num só lugar e entregamos, para cada imóvel, uma análise de mercado, um parecer jurídico e o cálculo de viabilidade do arremate — o que ninguém consegue fazer sozinho antes de dar um lance.
      <a href="${SITE}/#/login?modo=cadastro">Crie uma conta grátis</a> para ver a ficha completa de qualquer imóvel.</p>
      </div>`,
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
    hero: `<h1>Imóveis em <span class="destaque">leilão</span> em ${esc(nomeUF)}</h1>
      <p class="sub">${total === 1 ? '1 imóvel em leilão' : `${total.toLocaleString('pt-BR')} imóveis em leilão`} em ${cidades.length === 1 ? '1 cidade' : `${cidades.length} cidades`} de ${esc(nomeUF)}.</p>
      ${caixaBuscaHero('', 'Ou escolha a cidade na lista abaixo.')}`,
    corpo: `<h2>Cidades de ${esc(nomeUF)}</h2>
      <ul class="ufs">${cidades.map(([cn, c]) => `<li><a href="${SITE}/leiloes/${uf.toLowerCase()}/${cn}"><span>${esc(c.nome)}</span><span class="n">${c.n.toLocaleString('pt-BR')}</span></a></li>`).join('')}</ul>
      ${caixaAviseMe('', uf)}
      <div class="faixa">
      <h2>Antes de dar um lance em ${esc(nomeUF)}</h2>
      <p class="sub">Cada imóvel de leilão tem uma história: ocupação, dívidas de condomínio e IPTU, ônus na matrícula, prazo de desocupação. A BidPro Brasil produz a análise de mercado, o parecer jurídico e o cálculo de viabilidade de cada lote. <a href="${SITE}/#/login?modo=cadastro">Comece grátis</a>.</p>
      </div>`,
    jsonld: { '@context': 'https://schema.org', '@type': 'CollectionPage', name: `Imóveis em leilão em ${nomeUF}`, url: `${SITE}/leiloes/${uf.toLowerCase()}` },
  });
}

// ── /leiloes/:uf/:cidade ─────────────────────────────────────────────────────
async function paginaCidade(uf, cidadeNorm, page) {
  const desloc = (page - 1) * POR_PAGINA;
  // Campos do cartão alinhado à Busca — todos já na linha (custo zero; a página é edge-cached).
  const campos = 'id,titulo,tipo,cidade,estado,bairro,area_m2,valor_minimo,valor_avaliacao,desconto_percentual,link_foto,modalidade,data_leilao,tem_edital_doc,tem_matricula_doc,fonte';
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
      hero: `<h1>Imóveis em <span class="destaque">leilão</span> em ${esc(nomeCidade)}</h1>
        <p class="sub">Nenhum lote ativo nesta cidade agora — o acervo muda toda semana. Busque uma cidade vizinha, ou
        <a href="${SITE}/leiloes/${uf.toLowerCase()}">veja as outras cidades de ${esc(UF_NOME[uf])}</a>.</p>
        ${caixaBuscaHero('', 'Digite outra cidade para ver o que está ativo hoje.')}`,
      corpo: `<div class="faixa">
        <h2>Por que uma cidade fica sem lote?</h2>
        <p class="sub">O acervo é o que os leiloeiros e a Caixa têm em praça AGORA — quando um lote é arrematado ou o leilão encerra, ele sai da lista. Cidades menores passam semanas sem nada e voltam de uma vez.
        <a href="${SITE}/#/login?modo=cadastro">Crie uma conta grátis</a> e receba um aviso quando entrar imóvel na sua região.</p>
        </div>`,
    });
  }

  const menor = itens.map(i => Number(i.valor_minimo)).filter(v => v > 0).sort((a, b) => a - b)[0];
  return pagina({
    titulo: `${total.toLocaleString('pt-BR')} imóveis em leilão em ${nomeCidade}/${uf}${page > 1 ? ` — página ${page}` : ''} | BidPro Brasil`,
    desc: `Casas, apartamentos e terrenos em leilão em ${nomeCidade}/${uf}${menor ? `, a partir de ${brl(menor)}` : ''}. Lance mínimo, avaliação, desconto e análise de viabilidade antes de arrematar.`,
    canonical: page > 1 ? `${base}?pagina=${page}` : base,
    migalha: [{ nome: 'Início', url: `${SITE}/` }, { nome: 'Imóveis em leilão', url: `${SITE}/leiloes` }, { nome: UF_NOME[uf], url: `${SITE}/leiloes/${uf.toLowerCase()}` }, { nome: nomeCidade }],
    hero: `<h1>Imóveis em <span class="destaque">leilão</span> em ${esc(nomeCidade)}/${esc(uf)}</h1>
      <p class="sub">${total === 1 ? '1 lote ativo' : `${total.toLocaleString('pt-BR')} lotes ativos`}${menor ? `, a partir de <strong>${esc(brl(menor))}</strong>` : ''}. Ordenados pelo maior desconto sobre a avaliação.</p>
      ${caixaBuscaHero('', 'Procurando em outra cidade? Digite o nome acima.')}`,
    corpo: `<div class="grade">${itens.map(cardImovel).join('')}</div>
      ${ultima > 1 ? `<nav class="pag">
        ${page > 1 ? `<a href="${base}${page - 1 > 1 ? `?pagina=${page - 1}` : ''}">← anterior</a>` : ''}
        <span>página ${page} de ${ultima}</span>
        ${page < ultima ? `<a href="${base}?pagina=${page + 1}">próxima →</a>` : ''}
      </nav>` : ''}
      ${caixaAviseMe(nomeCidade, uf)}
      <div class="faixa">
      <h2>Vale a pena arrematar em ${esc(nomeCidade)}?</h2>
      <p class="sub">Desconto grande nem sempre é bom negócio: o que decide é o valor de mercado do bairro, os débitos que vêm junto e o risco jurídico do processo.
      A BidPro Brasil entrega os três relatórios por imóvel — mercadológico, documental e jurídico —
      além do lance máximo que preserva o seu lucro. <a href="${SITE}/#/login?modo=cadastro">Crie sua conta grátis</a>.</p>
      </div>`,
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
  // Enriquecimento visual da ficha (tudo derivado do que a linha JÁ traz — custo zero).
  const pct = Number(im.desconto_percentual) || 0;
  const grau = pct >= 40 ? 'alto' : pct >= 20 ? 'medio' : 'baixo';
  const lance2 = brl(im.valor_minimo_2);
  const areaN = Number(im.area_m2) || 0, minN = Number(im.valor_minimo) || 0;
  const m2 = areaN > 0 && minN > 0 ? `R$ ${Math.round(minN / areaN).toLocaleString('pt-BR')}/m²` : null;
  const prazoISO = isoData(im.data_leilao);
  const modalCurto = MODAL_CURTO[String(im.modalidade || '').toLowerCase()] || null;
  const fonteRaw = String(im.fonte || '').trim();
  const ehCaixa = /caixa|cef/i.test(fonteRaw);
  const fonteLabel = ehCaixa ? 'CAIXA' : (fonteRaw ? fonteRaw.toUpperCase().slice(0, 18) : '');
  return pagina({
    // A ÚNICA das seis páginas públicas que tem um lote: é aqui, e só aqui, que os botões do
    // topo passam a levar o imóvel junto. Nas outras `imovelId` fica vazio e nada muda.
    imovelId: im.id,
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
      <!-- FICHA no padrão da tela interna: 2 colunas com sidebar de ação sticky. O layout é o
           do ImovelDetalhe, mas o conteúdo respeita o gate — mapa e análise aparecem como
           TEASER bloqueado (promessa), nunca o produto pago em si. Robô e pessoa veem o mesmo. -->
      <div class="ficha">
        <div class="ficha-main">
          <div class="foto-hero">
            ${im.link_foto ? `<img src="${esc(im.link_foto)}" alt="${esc(t)} em leilão em ${esc(im.cidade || '')}"/>` : `<div style="height:240px;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:14px">Sem foto disponível</div>`}
            <div class="over-tl"><span class="chip">${esc(t)}</span>${modalCurto ? `<span class="chip modal">${esc(modalCurto)}</span>` : ''}</div>
            ${pct > 0 ? `<div class="over-tr"><span class="badge-desc ${grau}">-${pct}%</span></div>` : ''}
            ${fonteLabel ? `<div class="over-bl"><span class="fonte${ehCaixa ? ' caixa' : ''}">${esc(fonteLabel)}</span></div>` : ''}
          </div>

          <div class="secao">
            <h2><span class="ic">💰</span> Valores</h2>
            <div class="dados">
              ${linha('Lance mínimo', lance)}
              ${lance2 ? linha('Lance 2ª praça', lance2) : ''}
              ${linha('Avaliação', aval)}
              ${linha('Desconto', pct > 0 ? `${pct}%` : null)}
              ${m2 ? linha('Preço por m²', m2) : ''}
              ${linha('Área', im.area_m2 > 0 ? `${Math.round(im.area_m2)} m²` : null)}
            </div>
          </div>

          <div class="secao">
            <h2><span class="ic">📋</span> Sobre o imóvel</h2>
            <div class="dados">
              ${linha('Tipo', t)}
              ${im.modalidade ? linha('Modalidade', MODALIDADE_LABEL[String(im.modalidade).toLowerCase()] || im.modalidade) : ''}
              ${linha('Cidade', im.cidade ? `${im.cidade}/${uf}` : null)}
              ${linha('Bairro', im.bairro)}
              ${linha('Data do leilão', dataBR(im.data_leilao))}
            </div>
            ${prazoISO ? `<div style="margin-top:12px"><span class="prazo-badge" data-prazo="${prazoISO}" style="display:none"></span></div>` : ''}
          </div>

          ${im.descricao ? `<div class="secao"><h2><span class="ic">📝</span> Descrição do lote</h2><p style="margin:0;color:#334155">${esc(String(im.descricao).slice(0, 1200))}</p></div>` : ''}

          <!-- TEASER de localização: mostra QUE existe mapa e chama o cadastro, sem revelar o
               endereço exato (que é do produto). Miolo borrado por CSS, sem dado real. -->
          <div class="secao">
            <h2><span class="ic">📍</span> Localização e mapa</h2>
            <div class="trava-vis"><div class="blur"></div><div class="lock">
              <span class="cad">🔒</span>
              <span class="tt">Endereço exato e mapa interativo</span>
              <span class="ds">A localização precisa, o mapa e os pontos de interesse ao redor (transporte, comércio, escolas) abrem ao criar sua conta grátis.</span>
            </div></div>
          </div>

          <div class="secao">
            <h2><span class="ic">⚖️</span> Análise e parecer</h2>
            <div class="trava-vis"><div class="blur"></div><div class="lock">
              <span class="cad">🔒</span>
              <span class="tt">BidScore, análise de mercado e parecer jurídico</span>
              <span class="ds">Nossa nota de 0 a 10 da viabilidade, quanto o imóvel vale de verdade no bairro e o raio-X jurídico (ocupação, dívidas e ônus na matrícula).</span>
            </div></div>
          </div>

          <!-- O GATE (08/08). PROMESSA VISÍVEL, não parede. Estas ~31 mil páginas são o ativo de
               busca orgânica: só rankeiam porque têm conteúdo legível, e mostrar ao Google algo
               diferente do que a pessoa vê é cloaking (penalidade). O público vê o FATO (preço,
               área, cidade, desconto); o cadastro abre o que é NOSSO (endereço, edital, matrícula,
               análise, lance máximo). Robô e pessoa veem exatamente a mesma coisa. -->
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

          <div class="secao">
            <h2><span class="ic">✅</span> O que checar antes de dar um lance</h2>
            <p class="sub" style="margin:0">Desconto sozinho não decide nada. O que decide é o preço real de mercado do bairro, os débitos que vêm junto (IPTU, condomínio, ônus na matrícula), a situação de ocupação e o risco jurídico do processo.</p>
          </div>

          ${im.cidade_norm && UF_NOME[uf] ? `<p><a href="${SITE}/leiloes/${uf.toLowerCase()}/${im.cidade_norm}">← Todos os imóveis em leilão em ${esc(im.cidade)}/${esc(uf)}</a></p>` : ''}
        </div>

        <aside class="ficha-side">
          <div class="acao">
            <div class="lance-lbl">Lance mínimo</div>
            <div class="lance-val">${lance ? esc(lance) : aval ? esc(aval) : 'Consulte'}</div>
            ${pct > 0 ? `<span class="desc-pill">${pct}% abaixo da avaliação</span>` : ''}
            <div class="score-lock"><div class="n">🔒</div><div class="tx"><b>BidScore</b> — nossa nota de 0 a 10 da viabilidade do arremate. Crie conta para ver.</div></div>
            <a class="cta" href="${SITE}/#/login?modo=cadastro&amp;imovel=${esc(im.id)}">Criar conta grátis e ver a ficha</a>
            <ul class="bullets">
              <li>3 análises gratuitas, sem cartão</li>
              <li>Endereço exato e mapa</li>
              <li>Edital, matrícula e parecer jurídico</li>
              <li>Lance máximo que preserva o lucro</li>
            </ul>
            ${prazoISO ? `<div style="margin-top:14px;text-align:center"><span class="prazo-badge" data-prazo="${prazoISO}" style="display:none"></span></div>` : ''}
          </div>
        </aside>
      </div>`,
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
