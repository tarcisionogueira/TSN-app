/**
 * POST/GET /api/scraper-leiloeiros
 * Scraper de leiloeiros (Sold, Mega, Superbid) via Bright Data (Web Unlocker).
 *
 * Por que aqui (e não no GitHub Actions): a Vercel tem as env do Bright Data
 * (BRIGHTDATA_API_TOKEN/ZONE) e o BD desbloqueia as fontes que barram IPs de
 * cloud (Sold/Mega/Superbid retornam 403 ao IP da Vercel/Actions). Assim o fluxo
 * é TESTÁVEL: dispara → confere o banco.
 *
 * Estratégia de fetch: tenta fetch direto (rápido) e, se a fonte bloquear (403)
 * ou falhar, cai para fetchViaBrightData (sob teto semanal — nunca estoura custo).
 *
 * Acesso: CRON_SECRET (cron/manual) ou JWT de admin/analista.
 * Query: ?fontes=sold,mega,superbid (default todas) · ?sold_paginas=3 · ?mega_ufs=SP,RJ,MG,BA
 * Resposta: { ok, runStart, fontes: [{fonte, via, coletados, http, amostra?}], upsert }
 *
 * Diagnóstico: se uma fonte retornar 0, inclui http/contentType e os 1ºs 300
 * caracteres da resposta — para corrigir o parser em 1 iteração.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { fetchViaBrightData, brightDataDisponivel } from './_brightdata.js';
import { getUser, getUserRoleById, isCronAuthorized } from './_auth.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_KEY;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
}

function sb(path, opts = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}

// fetch direto; se 403/erro → Bright Data (sob teto). Retorna sempre o texto bruto.
async function fetchVia(url, { accept = 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8', headers = {} } = {}) {
  const h = { 'User-Agent': UA, Accept: accept, 'Accept-Language': 'pt-BR,pt;q=0.9', ...headers };
  let resp = null;
  try { resp = await fetch(url, { headers: h, redirect: 'follow', signal: AbortSignal.timeout(20000) }); } catch { resp = null; }
  if (resp && resp.ok) {
    const text = await resp.text().catch(() => '');
    if (text) return { ok: true, status: resp.status, contentType: resp.headers.get('content-type') || '', via: 'direct', text };
  }
  // Fallback Bright Data (desbloqueia anti-bot)
  const bd = await fetchViaBrightData(url);
  if (bd) {
    const text = await bd.text().catch(() => '');
    if (text) return { ok: true, status: bd.status, contentType: bd.headers.get('content-type') || '', via: 'brightdata', text };
  }
  return { ok: false, status: resp?.status || 0, contentType: '', via: bd ? 'brightdata' : 'direct', text: '' };
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

// ─── SOLD (API JSON) ───────────────────────────────────────────────────────────
async function coletarSold(paginas) {
  const out = []; let via = '-', diag = null;
  for (let p = 1; p <= paginas; p++) {
    const url = `https://www.sold.com.br/api/v1/lots?category_ids=1&status=open&page=${p}&per_page=50&order=relevance`;
    const r = await fetchVia(url, { accept: 'application/json', headers: { Referer: 'https://www.sold.com.br/leiloes-de-imoveis', 'x-requested-with': 'XMLHttpRequest' } });
    via = r.via;
    let data = null; try { data = JSON.parse(r.text); } catch { /* não-JSON */ }
    const lots = data?.lots || data?.data || data?.results || data?.items || [];
    if (!lots.length) { if (p === 1) diag = { http: r.status, contentType: r.contentType, amostra: r.text.slice(0, 300) }; break; }
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
async function coletarSuperbid(paginas) {
  const out = []; let via = '-', diag = null;
  for (let p = 1; p <= paginas; p++) {
    const url = `https://offer-query.superbid.net/seo/offers/?locale=pt_BR&portalId=%5B2%2C15%5D&requestOrigin=marketplace&timeZoneId=America%2FSao_Paulo&orderBy=score%3Adesc&pageNumber=${p}&pageSize=50&searchType=opened&categoryId=imoveis`;
    const r = await fetchVia(url, { accept: 'application/json', headers: { Origin: 'https://www.superbid.net', Referer: 'https://www.superbid.net/categorias/imoveis' } });
    via = r.via;
    let data = null; try { data = JSON.parse(r.text); } catch { /* */ }
    const offers = data?.offers || data?.data?.offers || data?.result?.offers || data?.content || data?.items || data?.results || [];
    if (!offers.length) { if (p === 1) diag = { http: r.status, contentType: r.contentType, keys: data ? Object.keys(data).slice(0, 8) : null, amostra: r.text.slice(0, 300) }; break; }
    for (const of of offers) {
      const pr = of.product || {}; const loc = pr.location || {}; const det = of.offerDetail || {};
      const vmin = parseNum(det.initialBidValue || det.currentMinBid);
      if (!of.id || vmin <= 0) continue;
      const cidadeCompleta = loc.city || '';
      const estUF = (cidadeCompleta.match(/[-–]\s*([A-Z]{2})$/) || [])[1] || loc.state || '';
      out.push({
        fonte: 'SUPERBID', fonte_id: `sbid_${of.id}`,
        titulo: pr.shortDesc || `Imóvel ${cidadeCompleta}`,
        tipo: normalizarTipo(pr.subCategory?.description),
        modalidade: (of.auction?.subMarketplaces || []).some(s => s.desc === 'Judicial') ? 'judicial' : 'extrajudicial',
        estado: estUF, cidade: cidadeCompleta.replace(/\s*[-–]\s*[A-Z]{2}$/, '').trim(),
        bairro: loc.neighborhood || '', endereco: loc.street || '',
        valor_avaliacao: parseNum(det.referenceValue || det.directSaleValue),
        valor_minimo: vmin,
        area_m2: parseNum(((of.offerDescription || '').match(/(\d+[.,]?\d*)\s*m2/i) || [])[1]),
        descricao: (of.offerDescription || '').replace(/<[^>]+>/g, '').slice(0, 500) || null,
        link_edital: `https://www.superbid.net/lote/${of.id}`,
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
async function coletarMega(ufs) {
  const out = []; let via = '-', diag = null;
  for (const uf of ufs) {
    const url = `https://www.megaleiloes.com.br/imoveis?estado=${uf}`;
    const r = await fetchVia(url, { headers: { Referer: 'https://www.megaleiloes.com.br/' } });
    via = r.via;
    const html = r.text;
    const seen = new Set(); let antes = out.length;
    const cardRegex = /<(?:article|div)[^>]*class="[^"]*(?:product|lote|item|card)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
    let m;
    while ((m = cardRegex.exec(html)) !== null && (out.length - antes) < 60) {
      const card = m[1];
      const href = (card.match(/href="([^"]*(?:lote|imovel|produto)[^"]*)"/i) || [])[1] || '';
      if (!href || seen.has(href)) continue; seen.add(href);
      const valor = parseNum((card.match(/R\$\s*([\d.,]+)/) || [])[1]);
      if (!valor) continue;
      const titulo = ((card.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i) || [])[1] || '').replace(/<[^>]+>/g, '').trim();
      const aval = parseNum((card.match(/(?:avalia[çc][aã]o|avaliado)[^\d]*([\d.,]+)/i) || [])[1]);
      const foto = (card.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i) || [])[1] || null;
      const area = parseNum((card.match(/(\d+[.,]?\d*)\s*m[²2]/i) || [])[1]);
      const id = href.split('/').filter(Boolean).pop().split('?')[0];
      out.push({
        fonte: 'MEGA', fonte_id: `mega_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Mega Leilões ${uf}`,
        tipo: normalizarTipo(titulo),
        modalidade: titulo.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
        estado: uf, cidade: '', bairro: '', endereco: '',
        valor_avaliacao: aval, valor_minimo: valor, area_m2: area,
        descricao: titulo.slice(0, 300) || null,
        link_edital: href.startsWith('http') ? href : `https://www.megaleiloes.com.br${href}`,
        link_foto: foto ? (foto.startsWith('http') ? foto : `https://www.megaleiloes.com.br${foto}`) : null,
        leiloeiro: 'Mega Leilões', data_leilao: null, forma_pagamento: null,
      });
    }
    if (out.length === antes && !diag) diag = { uf, http: r.status, contentType: r.contentType, amostra: html.slice(0, 300) };
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

export default async function handler(req) {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (req.method !== 'POST' && req.method !== 'GET') return json({ error: 'Method not allowed' }, 405);
  if (!SERVICE_KEY) return json({ error: 'Supabase não configurado' }, 500);

  // Auth: CRON_SECRET ou admin/analista
  if (!isCronAuthorized(req)) {
    const user = await getUser(req);
    if (!user) return json({ error: 'Não autenticado' }, 401);
    const role = await getUserRoleById(user.id);
    if (role !== 'admin' && role !== 'analista') return json({ error: 'Apenas admin/analista' }, 403);
  }

  const url = new URL(req.url, 'http://localhost');
  const fontes = (url.searchParams.get('fontes') || 'sold,mega,superbid').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  const soldPaginas = parseInt(url.searchParams.get('sold_paginas') || '3', 10);
  const sbidPaginas = parseInt(url.searchParams.get('superbid_paginas') || '2', 10);
  const megaUfs = (url.searchParams.get('mega_ufs') || 'SP,RJ,MG,BA').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);

  const runStart = new Date().toISOString();
  const resultado = [];
  let totalUpsert = 0;

  for (const f of fontes) {
    let r;
    if (f === 'sold') r = await coletarSold(soldPaginas);
    else if (f === 'superbid') r = await coletarSuperbid(sbidPaginas);
    else if (f === 'mega') r = await coletarMega(megaUfs);
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
  console.log('[scraper-leiloeiros]', JSON.stringify(saida));
  return json(saida);
}
