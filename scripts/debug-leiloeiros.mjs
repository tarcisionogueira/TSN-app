/**
 * Captura de diagnóstico de leiloeiros (Superbid, Sold, BB, Zukerman).
 * Para cada fonte: abre no navegador real, intercepta as APIs XHR JSON e
 * grava o DOM renderizado + os maiores JSON + estatísticas de seletores em
 * debug_fetch — base para escrever os parsers definitivos.
 *
 * Não grava em imoveis_leilao. Rodar via workflow debug-leiloeiros.yml.
 */
import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const ALVOS = [];

// Round 33 — PortalZuk: a página do lote TEM a "Matrícula do Imóvel" num card de
// download, mas o link é montado por JS (onclick _gt(...)) e não fica no HTML
// estático — por isso o vasculhador só pega o edital. Esta sonda: (1) extrai a
// FONTE da função _gt, (2) o HTML/onclick dos cards de Documentos, (3) CLICA no
// card da matrícula e intercepta a URL do PDF resultante. Com isso descobrimos a
// regra exata para capturar a matrícula do ZUK no scraper.
async function scanZukDocs(browser) {
  const url = 'https://www.portalzuk.com.br/imovel/sp/bertioga/morada-da-praia/rua-barra-velha-364/36639-228805';
  console.log(`\n=== ZUKDOC → ${url}`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  // Registra TODA requisição (não só JSON) — queremos ver a URL do PDF/documento
  // que o clique dispara.
  const reqs = [];
  page.on('request', (r) => { try { reqs.push(`${r.method()} ${r.resourceType()} ${r.url()}`); } catch {} });
  // Novas abas (o _gt pode fazer window.open) — captura a URL de destino.
  const popups = [];
  browser.on('targetcreated', async (t) => { try { if (t.type() === 'page') popups.push(t.url()); } catch {} });

  try { await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 }); } catch (e) { console.log(`  goto: ${e.message.slice(0, 80)}`); }
  await new Promise(r => setTimeout(r, 5000));

  // 1) Fonte da função _gt + cards de Documentos (onclick/href/data-*).
  const info = await page.evaluate(() => {
    const out = { gtSource: null, cards: [], scriptsComGt: [] };
    try { if (typeof window._gt === 'function') out.gtSource = window._gt.toString().slice(0, 1500); } catch {}
    // Procura a definição de _gt no texto dos scripts inline.
    try {
      for (const s of Array.from(document.querySelectorAll('script'))) {
        const t = s.textContent || '';
        const i = t.indexOf('_gt');
        if (i >= 0 && /function\s+_gt|_gt\s*=\s*function|_gt\s*=\s*\(/.test(t)) out.scriptsComGt.push(t.slice(Math.max(0, i - 40), i + 600));
      }
    } catch {}
    // Cards/âncoras da seção Documentos: qualquer elemento cujo texto cite Matrícula/Edital.
    try {
      const alvos = Array.from(document.querySelectorAll('a,button,[onclick],[class*="document"],[class*="doc"],[class*="card"]'));
      for (const el of alvos) {
        const txt = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (/matr[ií]cul|edital|documento/i.test(txt) && txt.length < 60) {
          out.cards.push({ tag: el.tagName, txt: txt.slice(0, 50), onclick: el.getAttribute('onclick'), href: el.getAttribute('href'), html: el.outerHTML.slice(0, 400) });
        }
        if (out.cards.length >= 12) break;
      }
    } catch {}
    return out;
  }).catch(e => ({ err: String(e.message) }));
  await gravarDebug('ZUKDOC-info', url, 200, 'application/json', JSON.stringify(info, null, 2));
  console.log(`  _gt source: ${info.gtSource ? 'sim' : 'não'} · cards: ${(info.cards || []).length} · scriptsComGt: ${(info.scriptsComGt || []).length}`);

  // 2) CLICA no card da matrícula e observa as requisições disparadas.
  const reqsAntes = reqs.length;
  try {
    const clicou = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a,button,[onclick],[class*="card"],[class*="document"]'));
      const alvo = els.find(el => /matr[ií]cul/i.test((el.textContent || '')) && (el.textContent || '').length < 60);
      if (!alvo) return false;
      alvo.click();
      return true;
    });
    console.log(`  clique na matrícula: ${clicou ? 'ok' : 'card não encontrado'}`);
    await new Promise(r => setTimeout(r, 4000));
  } catch (e) { console.log(`  clique falhou: ${e.message.slice(0, 60)}`); }

  const novas = reqs.slice(reqsAntes);
  const docReqs = reqs.filter(u => /\.pdf|documentac|matricul|edital|documento|download|arquivo/i.test(u));
  await gravarDebug('ZUKDOC-reqs', url, 200, 'text/plain',
    `POPUPS:\n${popups.join('\n')}\n\nREQS APÓS CLIQUE:\n${novas.join('\n')}\n\nREQS DE DOCUMENTO (todas):\n${docReqs.join('\n')}`);
  console.log(`  reqs após clique: ${novas.length} · docReqs: ${docReqs.length}`);
  docReqs.slice(0, 10).forEach(u => console.log(`    ${u.slice(0, 130)}`));

  // 3) ESTRUTURA DO LOGIN: a matrícula abre #modalLogin. Precisamos do endpoint e
  //    dos campos do formulário para logar no scraper. Extrai todos os forms + o
  //    modal de login + rotas de login candidatas.
  const login = await page.evaluate(() => {
    const out = { forms: [], modalLogin: null, matriculaAnchor: null, linksConta: [] };
    try {
      for (const f of Array.from(document.querySelectorAll('form'))) {
        out.forms.push({
          action: f.getAttribute('action'), method: f.getAttribute('method'), id: f.id, cls: f.className,
          inputs: Array.from(f.querySelectorAll('input,button')).map(i => ({ name: i.name, type: i.type, id: i.id })),
        });
      }
    } catch {}
    try { const m = document.querySelector('#modalLogin'); if (m) out.modalLogin = m.outerHTML.slice(0, 2500); } catch {}
    try { const a = document.querySelector('a[data-target="#modalLogin"] , .property-documents-item[href=""]'); if (a) out.matriculaAnchor = a.outerHTML.slice(0, 500); } catch {}
    try { out.linksConta = Array.from(document.querySelectorAll('a[href*="login"],a[href*="entrar"],a[href*="conta"],a[href*="cadastr"]')).map(a => a.getAttribute('href')).slice(0, 10); } catch {}
    return out;
  }).catch(e => ({ err: String(e.message) }));
  await gravarDebug('ZUKDOC-login', url, 200, 'application/json', JSON.stringify(login, null, 2));
  console.log(`  forms: ${(login.forms || []).length} · modalLogin: ${login.modalLogin ? 'sim' : 'não'}`);

  // 4) HTML renderizado completo (fallback para inspeção manual).
  let html = ''; try { html = await page.content(); } catch {}
  await gravarDebug('ZUKDOC-render', url, 200, 'text/html', html);
  await page.close().catch(() => {});
}

