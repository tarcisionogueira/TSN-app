/**
 * GET/POST /api/scraper-leiloeiros
 * Scraper de leiloeiros (Sold, Mega, Superbid) via Bright Data (Web Unlocker).
 *
 * Roda na Vercel (onde estão as env do Bright Data). As fontes barram IPs de cloud
 * (Vercel/Actions) → 403; o BD desbloqueia. Testável: dispara → confere o banco.
 * fetch direto primeiro (rápido); se 403/erro → fetchViaBrightData (sob teto semanal).
 *
 * Runtime Node neste projeto usa a assinatura (req, res) — responder via res.* (um
 * `return new Response()` seria IGNORADO e a função travaria até o timeout).
 *
 * Acesso: CRON_SECRET (?secret=/header x-cron-secret) ou JWT admin/analista.
 * Query: ?fontes=sold,mega,superbid · ?sold_paginas=3 · ?superbid_paginas=2 · ?mega_ufs=SP,RJ,MG,BA
 */
export const config = { runtime: 'nodejs', maxDuration: 300 };

import { fetchViaBrightData, brightDataDisponivel } from './_brightdata.js';
import { getUser, getUserRoleById, isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// fetch direto; se 403/erro → Bright Data (sob teto). Retorna sempre o texto bruto.
async function fetchVia(targetUrl, { accept = 'text/html,application/json;q=0.9,*/*;q=0.8', headers = {} } = {}) {
  const h = { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9', ...headers };
  let resp = null;
  try { resp = await fetch(targetUrl, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(8000) }); } catch { resp = null; }
  if (resp && resp.ok) {
    const text = await resp.text().catch(() => '');
    if (text) return { ok: true, status: resp.status, contentType: resp.headers.get('content-type') || '', via: 'direct', text };
  }
  const bd = await fetchViaBrightData(targetUrl);
  if (bd) {
    const text = await bd.text().catch(() => '');
    if (text) return { ok: true, status: bd.status, contentType: bd.headers.get('content-type') || '', via: 'brightdata', text };
  }
  return { ok: false, status: resp?.status || 0, contentType: '', via: bd ? 'brightdata' : 'direct', text: '' };
}

// Salva conteúdo bruto da fonte no Supabase (debug_fetch) p/ inspeção via MCP.
async function gravarDebug(fonte, url, status, contentType, via, conteudo) {
  try {
    await sb('debug_fetch', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ fonte, url, status, content_type: contentType, via, conteudo: (conteudo || '').slice(0, 400000) }),
    });
  } catch (_) { /* ignore */ }
}

function parseNum(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim());
  return isNaN(n) ? 0 : n;
}

function normalizarTipo(t) {
  if (!t) return 'imovel';
  const s = String(t).toLowerCase();
  if (s.includes('apart') || s.includes('apto')) return 'apartamento';
  if (s.includes('casa') || s.includes('sobrado')) return 'casa';
  if (s.includes('terreno') || s.includes('lote') || s.includes('gleba')) return 'terreno';
  if (s.includes('comerc') || s.includes('sala') || s.includes('loja') || s.includes('galp') || s.includes('predio')) return 'comercial';
  if (s.includes('rural') || s.includes('sitio') || s.includes('fazenda') || s.includes('chacara')) return 'rural';
  return 'imovel';
}

// Diagnóstico estrutural de uma resposta HTML (para reverse-engineer os seletores)
function htmlDiag(text) {
  const t = text || '';
  const classes = [...new Set((t.match(/class="[^"]*(?:card|lote|lot|imovel|im[óo]vel|product|result|listing|leilao|grid)[^"]*"/gi) || []).map(c => c.slice(0, 90)))].slice(0, 10);
  const apiHints = [...new Set((t.match(/["'](\/(?:api|_next|graphql)\/[^"'?\s]+|https?:\/\/[^"'\s]*\/(?:api|graphql)[^"'?\s]*)["']/gi) || []).map(s => s.replace(/["']/g, '')))].slice(0, 10);
  const precoIdx = t.search(/R\$\s*[\d.]/);
  const precoCtx = precoIdx >= 0 ? t.slice(Math.max(0, precoIdx - 350), precoIdx + 220).replace(/\s+/g, ' ') : null;
  const hrefs = [...new Set((t.match(/href="[^"]*(?:lote|imovel|lot)[^"]*"/gi) || []).map(h => h.slice(0, 90)))].slice(0, 6);
  return {
    len: t.length,
    temNextData: /__NEXT_DATA__|__NUXT__|__INITIAL_STATE__|window\.__/.test(t),
    temLdJson: /application\/ld\+json/.test(t),
    classesCard: classes,
    hrefsLote: hrefs,
    apiHints,
    precoCtx,
  };
}

