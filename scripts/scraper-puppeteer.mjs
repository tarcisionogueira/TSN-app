/**
 * Scraper Puppeteer — Leiloeiros com proteção anti-bot
 * Fontes: Mega Leilões, Sold Leilões, Superbid, Banco do Brasil
 *
 * Estratégia: intercepta chamadas XHR/fetch do próprio site para capturar
 * as APIs internas JSON — mais robusto que scraping de HTML.
 */

import { createClient } from '@supabase/supabase-js';
import puppeteer from 'puppeteer';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const BROWSER_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--window-size=1280,900',
];

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── UTILS ───────────────────────────────────────────────────────────────────

function normalizarTipo(tipo) {
  if (!tipo) return 'imovel';
  const t = tipo.toLowerCase();
  if (t.includes('apart') || t.includes('apto')) return 'apartamento';
  if (t.includes('casa') || t.includes('resid')) return 'casa';
  if (t.includes('terreno') || t.includes('lote') || t.includes('area')) return 'terreno';
  if (t.includes('comerci') || t.includes('sala') || t.includes('loja') || t.includes('galpao') || t.includes('galpão')) return 'comercial';
  return 'imovel';
}

function toTitleCase(str) {
  if (!str) return '';
  return str.toLowerCase().replace(/(?:^|\s|-)(\S)/g, c => c.toUpperCase());
}

function parseBRL(str) {
  if (!str) return 0;
  if (typeof str === 'number') return str;
  return parseFloat(String(str).replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim()) || 0;
}