// Descobre a query de LISTA DE LOTES da Leilotech. Carrega a home (limpa Cloudflare),
// então dentro da página: (1) tenta INTROSPECTION do schema para achar o campo raiz
// que lista lotes com filtro; (2) roda HomeBootstrap p/ pegar um slug de leilão real e
// (3) navega ao detalhe do leilão para capturar a query de lotes que dispara lá.
async function scanLeilotech(browser) {
  console.log('🔎 Leilotech — capturando (via interceptação) a query de lotes do leilão...');
  const base = 'https://oleiloes.com.br/';
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  // Casa requisição→resposta do GraphQL (a resposta não traz o operationName).
  const reqByOrder = [];
  const gql = [];
  page.on('request', (req) => {
    try { if (/\/go\/graphql/.test(req.url())) { let op = ''; try { op = (JSON.parse(req.postData()||'{}').operationName)||''; } catch {} reqByOrder.push(op); } } catch {}
  });
  page.on('response', async (resp) => {
    try {
      if (!/\/go\/graphql/.test(resp.url())) return;
      const t = await resp.text();
      const op = reqByOrder.shift() || '?';
      gql.push({ op, len: t.length, json: t.slice(0, 60) === t.slice(0,60) && t[0] === '{' ? t : '(nao-json)', sample: t.slice(0, 400) });
    } catch {}
  });
  const out = {};
  try {
    // 1) Home: a SPA dispara leiloesHome (passa pelo Cloudflare). Interceptamos.
    await page.goto(base, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 5000));
    for (let i = 0; i < 6; i++) { try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {} await new Promise(r => setTimeout(r, 1200)); }

    // Extrai leilões de imóveis (slug/categoria/lotesCount) da resposta interceptada.
    const homeResp = gql.filter(g => g.op === 'HomeBootstrap' && g.json !== '(nao-json)').sort((a,b)=>b.len-a.len)[0];
    let leiloes = [], itemsFull = [];
    if (homeResp) {
      try {
        const j = JSON.parse(homeResp.json);
        itemsFull = j?.data?.leiloesHome?.items || [];
        leiloes = itemsFull.map(i => ({ slug: i.slug, cat: i.categoriaMascara, lotes: i.lotesCount, title: (i.title||'').slice(0,40) }));
        out.pagination = j?.data?.leiloesHome?.pagination;
        // Dump BRUTO do 1º item de imóvel — precisamos ver primaryLote (valores/foto).
        const imv = itemsFull.find(i => /im[oó]vel/i.test(i.title||'') || /im[oó]vel/i.test(i.categoriaMascara||''));
        out.rawImovelItem = JSON.stringify(imv || itemsFull[0] || null).slice(0, 2500);
      } catch (e) { out.parseErr = String(e && e.message); }
    }
    out.leiloes = leiloes.slice(0, 12);

    // 2) Abre o detalhe do 1º leilão (de preferência de imóveis) → SPA busca os lotes.
    const alvo = leiloes.find(l => /im[oó]ve/i.test(l.cat || '')) || leiloes[0];
    if (alvo?.slug) {
      out.alvo = alvo;
      gql.length = 0; reqByOrder.length = 0;
      // tenta rotas prováveis de detalhe do leilão
      for (const rota of [`leilao/${alvo.slug}`, `leiloes/${alvo.slug}`]) {
        await page.goto(`${base}${rota}`, { waitUntil: 'networkidle2', timeout: 45000 }).catch(() => {});
        await new Promise(r => setTimeout(r, 4000));
        for (let i = 0; i < 5; i++) { try { await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); } catch {} await new Promise(r => setTimeout(r, 1200)); }
        if (gql.some(g => g.op !== 'Bootstrap' && g.op !== '?')) break;
      }
      out.detalheOps = gql.map(g => ({ op: g.op, len: g.len }));
      // maior resposta não-Bootstrap = provavelmente os lotes
      const loteResp = gql.filter(g => g.op !== 'Bootstrap' && g.json !== '(nao-json)').sort((a,b)=>b.len-a.len)[0];
      if (loteResp) { out.loteOp = loteResp.op; out.loteSample = loteResp.sample; out.loteLen = loteResp.len; }
    }
  } catch (e) { out.erro = String(e && e.message); }
  await gravarDebug('LT-SCHEMA', base, 200, 'application/json', JSON.stringify(out, null, 2));
  console.log(`  leilões: ${out.leiloes?.length ?? 0}; alvo: ${out.alvo?.slug ?? 'n/a'}; loteOp: ${out.loteOp ?? 'n/a'}`);
  await page.close();
}