// ─── SOLD (API JSON) ───────────────────────────────────────────────────────────
async function coletarSold(paginas, deadline) {
  const out = []; let via = '-', diag = null;
  for (let p = 1; p <= paginas; p++) {
    if (Date.now() > deadline) break;
    const url = `https://www.sold.com.br/api/v1/lots?category_ids=1&status=open&page=${p}&per_page=50&order=relevance`;
    const r = await fetchVia(url, { accept: 'application/json', headers: { Referer: 'https://www.sold.com.br/leiloes-de-imoveis', 'x-requested-with': 'XMLHttpRequest' } });
    via = r.via;
    let data = null; try { data = JSON.parse(r.text); } catch { /* */ }
    const lots = data?.lots || data?.data || data?.results || data?.items || [];
    if (!lots.length) {
      if (p === 1) {
        const lp = await fetchVia('https://www.sold.com.br/leiloes-de-imoveis', { headers: { Referer: 'https://www.sold.com.br/' } });
        diag = { http: r.status, contentType: r.contentType, api: htmlDiag(r.text), listagem: { http: lp.status, ct: lp.contentType, via: lp.via, ...htmlDiag(lp.text) } };
        await gravarDebug('SOLD-api', url, r.status, r.contentType, r.via, r.text);
        await gravarDebug('SOLD-listagem', 'https://www.sold.com.br/leiloes-de-imoveis', lp.status, lp.contentType, lp.via, lp.text);
      }
      break;
    }
    for (const lot of lots) {
      const loc = lot.location || lot.address || {};
      const vmin = parseNum(lot.minimum_bid || lot.initial_bid || lot.price);
      if (!lot.id || vmin <= 0) continue;
      out.push({
        fonte: 'SOLD', fonte_id: `sold_${lot.id || lot.lot_id}`,
        titulo: lot.title || lot.name || `Imóvel Sold ${lot.id}`,
        tipo: normalizarTipo(lot.title || lot.category),
        modalidade: (lot.judicial || lot.type === 'judicial') ? 'judicial' : 'extrajudicial',
        estado: loc.state || lot.state || '', cidade: loc.city || lot.city || '',
        bairro: loc.neighborhood || lot.neighborhood || '', endereco: loc.street || lot.address_street || '',
        valor_avaliacao: parseNum(lot.appraisal_value || lot.evaluation),
        valor_minimo: vmin,
        area_m2: parseNum(lot.area || lot.useful_area),
        descricao: (lot.description || '').replace(/<[^>]+>/g, '').slice(0, 500) || null,
        link_edital: lot.url || `https://www.sold.com.br/lote/${lot.id}`,
        link_foto: lot.image || lot.thumbnail || lot.photo || null,
        leiloeiro: lot.auctioneer?.name || lot.company || 'Sold Leilões',
        data_leilao: (lot.end_date || lot.auction_date || '').slice(0, 10) || null,
        forma_pagamento: null,
      });
    }
  }
  return { rows: out, via, diag };
}

