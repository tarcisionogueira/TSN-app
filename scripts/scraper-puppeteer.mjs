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

async function scraperMegaLeiloes(browser, uf) {
  console.log(`  Mega Leilões ${uf}...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'pt-BR,pt;q=0.9' });

  try {
    const respostas = await capturarRespostasJSON(
      page,
      `https://www.megaleiloes.com.br/imoveis/${uf}`,
      { waitSelector: '[class*="product"], [class*="card"], [class*="lote"], [class*="item"]' }
    );

    // Procura resposta com lista de imóveis
    let lotes = [];
    for (const { url, data } of respostas) {
      const candidato = data?.data || data?.items || data?.lots || data?.products
        || data?.results || data?.imoveis || (Array.isArray(data) ? data : null);
      if (candidato?.length >= 2) {
        console.log(`    Mega ${uf}: API encontrada em ${url.slice(0, 80)} (${candidato.length} itens)`);
        lotes = candidato;
        break;
      }
    }

    // Fallback: extrai do DOM
    if (!lotes.length) {
      lotes = await page.evaluate(() => {
        const items = [];
        const cards = document.querySelectorAll(
          '[class*="product-item"], [class*="card-lote"], [class*="lote-item"], article, [data-id]'
        );
        cards.forEach(card => {
          const link = card.querySelector('a[href]');
          const titulo = card.querySelector('h1,h2,h3,h4,[class*="title"],[class*="nome"]');
          const valorEl = card.querySelector('[class*="price"],[class*="valor"],[class*="lance"]');
          const imgEl = card.querySelector('img,[class*="image"]');
          const valor = valorEl?.textContent || card.textContent.match(/R\$\s*[\d.,]+/)?.[0] || '';
          if (!valor) return;
          items.push({
            _dom: true,
            href: link?.href || '',
            titulo: titulo?.textContent?.trim() || '',
            valor: valor.trim(),
            foto: imgEl?.src || imgEl?.dataset?.src || null,
          });
        });
        return items;
      });
      if (lotes.length) console.log(`    Mega ${uf}: DOM fallback — ${lotes.length} cards`);
    }

    if (!lotes.length) {
      console.log(`    Mega ${uf}: 0 imóveis`);
      return [];
    }

    const imoveis = lotes.map((lot, idx) => {
      if (lot._dom) {
        const valor = parseBRL(lot.valor);
        if (!valor) return null;
        const id = lot.href.split('/').filter(Boolean).pop()?.split('?')[0] || `${uf}_${idx}`;
        return {
          fonte: 'MEGA',
          fonte_id: `mega_${id}`,
          titulo: lot.titulo.slice(0, 120) || `Imóvel Mega ${uf}`,
          tipo: normalizarTipo(lot.titulo),
          modalidade: lot.titulo.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
          estado: uf,
          cidade: '',
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: valor,
          area_m2: 0,
          descricao: '',
          link_edital: lot.href || `https://www.megaleiloes.com.br`,
          link_foto: lot.foto,
          leiloeiro: 'Mega Leilões',
          data_leilao: null,
          forma_pagamento: 'a_vista',
        };
      }

      // Mapeamento API JSON
      const id = lot.id || lot.lot_id || lot.codigo || idx;
      const titulo = lot.title || lot.titulo || lot.name || lot.nome || lot.descricao || '';
      const cidade = lot.city || lot.cidade || lot.municipio || '';
      const estado = lot.state || lot.uf || lot.estado || uf;
      const valMin = parseBRL(lot.min_bid || lot.lance_inicial || lot.valor_minimo || lot.price || lot.preco || 0);
      const valAval = parseBRL(lot.appraisal || lot.valor_avaliacao || lot.avaliacao || 0);
      if (!valMin) return null;

      return {
        fonte: 'MEGA',
        fonte_id: `mega_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Mega ${uf}`,
        tipo: normalizarTipo(lot.type || lot.tipo || titulo),
        modalidade: (lot.judicial || titulo.toLowerCase().includes('judicial')) ? 'judicial' : 'extrajudicial',
        estado: String(estado).toUpperCase().slice(0, 2) || uf,
        cidade: toTitleCase(cidade),
        bairro: toTitleCase(lot.neighborhood || lot.bairro || ''),
        endereco: toTitleCase(lot.address || lot.endereco || ''),
        valor_avaliacao: valAval,
        valor_minimo: valMin,
        area_m2: parseFloat(lot.area || lot.area_m2 || lot.metragem || 0),
        descricao: (lot.description || lot.descricao || titulo).slice(0, 500),
        link_edital: lot.url || lot.link || `https://www.megaleiloes.com.br/lote/${id}`,
        link_foto: lot.image || lot.thumbnail || lot.foto || lot.image_url || null,
        leiloeiro: lot.auctioneer || lot.leiloeiro || 'Mega Leilões',
        data_leilao: lot.end_date || lot.data_leilao || lot.data_fim || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    Mega ${uf}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Mega ${uf}: ${err.message.slice(0, 80)}`);
    return [];
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

async function scraperSuperbid(browser, pageNum = 1) {
  console.log(`  Superbid página ${pageNum}...`);
  const page = await browser.newPage();
  await page.setUserAgent(USER_AGENT);
  await page.setExtraHTTPHeaders({
    'Accept-Language': 'pt-BR,pt;q=0.9',
    'Origin': 'https://www.superbid.net',
    'Referer': 'https://www.superbid.net/categorias/imoveis',
  });

  try {
    const url = `https://www.superbid.net/categorias/imoveis?page=${pageNum}`;
    const respostas = await capturarRespostasJSON(page, url, {
      waitSelector: '[class*="card"], [class*="product"], [class*="offer"]',
      timeout: 25000,
    });

    let offers = [];
    for (const { url: apiUrl, data } of respostas) {
      const candidato = data?.offers || data?.data?.offers || data?.items
        || data?.results || data?.content || (Array.isArray(data) ? data : null);
      if (candidato?.length >= 2) {
        console.log(`    Superbid p${pageNum}: API em ${apiUrl.slice(0, 80)} (${candidato.length} itens)`);
        offers = candidato;
        break;
      }
    }

    if (!offers.length) {
      offers = await page.evaluate(() => {
        const items = [];
        const cards = document.querySelectorAll('[class*="card"], [class*="product"], [data-offer-id], article');
        cards.forEach(card => {
          const link = card.querySelector('a[href]');
          const titulo = card.querySelector('h1,h2,h3,[class*="title"],[class*="name"]');
          const valorEl = card.querySelector('[class*="price"],[class*="value"],[class*="bid"]');
          const imgEl = card.querySelector('img');
          const locEl = card.querySelector('[class*="location"],[class*="city"],[class*="state"]');
          const valor = valorEl?.textContent || card.textContent.match(/R\$\s*[\d.,]+/)?.[0] || '';
          if (!valor) return;
          items.push({
            _dom: true,
            href: link?.href || '',
            titulo: titulo?.textContent?.trim() || '',
            valor: valor.trim(),
            foto: imgEl?.src || null,
            local: locEl?.textContent?.trim() || '',
          });
        });
        return items;
      });
      if (offers.length) console.log(`    Superbid p${pageNum}: DOM fallback — ${offers.length} cards`);
    }

    if (!offers.length) {
      console.log(`    Superbid p${pageNum}: 0 imóveis`);
      return [];
    }

    const imoveis = offers.map((of, idx) => {
      if (of._dom) {
        const valor = parseBRL(of.valor);
        if (!valor) return null;
        const id = of.href.split('/').filter(Boolean).pop()?.split('?')[0] || `${pageNum}_${idx}`;
        const estadoMatch = of.local.match(/[-–]\s*([A-Z]{2})$/);
        return {
          fonte: 'SUPERBID',
          fonte_id: `sbid_${id}`,
          titulo: of.titulo.slice(0, 120) || 'Imóvel Superbid',
          tipo: normalizarTipo(of.titulo),
          modalidade: 'extrajudicial',
          estado: estadoMatch?.[1] || '',
          cidade: of.local.replace(/\s*[-–]\s*[A-Z]{2}$/, '').trim(),
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: valor,
          area_m2: 0,
          descricao: '',
          link_edital: of.href || 'https://www.superbid.net',
          link_foto: of.foto,
          leiloeiro: 'Superbid',
          data_leilao: null,
          forma_pagamento: 'a_vista',
        };
      }

      const p = of.product || {};
      const loc = p.location || of.location || {};
      const det = of.offerDetail || of.detail || {};
      const id = of.id || of.offerId || idx;
      const titulo = p.shortDesc || p.description || of.title || of.name || '';
      const cidadeCompleta = loc.city || of.city || '';
      const estadoMatch = cidadeCompleta.match(/[-–]\s*([A-Z]{2})$/);

      const valMin = parseFloat(det.initialBidValue || det.currentMinBid || of.initialBidValue || of.minBid || of.price || 0);
      if (!valMin) return null;

      return {
        fonte: 'SUPERBID',
        fonte_id: `sbid_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Superbid`,
        tipo: normalizarTipo(p.subCategory?.description || of.category),
        modalidade: (of.auction?.subMarketplaces || []).some(s => s.desc === 'Judicial') ? 'judicial' : 'extrajudicial',
        estado: estadoMatch?.[1] || loc.state || '',
        cidade: cidadeCompleta.replace(/\s*[-–]\s*[A-Z]{2}$/, '').trim(),
        bairro: loc.neighborhood || '',
        endereco: loc.street || '',
        valor_avaliacao: parseFloat(det.referenceValue || det.directSaleValue || of.referenceValue || 0),
        valor_minimo: valMin,
        area_m2: 0,
        descricao: (of.offerDescription || '').replace(/<[^>]+>/g, '').slice(0, 500),
        link_edital: `https://www.superbid.net/lote/${id}`,
        link_foto: p.thumbnailUrl || of.image || null,
        leiloeiro: of.store?.name || of.seller?.name || 'Superbid',
        data_leilao: of.endDate || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(Boolean);

    console.log(`    Superbid p${pageNum}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Superbid p${pageNum}: ${err.message.slice(0, 80)}`);
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
    // 1. Mega Leilões — 10 UFs principais
    console.log('📋 Mega Leilões...');
    const ufsMega = ['SP', 'RJ', 'MG', 'PR', 'RS', 'SC', 'GO', 'DF', 'BA', 'PE'];
    for (const uf of ufsMega) {
      const imoveis = await scraperMegaLeiloes(browser, uf);
      await salvarImoveis(imoveis, `Mega ${uf}`);
      total += imoveis.length;
      await new Promise(r => setTimeout(r, 2400));
    }

    // 2. Sold Leilões — até 5 páginas
    console.log('\n📋 Sold Leilões...');
    for (let page = 1; page <= 5; page++) {
      const imoveis = await scraperSold(browser, page);
      await salvarImoveis(imoveis, `Sold p${page}`);
      total += imoveis.length;
      if (imoveis.length === 0) break;
      await new Promise(r => setTimeout(r, 2400));
    }

    // 3. Superbid via browser — até 6 páginas
    console.log('\n📋 Superbid...');
    for (let page = 1; page <= 6; page++) {
      const imoveis = await scraperSuperbid(browser, page);
      await salvarImoveis(imoveis, `Superbid p${page}`);
      total += imoveis.length;
      if (imoveis.length === 0) break;
      await new Promise(r => setTimeout(r, 2400));
    }

    // 4. Banco do Brasil — até 4 páginas
    console.log('\n📋 Banco do Brasil...');
    for (let page = 1; page <= 4; page++) {
      const imoveis = await scraperBancoBrasil(browser, page);
      await salvarImoveis(imoveis, `BB p${page}`);
      total += imoveis.length;
      if (imoveis.length === 0) break;
      await new Promise(r => setTimeout(r, 2400));
    }

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