async function salvarImoveis(imoveis, fonte) {
  if (!imoveis.length) return;

  const rows = imoveis.map(im => ({
    ...im,
    ativo: true, // coletado agora ⇒ está ativo (reativa lotes que voltaram)
    viavel: im.valor_avaliacao > 0 ? (1 - im.valor_minimo / im.valor_avaliacao) >= 0.3 : null,
    score_viabilidade: im.valor_avaliacao > 0
      ? Math.min(100, Math.round((1 - im.valor_minimo / im.valor_avaliacao) * 150))
      : 30,
    desconto_percentual: im.valor_avaliacao > 0
      ? Math.round((1 - im.valor_minimo / im.valor_avaliacao) * 100)
      : null,
    atualizado_em: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from('imoveis_leilao')
    .upsert(rows, { onConflict: 'fonte_id', ignoreDuplicates: false });

  if (error) console.error(`  Erro ao salvar ${fonte}:`, error.message);
  else console.log(`  ✅ ${fonte}: ${rows.length} imóveis salvos`);
}

// Salva em lotes de 500 e desativa os obsoletos da fonte (lotes que saíram do
// ar). Trava de segurança: só desativa se a coleta foi saudável (>50), para um
// erro de rede não zerar o acervo. Retorna a quantidade coletada.
async function salvarEFinalizar(imoveis, fonte) {
  const runStart = new Date().toISOString();
  for (let i = 0; i < imoveis.length; i += 500) {
    await salvarImoveis(imoveis.slice(i, i + 500), `${fonte} ${i + 1}-${Math.min(i + 500, imoveis.length)}`);
  }
  if (imoveis.length > 50) {
    const { error, count } = await supabase
      .from('imoveis_leilao')
      .update({ ativo: false }, { count: 'exact' })
      .eq('fonte', fonte)
      .eq('ativo', true)
      .lt('atualizado_em', runStart);
    if (error) console.error(`  Erro ao desativar ${fonte} obsoletos:`, error.message);
    else console.log(`  🔻 ${fonte}: ${count ?? 0} lotes obsoletos desativados`);
  } else {
    console.log(`  ⚠️ ${fonte} coletou ${imoveis.length} (≤50) — pulando desativação por segurança`);
  }
  return imoveis.length;
}

// ─── INTERCEPTADOR DE REDE ────────────────────────────────────────────────────

async function capturarRespostasJSON(page, urlAlvo, { waitSelector, timeout = 20000 } = {}) {
  const respostas = [];

  page.on('response', async (response) => {
    const url = response.url();
    const contentType = response.headers()['content-type'] || '';
    if (!contentType.includes('json')) return;
    // Ignora recursos pequenos (tracking, analytics)
    try {
      const text = await response.text();
      if (text.length < 100) return;
      const data = JSON.parse(text);
      respostas.push({ url, data });
    } catch {}
  });

  await page.goto(urlAlvo, { waitUntil: 'networkidle2', timeout });

  if (waitSelector) {
    try { await page.waitForSelector(waitSelector, { timeout: 8000 }); } catch {}
  }

  // Aguarda mais um pouco para requests tardios
  await new Promise(r => setTimeout(r, 3600));

  return respostas;
}

// ─── MEGA LEILÕES ─────────────────────────────────────────────────────────────
// Estrutura validada contra HTML real (debug_fetch): a listagem é renderizada no
// servidor. Cada card é <div data-key="ID"><div class="card open">...; "open" =
// ATIVO (lotes encerrados não têm a classe "open"). Paginação: ?pagina=N (sem
// filtro de estado = varre TODOS os imóveis). Campos: .card-title (título +
// "X m²"), .card-price (1ª praça ≈ avaliação), .card-instance-value (valor por
// praça → menor = piso/lance mínimo), .card-locality[title]="Cidade, UF",
// .card-instance-title (Judicial/Extrajudicial), .card-status, datas de praça,
// categoria no path do href → tipo.

const MEGA_CAT_TIPO = {
  'apartamentos': 'apartamento',
  'casas': 'casa',
  'terrenos-e-lotes': 'terreno',
  'comerciais': 'comercial',
  'salas-comerciais': 'comercial',
  'lojas': 'comercial',
  'galpoes': 'comercial',
  'predios': 'comercial',
  'conjuntos-comerciais': 'comercial',
  'vagas-de-garagem': 'comercial',
  'hoteis': 'comercial',
  'imoveis-rurais': 'rural',
  'fazendas': 'rural',
  'sitios-e-chacaras': 'rural',
};

// Extrai os cards ATIVOS de uma página da listagem (executado no contexto do navegador)
async function coletarMegaPagina(page) {
  return await page.evaluate(() => {
    const norm = s => (s || '').replace(/\s+/g, ' ').trim();
    const toNum = s => {
      const m = (s || '').match(/(\d[\d.]*,\d{2})/);
      return m ? parseFloat(m[1].replace(/\./g, '').replace(',', '.')) : 0;
    };
    const parseData = txt => {
      const m = (txt || '').match(/(\d{2})\/(\d{2})\/(\d{4})(?:[^\d]*(\d{2}):(\d{2}))?/);
      if (!m) return null;
      return `${m[3]}-${m[2]}-${m[1]}T${m[4] || '00'}:${m[5] || '00'}:00-03:00`;
    };
    const out = [];
    document.querySelectorAll('div[data-key]').forEach(cont => {
      const card = cont.querySelector('.card');
      if (!card) return;
      // Somente ATIVOS: classe "open" e status sem "encerrad"
      if (!card.classList.contains('open')) return;
      const status = norm(card.querySelector('.card-status')?.textContent).toLowerCase();
      if (status.includes('encerrad') || status.includes('arrematad') || status.includes('vendido')) return;

      const a = card.querySelector('a.card-title') || card.querySelector('a.card-image') || card.querySelector('a[href]');
      const href = (a?.href || '').split('?')[0];
      if (!href) return;

      const valores = Array.from(card.querySelectorAll('.card-instance-value'))
        .map(el => toNum(el.textContent)).filter(v => v > 0);
      const cardPrice = toNum(card.querySelector('.card-price')?.textContent);
      if (cardPrice > 0) valores.push(cardPrice);

      // datas das praças → escolhe a próxima data futura (a que poderemos participar)
      const datas = Array.from(card.querySelectorAll('[class*="instance-date"]'))
        .map(el => parseData(el.textContent)).filter(Boolean).sort();
      const agora = new Date().toISOString();
      const dataLeilao = datas.find(d => d >= agora) || datas[0] || null;

      out.push({
        id: cont.getAttribute('data-key'),
        href,
        titulo: norm(card.querySelector('.card-title')?.textContent),
        numero: norm(card.querySelector('.card-number')?.textContent),
        localidade: card.querySelector('.card-locality')?.getAttribute('title')
          || norm(card.querySelector('.card-locality')?.textContent),
        instTitle: norm(card.querySelector('.card-instance-title')?.textContent),
        valores,
        dataLeilao,
        foto: card.querySelector('.card-image')?.getAttribute('data-bg')
          || card.querySelector('img')?.getAttribute('src') || null,
      });
    });
    return out;
  });
}

function mapearMega(c) {
  const valores = (c.valores || []).filter(v => v > 0);
  if (!valores.length) return null;
  const valAval = Math.max(...valores);   // 1ª praça ≈ avaliação
  const valMin = Math.min(...valores);    // última praça = piso/lance mínimo
  if (!valMin) return null;

  let cidade = '', estado = '';
  const loc = (c.localidade || '').match(/^(.*?),?\s*([A-Z]{2})\s*$/);
  if (loc) { cidade = loc[1].trim(); estado = loc[2]; }
  if (!estado) {
    const ufPath = (c.href.match(/\/imoveis\/[a-z-]+\/([a-z]{2})\//) || [])[1];
    if (ufPath) estado = ufPath.toUpperCase();
  }

  const categoria = (c.href.match(/\/imoveis\/([a-z-]+)\//) || [])[1] || '';
  const tipo = MEGA_CAT_TIPO[categoria] || normalizarTipo(c.titulo);
  const areaM = (c.titulo || '').match(/(\d+(?:[.,]\d+)?)\s*m[²2]/i);
  const area = areaM ? parseFloat(areaM[1].replace('.', '').replace(',', '.')) : 0;
  const modalidade = /judicial/i.test(c.instTitle) && !/extra/i.test(c.instTitle)
    ? 'judicial' : (/extra/i.test(c.instTitle) ? 'extrajudicial'
    : (/judicial/i.test(c.titulo) ? 'judicial' : 'extrajudicial'));

  return {
    fonte: 'MEGA',
    fonte_id: `mega_${c.id}`,
    titulo: (c.titulo || `Imóvel Mega ${estado}`).slice(0, 160),
    tipo,
    modalidade,
    estado,
    cidade: toTitleCase(cidade),
    bairro: '',
    endereco: '',
    valor_avaliacao: valAval,
    valor_minimo: valMin,
    area_m2: area || 0,
    descricao: [c.titulo, c.numero, c.instTitle].filter(Boolean).join(' — ').slice(0, 500),
    link_edital: c.href,
    link_foto: c.foto,
    leiloeiro: 'Mega Leilões',
    data_leilao: c.dataLeilao,
    forma_pagamento: 'a_vista',
  };
}

// Varre TODAS as páginas da listagem de imóveis do Mega (somente ativos).
async function scraperMegaLeiloes(browser) {
  console.log('  Mega Leilões — varrendo todas as páginas...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  const imoveis = [];
  const seen = new Set();
  const MAX_PAGINAS = 300; // trava de segurança (não-silenciosa)
  try {
    let p = 1;
    for (; p <= MAX_PAGINAS; p++) {
      const url = `https://www.megaleiloes.com.br/imoveis?pagina=${p}`;
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
        try { await page.waitForSelector('div[data-key] .card', { timeout: 8000 }); } catch {}
      } catch (e) {
        console.log(`    Mega p${p}: erro de navegação (${e.message.slice(0, 50)}) — parando`);
        break;
      }
      const cards = await coletarMegaPagina(page);
      if (!cards.length) { console.log(`    Mega p${p}: 0 cards — fim da paginação`); break; }

      let novos = 0;
      for (const c of cards) {
        if (!c.id || seen.has(c.id)) continue;
        seen.add(c.id);
        const im = mapearMega(c);
        if (im) { imoveis.push(im); novos++; }
      }
      console.log(`    Mega p${p}: ${cards.length} ativos (${novos} novos, acumulado ${imoveis.length})`);
      if (novos === 0) { console.log('    Mega: página sem novos — fim da paginação'); break; }
      await new Promise(r => setTimeout(r, 1000));
    }
    if (p > MAX_PAGINAS) console.log(`    ⚠️ Mega atingiu o limite de ${MAX_PAGINAS} páginas — pode haver mais imóveis`);
    console.log(`  Mega Leilões: ${imoveis.length} imóveis ativos coletados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro Mega Leilões: ${err.message.slice(0, 100)}`);
    return imoveis;
  } finally {
    await page.close();
  }
}

// ─── SOLD LEILÕES ─────────────────────────────────────────────────────────────

async function scraperSold(browser, pageNum = 1) {
  console.log(`  Sold Leilões página ${pageNum}...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  try {
    const url = pageNum === 1
      ? 'https://www.sold.com.br/leiloes-de-imoveis'
      : `https://www.sold.com.br/leiloes-de-imoveis?page=${pageNum}`;

    const respostas = await capturarRespostasJSON(page, url, {
      waitSelector: '[class*="lot"], [class*="card"], [class*="product"], article',
    });

    let lotes = [];
    for (const { url: apiUrl, data } of respostas) {
      const candidato = data?.lots || data?.data?.lots || data?.items || data?.results
        || data?.products || (Array.isArray(data) ? data : null);
      if (candidato?.length >= 2) {
        console.log(`    Sold p${pageNum}: API em ${apiUrl.slice(0, 80)} (${candidato.length} itens)`);
        lotes = candidato;
        break;
      }
    }

    if (!lotes.length) {
      lotes = await page.evaluate(() => {
        const items = [];
        const cards = document.querySelectorAll(
          '[class*="lot-card"], [class*="auction-card"], [class*="product-card"], article, [data-lot-id], [data-id]'
        );
        cards.forEach(card => {
          const link = card.querySelector('a[href]');
          const titulo = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="name"]');
          const valorEl = card.querySelector('[class*="price"],[class*="value"],[class*="lance"],[class*="bid"]');
          const imgEl = card.querySelector('img');
          const estadoEl = card.querySelector('[class*="state"],[class*="uf"],[class*="location"]');
          const valor = valorEl?.textContent || card.textContent.match(/R\$\s*[\d.,]+/)?.[0] || '';
          if (!valor) return;
          items.push({
            _dom: true,
            href: link?.href || '',
            titulo: titulo?.textContent?.trim() || '',
            valor: valor.trim(),
            foto: imgEl?.src || imgEl?.dataset?.src || null,
            estado: estadoEl?.textContent?.trim() || '',
          });
        });
        return items;
      });
      if (lotes.length) console.log(`    Sold p${pageNum}: DOM fallback — ${lotes.length} cards`);
    }

    if (!lotes.length) {
      console.log(`    Sold p${pageNum}: 0 imóveis`);
      return [];
    }

    const imoveis = lotes.map((lot, idx) => {
      if (lot._dom) {
        const valor = parseBRL(lot.valor);
        if (!valor) return null;
        const id = lot.href.split('/').filter(Boolean).pop()?.split('?')[0] || `${pageNum}_${idx}`;
        return {
          fonte: 'SOLD',
          fonte_id: `sold_${id}`,
          titulo: lot.titulo.slice(0, 120) || `Imóvel Sold`,
          tipo: normalizarTipo(lot.titulo),
          modalidade: lot.titulo.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
          estado: lot.estado.replace(/.*[-–]\s*/, '').trim().slice(0, 2).toUpperCase() || '',
          cidade: '',
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: valor,
          area_m2: 0,
          descricao: '',
          link_edital: lot.href || 'https://www.sold.com.br',
          link_foto: lot.foto,
          leiloeiro: 'Sold Leilões',
          data_leilao: null,
          forma_pagamento: 'a_vista',
        };
      }

      const id = lot.id || lot.lot_id || idx;
      const titulo = lot.title || lot.name || lot.description || '';
      const loc = lot.location || lot.address || {};
      const valMin = parseBRL(lot.minimum_bid || lot.initial_bid || lot.min_bid || lot.price || 0);
      const valAval = parseBRL(lot.appraisal_value || lot.evaluation || lot.appraisal || 0);
      if (!valMin) return null;

      return {
        fonte: 'SOLD',
        fonte_id: `sold_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Sold ${id}`,
        tipo: normalizarTipo(lot.category || lot.type || titulo),
        modalidade: lot.judicial ? 'judicial' : 'extrajudicial',
        estado: loc.state || lot.state || lot.uf || '',
        cidade: toTitleCase(loc.city || lot.city || lot.cidade || ''),
        bairro: toTitleCase(loc.neighborhood || lot.neighborhood || ''),
        endereco: toTitleCase(loc.street || lot.address_street || ''),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: parseFloat(lot.area || lot.useful_area || 0),
        descricao: (lot.description || titulo).replace(/<[^>]+>/g, '').slice(0, 500),
        link_edital: lot.url || lot.link || `https://www.sold.com.br/lote/${id}`,
        link_foto: lot.image || lot.thumbnail || lot.photo || null,
        leiloeiro: lot.auctioneer?.name || lot.company || 'Sold Leilões',
        data_leilao: lot.end_date || lot.auction_date || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    Sold p${pageNum}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Sold p${pageNum}: ${err.message.slice(0, 80)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── SUPERBID ─────────────────────────────────────────────────────────────────

// Rede Superbid: Superbid e Sold são a mesma infraestrutura (offer-query.
// superbid.net). portalId 2 = Superbid, 15 = Sold. Chama a API pública de
// offers direto do navegador: searchType=opened (só ativos), filtra imóveis,
// pagina de 100 em 100 até acabar. Genérico por portal/fonte.
async function scraperSuperbidNet(browser, { portalId, fonte, leiloeiro, prefix, baseSite }) {
  console.log(`  ${leiloeiro} — API offers (portal ${portalId}, somente abertos)...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  try {
    await page.goto(`${baseSite}/categorias/imoveis`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2500));

    const offers = await page.evaluate(async (portal) => {
      const FIELDS = 'id;linkURL;price;priceFormatted;endDate;endDateTime;offerStatus;store;product.shortDesc;product.location;product.productType;product.subCategory;product.thumbnailUrl;auction;offerDetail;offerDescription';
      const apiUrl = n => `https://offer-query.superbid.net/offers/?portalId=${portal}&locale=pt_BR&timeZoneId=America/Sao_Paulo&searchType=opened&filter=product.productType.description:imoveis;&pageNumber=${n}&pageSize=100&orderBy=endDate:asc&fieldList=${FIELDS}`;
      const all = [];
      for (let n = 1; n <= 100; n++) {
        let data;
        try {
          const r = await fetch(apiUrl(n), { headers: { Accept: 'application/json' } });
          if (!r.ok) break;
          data = await r.json();
        } catch { break; }
        const arr = data.offers || data.content || data.results || data.items || (Array.isArray(data) ? data : []);
        if (!arr || !arr.length) break;
        all.push(...arr);
        if (arr.length < 100) break;
      }
      return all;
    }, portalId);

    console.log(`    ${leiloeiro}: ${offers.length} offers abertas coletadas`);
    const seen = new Set();
    const str = v => (typeof v === 'string' ? v : (v == null ? '' : String(v?.description ?? v?.name ?? '')));
    const imoveis = offers.map(of => {
      const p = of.product || {};
      const loc = (p.location && typeof p.location === 'object') ? p.location : {};
      const locStr = typeof p.location === 'string' ? p.location : (loc.city || '');
      const det = of.offerDetail || {};
      const id = of.id || of.offerId;
      if (!id || seen.has(id)) return null;
      seen.add(id);

      const titulo = str(p.shortDesc) || str(of.title);
      const estadoMatch = (locStr || '').match(/[-–]\s*([A-Z]{2})\s*$/);
      const valMin = parseFloat(det.initialBidValue || det.currentMinBid || of.price || 0);
      const valAval = parseFloat(det.referenceValue || det.directSaleValue || 0);
      if (!valMin) return null;

      const sub = str(p.subCategory);
      const tipoRaw = (sub && !/im[oó]ve/i.test(sub)) ? sub : titulo;
      const linkURL = str(of.linkURL);
      const desc = str(of.offerDescription) || titulo;

      return {
        fonte,
        fonte_id: `${prefix}_${id}`,
        titulo: (titulo || `Imóvel ${leiloeiro}`).slice(0, 160),
        tipo: normalizarTipo(tipoRaw),
        modalidade: (of.auction?.subMarketplaces || []).some(s => /judicial/i.test(str(s))) ? 'judicial' : 'extrajudicial',
        estado: (estadoMatch?.[1] || loc.state || loc.uf || '').toString().toUpperCase().slice(0, 2),
        cidade: toTitleCase((locStr || '').replace(/\s*[-–]\s*[A-Z]{2}\s*$/, '').trim()),
        bairro: toTitleCase(str(loc.neighborhood)),
        endereco: toTitleCase(str(loc.street)),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: 0,
        descricao: desc.replace(/<[^>]+>/g, '').slice(0, 500),
        link_edital: linkURL.startsWith('http') ? linkURL : (linkURL ? `${baseSite}${linkURL}` : `${baseSite}/oferta/${id}`),
        link_foto: p.thumbnailUrl || null,
        leiloeiro,
        data_leilao: of.endDate || of.endDateTime || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    ${leiloeiro}: ${imoveis.length} imóveis mapeados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro ${leiloeiro}: ${err.message.slice(0, 100)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── BANCO DO BRASIL ──────────────────────────────────────────────────────────

async function scraperBancoBrasil(browser, pageNum = 1) {
  console.log(`  Banco do Brasil página ${pageNum}...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Referer': 'https://www.bb.com.br/',
  });

  try {
    // Portal de venda de imóveis do BB (licitacoes-e-leiloes.bb.com.br mudou de domínio)
    const base = 'https://www43.bb.com.br/portalbb/leiloes';
    const url = pageNum === 1 ? base : `${base}?pagina=${pageNum}`;

    const respostas = await capturarRespostasJSON(page, url, {
      waitSelector: '[class*="card"], [class*="lote"], [class*="produto"], article',
      timeout: 25000,
    });

    let lotes = [];
    for (const { url: apiUrl, data } of respostas) {
      const candidato = data?.lotes || data?.imoveis || data?.items || data?.data
        || data?.results || data?.content || (Array.isArray(data) ? data : null);
      if (candidato?.length >= 2) {
        console.log(`    BB p${pageNum}: API em ${apiUrl.slice(0, 80)} (${candidato.length} itens)`);
        lotes = candidato;
        break;
      }
    }

    if (!lotes.length) {
      lotes = await page.evaluate(() => {
        const items = [];
        const cards = document.querySelectorAll(
          '[class*="card"], [class*="lote"], [class*="produto"], [class*="imovel"], article, [data-id]'
        );
        cards.forEach(card => {
          const link = card.querySelector('a[href]');
          const titulo = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="titulo"],[class*="nome"]');
          const valorEl = card.querySelector('[class*="price"],[class*="valor"],[class*="preco"],[class*="lance"]');
          const imgEl = card.querySelector('img');
          const locEl = card.querySelector('[class*="local"],[class*="cidade"],[class*="uf"]');
          const valor = valorEl?.textContent || card.textContent.match(/R\$\s*[\d.,]+/)?.[0] || '';
          if (!valor) return;
          items.push({
            _dom: true,
            href: link?.href || '',
            titulo: titulo?.textContent?.trim() || '',
            valor: valor.trim(),
            foto: imgEl?.src || imgEl?.dataset?.src || null,
            local: locEl?.textContent?.trim() || '',
          });
        });
        return items;
      });
      if (lotes.length) console.log(`    BB p${pageNum}: DOM fallback — ${lotes.length} cards`);
    }

    if (!lotes.length) {
      console.log(`    BB p${pageNum}: 0 imóveis`);
      return [];
    }

    const imoveis = lotes.map((lot, idx) => {
      if (lot._dom) {
        const valor = parseBRL(lot.valor);
        if (!valor) return null;
        const id = lot.href.split('/').filter(Boolean).pop()?.split('?')[0] || `${pageNum}_${idx}`;
        return {
          fonte: 'BB',
          fonte_id: `bb_${id}`,
          titulo: lot.titulo.slice(0, 120) || `Imóvel BB`,
          tipo: normalizarTipo(lot.titulo),
          modalidade: 'extrajudicial',
          estado: lot.local.slice(-2).toUpperCase() || '',
          cidade: lot.local.replace(/[/-]\s*[A-Z]{2}$/, '').trim(),
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: valor,
          area_m2: 0,
          descricao: '',
          link_edital: lot.href || 'https://licitacoes-e-leiloes.bb.com.br',
          link_foto: lot.foto,
          leiloeiro: 'Banco do Brasil',
          data_leilao: null,
          forma_pagamento: 'a_vista',
        };
      }

      const id = lot.id || lot.codImovel || lot.codigo || idx;
      const tipo = lot.tipoImovel || lot.tipo || lot.descTipo || '';
      const valMin = parseBRL(lot.precoVenda || lot.valorVenda || lot.vlrVenda || lot.preco || lot.lance_inicial || 0);
      const valAval = parseBRL(lot.valorAvaliacao || lot.vlrAvaliacao || lot.avaliacao || 0);
      if (!valMin) return null;

      return {
        fonte: 'BB',
        fonte_id: `bb_${id}`,
        titulo: `${tipo || 'Imóvel'} — ${toTitleCase(lot.cidade || lot.municipio || '')} ${lot.uf || lot.estado || ''}`.trim(),
        tipo: normalizarTipo(tipo),
        modalidade: (lot.modalidade || '').toLowerCase().includes('leil') ? 'judicial' : 'extrajudicial',
        estado: lot.uf || lot.estado || '',
        cidade: toTitleCase(lot.cidade || lot.municipio || ''),
        bairro: toTitleCase(lot.bairro || ''),
        endereco: toTitleCase(lot.logradouro || lot.endereco || ''),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: parseFloat(lot.areaTotal || lot.area || 0),
        descricao: lot.descricao || lot.complemento || '',
        link_edital: lot.linkAcesso || lot.urlImovel || lot.link
          || `https://licitacoes-e-leiloes.bb.com.br/imovel/${id}`,
        link_foto: lot.foto || lot.urlFoto || lot.imagemPrincipal || null,
        leiloeiro: 'Banco do Brasil',
        data_leilao: lot.dataLeilao || lot.dtLeilao || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    BB p${pageNum}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro BB p${pageNum}: ${err.message.slice(0, 80)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── RELATÓRIO DE CAPTAÇÃO ────────────────────────────────────────────────────

// ─── PORTALZUK (ZUKERMAN) ─────────────────────────────────────────────────────
// Listagem server-rendered com SCROLL INFINITO (sem links de página). Card:
// .card-property → a[href*="/imovel/uf/cidade/..."] (title rico: tipo, endereço,
// cidade/UF, comitente), .card-property-price-lote (tipo), .card-property-address
// (cidade/UF), .card-property-news (ocupação), R$ no corpo (praças), img (foto).
async function scraperPortalZuk(browser) {
  console.log('  PortalZuk (Zukerman) — scroll infinito...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  try {
    await page.goto('https://www.portalzuk.com.br/leilao-de-imoveis', { waitUntil: 'networkidle2', timeout: 45000 });
    try { await page.waitForSelector('.card-property', { timeout: 10000 }); } catch {}

    // Rola até parar de carregar novos cards (cap de segurança)
    let prev = 0, estavel = 0;
    for (let i = 0; i < 250 && estavel < 4; i++) {
      const n = await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); return document.querySelectorAll('.card-property').length; });
      await new Promise(r => setTimeout(r, 1400));
      if (n <= prev) estavel++; else { estavel = 0; prev = n; }
    }

    const cards = await page.evaluate(() => {
      const norm = s => (s || '').replace(/\s+/g, ' ').trim();
      const out = [];
      document.querySelectorAll('.card-property').forEach(card => {
        const a = card.querySelector('a[href*="/imovel/"]');
        const href = (a?.href || '').split('?')[0];
        if (!href) return;
        const title = a?.getAttribute('title') || '';
        const tipo = norm(card.querySelector('.card-property-price-lote')?.textContent);
        const addr = norm(card.querySelector('.card-property-address')?.textContent);
        const ocup = norm(card.querySelector('.card-property-news')?.textContent);
        const img = card.querySelector('img')?.getAttribute('src') || null;
        const valores = (card.textContent.match(/R\$\s*[\d.]+,\d{2}/g) || []);
        out.push({ href, title, tipo, addr, ocup, img, valores });
      });
      return out;
    });

    console.log(`    PortalZuk: ${cards.length} cards`);
    const seen = new Set();
    const imoveis = cards.map(c => {
      const idm = c.href.match(/(\d+(?:-\d+)?)\/?$/);
      const id = idm ? idm[1] : c.href;
      if (seen.has(id)) return null;
      seen.add(id);
      const vals = c.valores.map(v => parseBRL(v)).filter(v => v > 0);
      const valAval = vals.length ? Math.max(...vals) : 0;
      const valMin = vals.length ? Math.min(...vals) : 0;
      if (!valMin) return null;
      const pm = c.href.match(/\/imovel\/([a-z]{2})\/([^/]+)\//i);
      const uf = (pm?.[1] || '').toUpperCase();
      const cidade = pm?.[2] ? toTitleCase(pm[2].replace(/-/g, ' ')) : '';
      const tipoRaw = c.tipo || c.title;
      const modalidade = /judicial/i.test(c.title) ? 'judicial' : 'extrajudicial';
      return {
        fonte: 'ZUK',
        fonte_id: `zuk_${id}`,
        titulo: (c.title || `Imóvel PortalZuk ${uf}`).slice(0, 180),
        tipo: normalizarTipo(tipoRaw),
        modalidade,
        estado: uf,
        cidade,
        bairro: '',
        endereco: '',
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: 0,
        descricao: [c.title, c.ocup].filter(Boolean).join(' — ').slice(0, 500),
        link_edital: c.href,
        link_foto: c.img,
        leiloeiro: 'Zukerman (PortalZuk)',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);
    console.log(`    PortalZuk: ${imoveis.length} imóveis mapeados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro PortalZuk: ${err.message.slice(0, 100)}`);
    return [];
  } finally {
    await page.close();
  }
}

// ─── SODRÉ SANTORO ────────────────────────────────────────────────────────────
// Nuxt SPA. Os lotes vêm de POST /api/search-lots (results[] com campos ricos:
// lot_title, lot_category, lot_description, bid_initial, lot_city/state,
// auction_status, datas, lot_is_judicial). Como não temos o body do POST,
// interceptamos a própria chamada do site e rolamos para paginar.
async function scraperSodre(browser) {
  console.log('  Sodré Santoro — interceptando /api/search-lots...');
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });
  const lotesMap = new Map();
  page.on('response', async (resp) => {
    if (!/\/api\/search-lots/.test(resp.url())) return;
    try {
      const j = await resp.json();
      (j?.results || []).forEach(r => {
        const id = String(r.lot_id || r.id || '');
        if (id) lotesMap.set(id, r);
      });
    } catch {}
  });
  try {
    await page.goto('https://www.sodresantoro.com.br/imoveis', { waitUntil: 'networkidle2', timeout: 45000 });
    await new Promise(r => setTimeout(r, 3000));
    let prev = 0, estavel = 0;
    for (let i = 0; i < 200 && estavel < 4; i++) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
      await new Promise(r => setTimeout(r, 1600));
      const n = lotesMap.size;
      if (n <= prev) estavel++; else { estavel = 0; prev = n; }
    }

    const parseData = (s) => {
      const m = (s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
      return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00-03:00` : null;
    };
    const lotes = [...lotesMap.values()];
    console.log(`    Sodré: ${lotes.length} lotes capturados`);
    const imoveis = lotes.map(r => {
      if ((r.auction_status || '').toLowerCase() !== 'aberto') return null; // só ativos
      const valMin = parseFloat(r.bid_initial || r.bid_actual || 0);
      if (!valMin) return null;
      const titulo = r.lot_title || r.lot_description?.slice(0, 120) || 'Imóvel Sodré';
      const ufMatch = (titulo.match(/-\s*([A-Za-z]{2})\s*$/) || [])[1];
      const uf = (ufMatch || '').toUpperCase();
      const area = parseFloat(r.lot_total_area || r.lot_useful_area || 0) || 0;
      return {
        fonte: 'SODRE',
        fonte_id: `sodre_${r.lot_id || r.id}`,
        titulo: String(titulo).slice(0, 180),
        tipo: normalizarTipo(r.lot_category || titulo),
        modalidade: r.lot_is_judicial ? 'judicial' : 'extrajudicial',
        estado: uf,
        cidade: toTitleCase(r.lot_city || ''),
        bairro: toTitleCase(r.lot_neighborhood || ''),
        endereco: toTitleCase(r.lot_street || ''),
        valor_avaliacao: 0,
        valor_minimo: valMin,
        area_m2: area,
        descricao: String(r.lot_description || titulo).replace(/\s+/g, ' ').slice(0, 500),
        link_edital: `https://www.sodresantoro.com.br/imoveis/lote/${r.lot_id || r.id}`,
        link_foto: r.lot_image || r.image || null,
        leiloeiro: 'Sodré Santoro',
        data_leilao: parseData(r.auction_date_init || r.auction_date_end),
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);
    console.log(`    Sodré: ${imoveis.length} imóveis mapeados`);
    return imoveis;
  } catch (err) {
    console.log(`  Erro Sodré: ${err.message.slice(0, 100)}`);
    return [];
  } finally {
    await page.close();
  }
}

async function relatorioCapitacao() {
  const { data } = await supabase
    .from('imoveis_leilao')
    .select('fonte')
    .eq('ativo', true);

  if (!data) return;

  const contagem = {};
  data.forEach(({ fonte }) => { contagem[fonte] = (contagem[fonte] || 0) + 1; });

  console.log('\n📊 Captação atual por leiloeiro:');
  Object.entries(contagem).sort((a, b) => b[1] - a[1]).forEach(([fonte, qtd]) => {
    console.log(`   ${fonte.padEnd(12)} ${qtd.toLocaleString('pt-BR')} imóveis`);
  });
  console.log();
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏠 Scraper Puppeteer — ${new Date().toISOString()}\n`);

  const browser = await puppeteer.launch({
    headless: true,
    args: BROWSER_ARGS,
  });

  let total = 0;

  try {
    // 1. Mega Leilões — varre TODAS as páginas (todos os estados), somente ativos
    console.log('📋 Mega Leilões...');
    {
      const runStart = new Date().toISOString();
      const imoveis = await scraperMegaLeiloes(browser);
      // salva em lotes de 500 para não estourar payload
      for (let i = 0; i < imoveis.length; i += 500) {
        await salvarImoveis(imoveis.slice(i, i + 500), `Mega ${i + 1}-${Math.min(i + 500, imoveis.length)}`);
      }
      total += imoveis.length;
      // Desativa lotes Mega que saíram do ar (encerrados) — só se a coleta foi
      // saudável (>50), para um erro de rede não zerar o acervo.
      if (imoveis.length > 50) {
        const { error, count } = await supabase
          .from('imoveis_leilao')
          .update({ ativo: false }, { count: 'exact' })
          .eq('fonte', 'MEGA')
          .eq('ativo', true)
          .lt('atualizado_em', runStart);
        if (error) console.error('  Erro ao desativar Mega encerrados:', error.message);
        else console.log(`  🔻 Mega: ${count ?? 0} lotes encerrados desativados`);
      } else {
        console.log('  ⚠️ Mega coletou ≤50 — pulando desativação por segurança');
      }
    }

    // 2. Superbid (portal 2) — API offers, todas as páginas, somente abertos
    console.log('\n📋 Superbid...');
    total += await salvarEFinalizar(
      await scraperSuperbidNet(browser, { portalId: '[2]', fonte: 'SUPERBID', leiloeiro: 'Superbid', prefix: 'sbid', baseSite: 'https://www.superbid.net' }),
      'SUPERBID');

    // 3. Sold (portal 15 — mesma rede Superbid) — API offers, somente abertos
    console.log('\n📋 Sold Leilões...');
    total += await salvarEFinalizar(
      await scraperSuperbidNet(browser, { portalId: '[15]', fonte: 'SOLD', leiloeiro: 'Sold Leilões', prefix: 'sold', baseSite: 'https://www.sold.com.br' }),
      'SOLD');

    // 4. PortalZuk (Zukerman) — listagem com scroll infinito, somente ativos
    console.log('\n📋 PortalZuk (Zukerman)...');
    total += await salvarEFinalizar(await scraperPortalZuk(browser), 'ZUK');

    // 5. Sodré Santoro — API search-lots interceptada, somente ativos
    console.log('\n📋 Sodré Santoro...');
    total += await salvarEFinalizar(await scraperSodre(browser), 'SODRE');

  } finally {
    await browser.close();
  }

  await relatorioCapitacao();
  console.log(`✅ Scraper Puppeteer concluído: ${total} imóveis processados\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