// ─── SUPERBID (API JSON) ─────────────────────────────────────────────────────────
async function coletarSuperbid(paginas, deadline) {
  const out = []; let via = '-', diag = null;
  // A API antiga (seo/offers?categoryId) retorna "categoryId inválido". Tenta a
  // v1/offer/search?categorySlug primeiro; cai na seo (categorySlug) como fallback.
  const urlsDe = (p) => [
    `https://offer-query.superbid.net/v1/offer/search?locale=pt_BR&categorySlug=imoveis&pageNumber=${p}&pageSize=50&status=OPENED&orderBy=score`,
    `https://offer-query.superbid.net/seo/offers/?locale=pt_BR&portalId=%5B2%2C15%5D&requestOrigin=marketplace&orderBy=score%3Adesc&pageNumber=${p}&pageSize=50&searchType=opened&categorySlug=imoveis`,
  ];
  for (let p = 1; p <= paginas; p++) {
    if (Date.now() > deadline) break;
    let offers = []; const tentativas = [];
    for (const url of urlsDe(p)) {
      const r = await fetchVia(url, { accept: 'application/json', headers: { Origin: 'https://www.superbid.net', Referer: 'https://www.superbid.net/categorias/imoveis' } });
      via = r.via;
      let data = null; try { data = JSON.parse(r.text); } catch { /* */ }
      const off = data?.offers || data?.data?.offers || data?.result?.offers || data?.content || data?.items || data?.results || [];
      if (off.length) { offers = off; break; }
      tentativas.push({ api: url.replace('https://offer-query.superbid.net', '').slice(0, 24), http: r.status, keys: data ? Object.keys(data).slice(0, 6) : null, amostra: r.text.slice(0, 160) });
      if (p === 1) await gravarDebug('SUPERBID', url, r.status, r.contentType, r.via, r.text);
    }
    if (!offers.length) { if (p === 1) diag = { via, tentativas }; break; }
    for (const of of offers) {
      const pr = of.product || of; const loc = pr.location || of.location || {}; const det = of.offerDetail || of;
      const id = of.id || of.offerId;
      const vmin = parseNum(det.initialBidValue || det.currentMinBid || of.initialBidValue || of.minBid);
      if (!id || vmin <= 0) continue;
      const cidadeCompleta = loc.city || '';
      const estUF = (cidadeCompleta.match(/[-–]\s*([A-Z]{2})$/) || [])[1] || loc.state || '';
      out.push({
        fonte: 'SUPERBID', fonte_id: `sbid_${id}`,
        titulo: pr.shortDesc || pr.description || `Imóvel ${cidadeCompleta}`,
        tipo: normalizarTipo(pr.subCategory?.description || of.categoryDesc),
        modalidade: (of.auction?.subMarketplaces || []).some(s => s.desc === 'Judicial') ? 'judicial' : 'extrajudicial',
        estado: estUF, cidade: cidadeCompleta.replace(/\s*[-–]\s*[A-Z]{2}$/, '').trim(),
        bairro: loc.neighborhood || '', endereco: loc.street || '',
        valor_avaliacao: parseNum(det.referenceValue || det.directSaleValue || of.referenceValue),
        valor_minimo: vmin,
        area_m2: parseNum(((of.offerDescription || '').match(/(\d+[.,]?\d*)\s*m2/i) || [])[1]),
        descricao: (of.offerDescription || '').replace(/<[^>]+>/g, '').slice(0, 500) || null,
        link_edital: `https://www.superbid.net/lote/${id}`,
        link_foto: pr.thumbnailUrl || null,
        leiloeiro: of.store?.name || of.seller?.name || 'Superbid',
        data_leilao: (of.endDate || '').slice(0, 10) || null,
        forma_pagamento: null,
      });
    }
  }
  return { rows: out, via, diag };
}