// Diagnóstico VIP: pega os eventos da agenda e, para cada um, conta os cards de
// anúncio via 3 métodos (DOM da detalhe / fetch /evento/lotes / fetch com header
// XHR). Mostra POR QUE a coleta traz só 7 — quais eventos têm imóveis e qual
// método realmente devolve os cards.
async function scanVIP(browser) {
  console.log('🔎 Diagnóstico Leilão VIP (contagem de anúncios por evento)...');
  const VIP = 'https://www.leilaovip.com.br';
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const relatorio = { agenda: {}, eventos: [] };
  try {
    await page.goto(`${VIP}/agenda?segmento=Im%C3%B3veis`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await new Promise(r => setTimeout(r, 2500));
    const info = await page.evaluate(() => {
      const detalhes = new Set(), anuncioLinks = new Set();
      document.querySelectorAll('a[href*="/evento/detalhes/"]').forEach(a => {
        const m = (a.getAttribute('href') || '').match(/\/evento\/detalhes\/([^/?#]+)/); if (m) detalhes.add(m[1]);
      });
      document.querySelectorAll('a[href*="/evento/anuncio/"]').forEach(a => anuncioLinks.add(a.getAttribute('href')));
      return {
        nCardEvento: document.querySelectorAll('.card-evento').length,
        nCardAnuncio: document.querySelectorAll('.card-anuncio').length,
        nCard: document.querySelectorAll('[class*="card"]').length,
        detalhes: [...detalhes], nAnuncioLinks: anuncioLinks.size,
      };
    });
    relatorio.agenda = { nCardEvento: info.nCardEvento, nCardAnuncio: info.nCardAnuncio, nCard: info.nCard, nEventos: info.detalhes.length, nAnuncioLinks: info.nAnuncioLinks };

    for (const ev of info.detalhes.slice(0, 8)) {
      await page.goto(`${VIP}/evento/detalhes/${ev}`, { waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 1500));
      const r = await page.evaluate(async (id) => {
        const cnt = (html) => { try { return new DOMParser().parseFromString(html, 'text/html').querySelectorAll('.card-anuncio').length; } catch { return -1; } };
        const domDetalhe = document.querySelectorAll('.card-anuncio').length;
        let lotesPlain = { status: 0, cards: -1, len: 0 };
        let lotesXhr = { status: 0, cards: -1, len: 0 };
        try { const x = await fetch(`/evento/lotes/${id}`, { credentials: 'include' }); const t = await x.text(); lotesPlain = { status: x.status, cards: cnt(t), len: t.length }; } catch (e) { lotesPlain.err = String(e && e.message); }
        try { const x = await fetch(`/evento/lotes/${id}`, { credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest' } }); const t = await x.text(); lotesXhr = { status: x.status, cards: cnt(t), len: t.length }; } catch (e) { lotesXhr.err = String(e && e.message); }
        return { domDetalhe, lotesPlain, lotesXhr };
      }, ev).catch((e) => ({ erro: String(e && e.message) }));
      relatorio.eventos.push({ ev, ...r });
    }
  } catch (e) { relatorio.erro = String(e && e.message); }
  await gravarDebug('VIP-DIAG', 'scan', 200, 'application/json', JSON.stringify(relatorio, null, 2));
  console.log('  ', JSON.stringify(relatorio).slice(0, 400));
  await page.close();
}

// Mede o VOLUME de imóveis por portal do Superbid e IDENTIFICA o leiloeiro/portal
// via seoTitle+seoBreadcrumb. Depois testa SOBREPOSIÇÃO: pega o 1º offer de cada
// sub-portal e verifica se ele TAMBÉM aparece no portal 2 (marketplace-mãe) — se
// sim, plugar sub-portais só traz DUPLICADOS, não imóveis novos.
async function scanSuperbidPortais(browser) {
  console.log('🔎 Scan de portais do Superbid (volume + identidade + sobreposição)...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  try { await page.goto('https://www.superbid.net/', { waitUntil: 'domcontentloaded', timeout: 45000 }); } catch {}
  await new Promise(r => setTimeout(r, 3000));
  const res = await page.evaluate(async () => {
    const base = 'https://offer-query.superbid.net/offers/';
    const q = (portal, size, id) =>
      `${base}?portalId=[${portal}]&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=1&pageSize=${size}&orderBy=endDate:asc`;
    const out = [];
    // 1) volume + identidade por portal
    for (let portal = 1; portal <= 120; portal++) {
      try {
        const r = await fetch(q(portal, 1), { headers: { Accept: 'application/json' } });
        if (!r.ok) continue;
        const d = await r.json();
        const total = d.total ?? d.totalElements ?? d.totalCount ?? null;
        const first = (d.offers || d.content || d.results || d.items || [])[0] || null;
        if ((total && total > 0) || first) {
          out.push({
            portal, total,
            seoTitle: d.seoTitle || null,
            seoBreadcrumb: JSON.stringify(d.seoBreadcrumb || null).slice(0, 300),
            firstId: first?.id ?? null,
          });
        }
      } catch (e) { /* portal inexistente */ }
      await new Promise(r => setTimeout(r, 50));
    }
    // 2) teste de sobreposição: os primeiros 100 ids do portal 2 (mãe) contêm os
    //    firstId dos sub-portais? Se sim → sub-portais são subconjunto do portal 2.
    let idsPortal2 = [];
    try {
      const r = await fetch(q(2, 100), { headers: { Accept: 'application/json' } });
      const d = await r.json();
      idsPortal2 = (d.offers || d.content || []).map(o => o.id);
    } catch {}
    const overlap = out
      .filter(p => p.portal !== 2 && p.firstId)
      .map(p => ({ portal: p.portal, firstId: p.firstId, noPortal2: idsPortal2.includes(p.firstId) }));
    return { portais: out, idsPortal2Count: idsPortal2.length, overlap };
  }).catch((e) => ({ erro: String(e && e.message || e) }));
  await gravarDebug('SUPERBID-PORTAIS', 'scan-1-120+overlap', 200, 'application/json', JSON.stringify(res, null, 2));
  console.log(`  resultado: ${JSON.stringify(res).slice(0, 200)}`);
  await page.close();
}

async function gravarDebug(fonte, url, status, contentType, conteudo) {
  const txt = String(conteudo || '').slice(0, 400000);
  const { error } = await supabase.from('debug_fetch').insert({
    fonte, url, status, content_type: contentType, via: 'puppeteer', conteudo: txt,
  });
  if (error) console.log(`  erro gravarDebug ${fonte}: ${error.message}`);
  else console.log(`  gravado ${fonte} (${txt.length} chars)`);
}

async function capturar(browser, { fonte, url, inPageApi, inPageApis }) {
  console.log(`\n=== ${fonte} → ${url}`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const xhrs = [];
  page.on('response', async (resp) => {
    try {
      const ct = resp.headers()['content-type'] || '';
      if (!/json/i.test(ct)) return;
      const text = await resp.text();
      if (text.length < 80) return;
      let reqHeaders = {};
      try { reqHeaders = resp.request().headers(); } catch {}
      xhrs.push({ url: resp.url(), ct, status: resp.status(), text, reqHeaders });
    } catch {}
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
  } catch (e) {
    console.log(`  goto falhou: ${e.message.slice(0, 80)}`);
  }
  await new Promise(r => setTimeout(r, 6000));

  // Autoscroll: dispara lazy-load/paginação-ao-rolar de SPAs (o catálogo às vezes
  // só busca a API quando a lista entra em viewport). Best-effort.
  try {
    await page.evaluate(async () => {
      for (let i = 0; i < 6; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise(r => setTimeout(r, 800));
      }
      window.scrollTo(0, 0);
    });
    await new Promise(r => setTimeout(r, 2500));
  } catch { /* ok */ }

  // Fetch de API dentro do contexto da página (usa o TLS/fingerprint do Chrome real
  // e carrega Origin/Referer corretos — vários endpoints/WAFs dão 403/405 a fetch
  // de datacenter ou navegação direta). Aceita uma única (inPageApi) ou várias
  // sondas (inPageApis) quando a rota exata ainda é desconhecida.
  const apis = [...(inPageApis || []), ...(inPageApi ? [inPageApi] : [])];
  for (let i = 0; i < apis.length; i++) {
    const u = apis[i];
    try {
      const res = await page.evaluate(async (url) => {
        try {
          const r = await fetch(url, { headers: { Accept: 'application/json' }, credentials: 'include' });
          return { status: r.status, ct: r.headers.get('content-type') || '', text: await r.text() };
        } catch (e) { return { status: 0, ct: '', text: `__err: ${String((e && e.message) || e)}` }; }
      }, u);
      await gravarDebug(`${fonte}-api-${i + 1}`, u, res.status, res.ct || 'application/json', res.text);
      console.log(`  inPageApi ${fonte} [${res.status}] ${String(res.text).length}b ${u.slice(0, 90)}`);
    } catch (e) { console.log(`  inPageApi falhou (${u.slice(0, 60)}): ${e.message.slice(0, 60)}`); }
  }

  // DOM renderizado
  let html = '';
  try { html = await page.content(); } catch {}
  await gravarDebug(`${fonte}-render`, url, 200, 'text/html', html);

  // Lista de XHRs (maiores primeiro)
  xhrs.sort((a, b) => b.text.length - a.text.length);
  const lista = xhrs.map(x => `${x.status} ${x.text.length}b ${x.ct}\n${x.url}`).join('\n\n');
  await gravarDebug(`${fonte}-xhr-list`, url, 200, 'text/plain', lista || '(nenhum JSON)');
  console.log(`  XHRs JSON: ${xhrs.length}`);
  xhrs.slice(0, 6).forEach(x => console.log(`    ${x.text.length}b ${x.url.slice(0, 110)}`));

  // 2 maiores JSON
  for (let i = 0; i < Math.min(2, xhrs.length); i++) {
    await gravarDebug(`${fonte}-xhr-${i + 1}`, xhrs[i].url, xhrs[i].status, xhrs[i].ct, xhrs[i].text);
  }

  // XHRs de interesse (independem do tamanho): endpoints por-bem/imóvel/lote
  const INTERESSE = /get-bens|get-imovel|get-lote|\/imovel|\/bens|\/lotes|por-estado/i;
  let m = 0;
  for (const x of xhrs) {
    if (INTERESSE.test(x.url) && m < 4) {
      m++;
      await gravarDebug(`${fonte}-match-${m}`, x.url, x.status, x.ct, x.text);
      await gravarDebug(`${fonte}-match-${m}-reqhdr`, x.url, x.status, 'application/json', JSON.stringify(x.reqHeaders || {}, null, 2));
      console.log(`  match ${m}: ${x.text.length}b ${x.url.slice(0, 120)}`);
    }
  }

  // Estatísticas de seletores no DOM + 1º card de exemplo
  try {
    const dom = await page.evaluate(() => {
      const sel = {};
      ['[class*="card"]', '[class*="lot"]', '[class*="product"]', '[class*="offer"]', '[class*="imovel"]', 'article', '[data-id]', '[data-key]', 'a[href*="/lote"]', 'a[href*="/imovel"]', 'a[href*="/imoveis"]']
        .forEach(s => { try { sel[s] = document.querySelectorAll(s).length; } catch { sel[s] = -1; } });
      const c = document.querySelector('[class*="card"], [class*="lot"], [class*="product"], article');
      return { sel, sample: c ? c.outerHTML.slice(0, 2200) : null };
    });
    await gravarDebug(`${fonte}-domstats`, url, 200, 'application/json', JSON.stringify(dom, null, 2));
    console.log(`  domstats: ${JSON.stringify(dom.sel)}`);
  } catch (e) { console.log(`  domstats falhou: ${e.message.slice(0, 60)}`); }

  await page.close();
}

async function main() {
  console.log('🔎 Debug leiloeiros —', new Date().toISOString());
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });
  try {
    for (const alvo of ALVOS) {
      try { await capturar(browser, alvo); }
      catch (e) { console.log(`  ${alvo.fonte} erro: ${e.message.slice(0, 80)}`); }
    }
    // Round 33 — descobrir como o ZUK monta a URL da matrícula (onclick _gt).
    try { await scanZukDocs(browser); }
    catch (e) { console.log(`  ZUKDOC erro: ${e.message.slice(0, 80)}`); }
  } finally {
    await browser.close();
  }
  console.log('\n✅ Debug leiloeiros concluído');
}

main().catch(e => { console.error('Erro fatal:', e); process.exit(1); });