// ─── MEGA (HTML anti-bot) ────────────────────────────────────────────────────────
async function coletarMega(ufs, deadline) {
  const out = []; let via = '-', diag = null;
  for (const uf of ufs) {
    if (Date.now() > deadline) break;
    const url = `https://www.megaleiloes.com.br/imoveis?estado=${uf}`;
    const r = await fetchVia(url, { headers: { Referer: 'https://www.megaleiloes.com.br/' } });
    via = r.via;
    const html = r.text; const seen = new Set(); const antes = out.length;
    // Cards têm <div> aninhados → regex de bloco quebra. Abordagem: achar os links
    // de lote reais (/imoveis/<categoria>/<uf>/<cidade>/<slug> — 4+ segmentos) e
    // extrair preço/área/foto de uma JANELA DE CONTEXTO a partir do link.
    const reLote = /href="(?:https:\/\/www\.megaleiloes\.com\.br)?(\/imoveis\/[^"/?#]+\/[a-z]{2}\/[^"/?#]+\/[^"/?#]+)[^"]*"/gi;
    let m;
    while ((m = reLote.exec(html)) !== null && (out.length - antes) < 80) {
      const href = `https://www.megaleiloes.com.br${m[1]}`;
      if (seen.has(href)) continue; seen.add(href);
      const ctx = html.slice(m.index, m.index + 1800); // card a partir do link
      const valor = parseNum((ctx.match(/R\$\s*([\d][\d.]*(?:,\d{1,2})?)/) || [])[1]);
      if (!valor) continue;
      const aval = parseNum((ctx.match(/avalia[^R]{0,40}R\$\s*([\d][\d.]*(?:,\d{1,2})?)/i) || [])[1]);
      const area = parseNum((ctx.match(/([\d.]+)\s*m[²2]/i) || [])[1]);
      const foto = (ctx.match(/(?:src|data-src)="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/i) || [])[1] || null;
      // /imoveis/<categoria>/<uf>/<cidade>/<slug>
      const seg = href.replace('https://www.megaleiloes.com.br/imoveis/', '').split('/');
      const categoria = seg[0] || '';
      const ufHref = (seg[1] || uf).toUpperCase();
      const cidadeSlug = seg[2] || '';
      const slug = seg.slice(3).join('-') || seg[seg.length - 1] || '';
      const titleCase = s => s.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim();
      const titulo = titleCase(decodeURIComponent(slug)).slice(0, 120);
      out.push({
        fonte: 'MEGA', fonte_id: `mega_${slug.slice(0, 80) || (m.index)}`,
        titulo: titulo || `Imóvel Mega Leilões ${uf}`,
        tipo: normalizarTipo(`${categoria} ${titulo}`),
        modalidade: /judicial/i.test(ctx) ? 'judicial' : 'extrajudicial',
        estado: ufHref.length === 2 ? ufHref : uf,
        cidade: titleCase(decodeURIComponent(cidadeSlug)), bairro: '', endereco: '',
        valor_avaliacao: aval, valor_minimo: valor, area_m2: area,
        descricao: titulo.slice(0, 300) || null,
        link_edital: href,
        link_foto: foto ? (foto.startsWith('http') ? foto : `https://www.megaleiloes.com.br${foto}`) : null,
        leiloeiro: 'Mega Leilões', data_leilao: null, forma_pagamento: null,
      });
    }
    if (out.length === antes && !diag) {
      const deepHrefs = (html.match(reLote) || []).length;
      // Mira no card REAL (card open), pulando o cabeçalho do cards-container
      const ci = html.indexOf('card open');
      const cardSample = ci >= 0 ? html.slice(ci, ci + 2000).replace(/\s+/g, ' ') : html.slice(html.indexOf('cards-container'), html.indexOf('cards-container') + 2000).replace(/\s+/g, ' ');
      diag = { uf, http: r.status, via: r.via, deepHrefs, todosHrefs: [...new Set((html.match(/href="[^"]{8,90}"/gi) || []))].slice(0, 14), cardSample, ...htmlDiag(html) };
      await gravarDebug('MEGA', url, r.status, r.contentType, r.via, html);
    }
  }
  return { rows: out, via, diag };
}

// ─── MGL / CCJ (Cloudflare → Bright Data) — RECON ─────────────────────────────
// Ambos barram no Cloudflare via fetch comum; o Bright Data (Web Unlocker) fura.
// 1ª fase: baixa páginas candidatas e grava HTML + diagnóstico estrutural em
// debug_fetch, para escrever os parsers definitivos a partir do conteúdo REAL.
async function reconAlvo(fonte, urls, deadline) {
  const diag = [];
  for (const url of urls) {
    if (Date.now() > deadline) break;
    const r = await fetchVia(url);
    await gravarDebug(fonte, url, r.status, r.contentType, r.via, r.text);
    diag.push({ url: url.replace(/^https?:\/\/(www\.)?/, ''), http: r.status, via: r.via, ...htmlDiag(r.text) });
  }
  return { rows: [], via: diag[0]?.via || '-', diag };
}

// MGL Leilões (MG · SP · ES; judicial + extrajudicial Banco do Brasil)
async function coletarMGL(deadline) {
  return reconAlvo('MGL', [
    'https://www.mgl.com.br/',
    'https://www.mgl.com.br/categoria/imoveis',
    'https://www.mgl.com.br/lotes/imoveis',
  ], deadline);
}

// CCJ Leilões (bens em todos os estados; padrão /leilao/{id}/lotes)
async function coletarCCJ(deadline) {
  return reconAlvo('CCJ', [
    'https://www.ccjleiloes.com.br/',
    'https://www.ccjleiloes.com.br/lotes',
    'https://www.ccjleiloes.com.br/leilao/110/lotes',
  ], deadline);
}

// ─── LEILÕES JUDICIAIS (API só p/ fingerprint de navegador → Bright Data) ──────
// A API get-bens-por-estados entrega dados só ao fingerprint TLS de um Chrome
// real (Node fetch recebe 200 vazio). O Bright Data (Web Unlocker) tem esse
// fingerprint; enviamos os headers de XHR (Origin/Referer) que a API exige.
// É um PORTAL que agrega centenas de leiloeiros (cada lote traz o de origem).
async function coletarLJUD(paginas, deadline) {
  const out = []; let via = '-', diag = null;
  const API = 'https://api.leiloesjudiciais.com.br/core/api/get-bens-por-estados';
  const base = 'tipo=3&categoria=0&estado=&cidade=0&valor_min=0&valor_max=0&palavra_chave=&leilao_id=0&lote_id=0&ordenacao=null';
  const hdrs = { Accept: '*/*', Origin: 'https://www.leiloesjudiciais.com.br', Referer: 'https://www.leiloesjudiciais.com.br/' };
  let totalPages = paginas;
  for (let p = 1; p <= Math.min(totalPages, paginas); p++) {
    if (Date.now() > deadline) break;
    const url = `${API}?pg=${p}&qtd_por_pagina=12&${base}`;
    const bd = await fetchViaBrightData(url, { headers: hdrs });
    via = bd ? 'brightdata' : 'indisponivel';
    let data = null; try { data = JSON.parse(await bd.text()); } catch { /* */ }
    const items = data?.items || [];
    if (!items.length) {
      if (p === 1) { diag = { via, status: bd?.status || 0, totalItems: data?.totalItems ?? null }; await gravarDebug('LJUD', url, bd?.status || 0, 'application/json', via, JSON.stringify(data || {}).slice(0, 4000)); }
      break;
    }
    if (p === 1 && data.totalPages) totalPages = Math.min(paginas, Number(data.totalPages) || paginas);
    for (const it of items) {
      if (Number(it.statuslote_id) !== 1) continue;
      const titulo = String(it.nm_titulo_lote || it.nm_titulo_leilao || '').replace(/\s+/g, ' ').trim();
      const cidade = String(it.nm_cidade || '').trim();
      if (/simula|teste/i.test(titulo) || /teste/i.test(cidade)) continue;
      const vmin = parseNum(it.vl_lanceminimo || it.vl_ordenacao);
      if (!vmin) continue;
      const foto = it.fotos?.[0]?.nm_path_completo ? it.fotos[0].nm_path_completo.replace('/196x146/', '/640x480/') : null;
      const urlLeil = String(it.nm_url_leiloeiro || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
      out.push({
        fonte: 'LJUD', fonte_id: `ljud_${it.lote_id}`,
        titulo: (titulo || `Imóvel ${it.lote_id}`).slice(0, 180),
        tipo: normalizarTipo(it.nm_subcategoria || titulo),
        modalidade: /extrajudicial/i.test(it.nm_titulo_leilao || '') ? 'extrajudicial' : 'judicial',
        estado: String(it.nm_estado || '').toUpperCase().slice(0, 2), cidade,
        bairro: '', endereco: '', valor_avaliacao: 0, valor_minimo: vmin,
        area_m2: parseNum((titulo.match(/([\d.,]+)\s*m²/) || [])[1]),
        descricao: [titulo, it.nm_leiloeiro].filter(Boolean).join(' — ').slice(0, 500) || null,
        link_edital: urlLeil ? `https://${urlLeil}` : 'https://www.leiloesjudiciais.com.br',
        link_foto: foto, leiloeiro: String(it.nm_leiloeiro || 'Leilões Judiciais').slice(0, 120),
        data_leilao: null, forma_pagamento: null,
      });
    }
  }
  return { rows: out, via, diag };
}

async function upsert(rows) {
  let n = 0;
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const r = await sb('imoveis_leilao?on_conflict=fonte,fonte_id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(chunk.map(x => ({ ...x, ativo: true, atualizado_em: new Date().toISOString() }))),
    });
    if (r.ok) n += chunk.length; else console.error('upsert leiloeiro erro:', (await r.text()).slice(0, 200));
  }
  return n;
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST' && req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Supabase não configurado' });

  // Auth: CRON_SECRET (?secret=/header) ou JWT admin/analista
  if (!isCronAuthorized(req)) {
    const user = await getUser(req);
    if (!user) return res.status(401).json({ error: 'Não autenticado' });
    const role = await getUserRoleById(user.id);
    if (role !== 'admin' && role !== 'analista') return res.status(403).json({ error: 'Apenas admin/analista' });
  }

  const q = req.query || {};
  const fontes = String(q.fontes || 'sold,mega,superbid').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const soldPaginas = parseInt(q.sold_paginas || '3', 10);
  const sbidPaginas = parseInt(q.superbid_paginas || '6', 10);
  const megaUfs = String(q.mega_ufs || 'SP,RJ,MG,BA').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const runStart = new Date().toISOString();
  const deadline = Date.now() + 240000; // orçamento 240s (< maxDuration 300)
  const resultado = [];
  let totalUpsert = 0;

  for (const f of fontes) {
    if (Date.now() > deadline) { resultado.push({ fonte: f.toUpperCase(), pulado: 'deadline' }); continue; }
    let r;
    if (f === 'sold') r = await coletarSold(soldPaginas, deadline);
    else if (f === 'superbid') r = await coletarSuperbid(sbidPaginas, deadline);
    else if (f === 'mega') r = await coletarMega(megaUfs, deadline);
    else if (f === 'mgl') r = await coletarMGL(deadline);
    else if (f === 'ccj') r = await coletarCCJ(deadline);
    else if (f === 'ljud') r = await coletarLJUD(parseInt(q.ljud_paginas || '90', 10), deadline);
    else continue;

    const up = r.rows.length ? await upsert(r.rows) : 0;
    totalUpsert += up;

    // Sweep só se a coleta veio saudável (evita zerar a fonte por bloqueio pontual)
    if (r.rows.length >= 10) {
      await sb(`imoveis_leilao?fonte=eq.${f.toUpperCase()}&ativo=eq.true&atualizado_em=lt.${runStart}`, {
        method: 'DELETE', headers: { Prefer: 'return=minimal' },
      }).catch(() => {});
    }
    resultado.push({ fonte: f.toUpperCase(), via: r.via, coletados: r.rows.length, upsert: up, ...(r.diag ? { diagnostico: r.diag } : {}) });
  }

  const saida = { ok: true, brightDataDisponivel: brightDataDisponivel(), runStart, total_upsert: totalUpsert, fontes: resultado };
  // Loga cada fonte em SUA linha (evita truncamento do JSON grande ocultar fontes do fim)
  resultado.forEach(f => console.log('[leil]', f.fonte, JSON.stringify(f)));
  console.log('[scraper-leiloeiros]', JSON.stringify({ runStart, total_upsert: totalUpsert }));
  return res.status(200).json(saida);
}
