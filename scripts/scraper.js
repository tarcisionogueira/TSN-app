#!/usr/bin/env node
/**
 * Scraper diário de leilões imobiliários
 * Fontes: CEF, Leilão Caixa API, OLX Leilões, leiloeiros judiciais
 * Roda via GitHub Actions todo dia às 6h BRT
 */

import { createClient } from '@supabase/supabase-js';
import https from 'https';
import http from 'http';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── UTILS ───────────────────────────────────────────────────────────────────

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'Cache-Control': 'no-cache',
        ...options.headers,
      },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchJson(res.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse error (status ${res.statusCode}): ${data.slice(0,100)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchHtml(url, options = {}) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        ...options.headers,
      },
      timeout: 20000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location, options).then(resolve).catch(reject);
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

async function avaliarViabilidade(imovel) {
  const desconto = imovel.valorAvaliacao > 0
    ? ((1 - imovel.valorMinimo / imovel.valorAvaliacao) * 100).toFixed(1)
    : 0;

  if (desconto >= 40) return { viavel: true, score: 90, motivo: `Desconto de ${desconto}% sobre avaliação` };
  if (desconto >= 30) return { viavel: true, score: 70, motivo: `Desconto de ${desconto}% — avaliar custos` };
  if (desconto >= 20) return { viavel: null, score: 50, motivo: `Desconto de ${desconto}% — análise necessária` };
  if (desconto > 0)   return { viavel: false, score: 20, motivo: `Desconto insuficiente (${desconto}%)` };
  return { viavel: null, score: 30, motivo: 'Sem valor de avaliação para comparar' };
}

// ─── SCRAPER CEF (API oficial) ────────────────────────────────────────────────

async function scraperCEF(estado) {
  console.log(`  CEF ${estado}...`);
  try {
    // URL atual da API da Caixa (formato de busca)
    const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${estado}.json`;
    const data = await fetchJson(url);
    const imoveis = Array.isArray(data) ? data : (data?.listaImoveis || data?.imoveis || []);

    if (imoveis.length === 0) {
      console.log(`    CEF ${estado}: nenhum imóvel retornado`);
      return [];
    }

    return imoveis.slice(0, 50).map(im => ({
      fonte: 'CEF',
      fonte_id: `cef_${im.numeroCEF || im.numeroiep || im.idImovel || im.nrImovel}`,
      titulo: `${im.tipoImovel || 'Imóvel'} — ${im.bairro || ''} ${im.cidade || ''} ${estado}`.trim(),
      tipo: normalizarTipo(im.tipoImovel),
      modalidade: 'extrajudicial',
      estado,
      cidade: im.cidade || '',
      bairro: im.bairro || '',
      endereco: `${im.logradouro || ''} ${im.numero || ''}`.trim(),
      valor_avaliacao: parseMoeda(im.valorAvaliacao),
      valor_minimo: parseMoeda(im.valorMinimo || im.valorVenda),
      area_m2: parseFloat(im.areaTotal || im.area || 0),
      descricao: im.descricao || '',
      link_edital: im.linkEdital || `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${im.numeroCEF}`,
      link_foto: im.foto || im.urlFoto || null,
      leiloeiro: 'Caixa Econômica Federal',
      data_leilao: im.dataLeilao1 || im.dataLeilao || null,
      forma_pagamento: normalizarPagamento(im.modalidadeVenda),
      raw: JSON.stringify(im).slice(0, 500),
    })).filter(im => im.valor_minimo > 0 && im.fonte_id !== 'cef_undefined');
  } catch (err) {
    console.log(`    Erro CEF ${estado}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER LEILÃO CAIXA (site alternativo) ──────────────────────────────────

async function scraperLeilaoCaixa(estado) {
  console.log(`  LeilaoCaixa ${estado}...`);
  try {
    const url = `https://www.leilaocaixa.com.br/imoveis?estado=${estado}&page=1`;
    const html = await fetchHtml(url);
    const imoveis = [];

    // Tenta extrair __NEXT_DATA__ ou JSON embutido
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (match) {
      const nd = JSON.parse(match[1]);
      const items = nd?.props?.pageProps?.imoveis || nd?.props?.pageProps?.items || [];
      for (const im of items.slice(0, 30)) {
        imoveis.push({
          fonte: 'CEF',
          fonte_id: `lc_${im.id || im.nrImovel || im.codigo}`,
          titulo: im.titulo || im.title || `Imóvel ${estado}`,
          tipo: normalizarTipo(im.tipo || im.type),
          modalidade: 'extrajudicial',
          estado,
          cidade: im.cidade || im.city || '',
          bairro: im.bairro || '',
          endereco: im.endereco || im.address || '',
          valor_avaliacao: parseFloat(im.valorAvaliacao || im.avaliacao || 0),
          valor_minimo: parseFloat(im.valorMinimo || im.preco || im.valor || 0),
          area_m2: parseFloat(im.area || 0),
          descricao: im.descricao || '',
          link_edital: im.link || im.url || '',
          link_foto: im.foto || im.imagem || null,
          leiloeiro: 'Caixa Econômica Federal',
          data_leilao: im.dataLeilao || null,
          forma_pagamento: normalizarPagamento(im.modalidade),
          raw: JSON.stringify(im).slice(0, 500),
        });
      }
    }
    return imoveis.filter(im => im.valor_minimo > 0);
  } catch (err) {
    console.log(`    Erro LeilaoCaixa ${estado}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER RESALE (portal de leilões) ──────────────────────────────────────

async function scraperResale(estado) {
  console.log(`  Resale ${estado}...`);
  try {
    const url = `https://www.resale.com.br/busca?tipo=imovel&uf=${estado}&page=1`;
    const html = await fetchHtml(url);
    const imoveis = [];

    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (match) {
      const nd = JSON.parse(match[1]);
      const items = nd?.props?.pageProps?.listings
        || nd?.props?.pageProps?.results
        || nd?.props?.pageProps?.imoveis
        || [];
      for (const im of items.slice(0, 30)) {
        const valorMin = parseFloat(im.auction_value || im.starting_bid || im.minimum_bid || im.valor || 0);
        if (valorMin <= 0) continue;
        imoveis.push({
          fonte: 'SOLD',
          fonte_id: `resale_${im.id || im.slug}`,
          titulo: im.title || im.titulo || `Imóvel ${estado}`,
          tipo: normalizarTipo(im.type || im.tipo || im.category),
          modalidade: (im.origin || im.tipo_leilao || '').toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
          estado,
          cidade: im.city || im.cidade || '',
          bairro: im.neighborhood || im.bairro || '',
          endereco: im.address || im.endereco || '',
          valor_avaliacao: parseFloat(im.appraisal || im.valor_avaliacao || 0),
          valor_minimo: valorMin,
          area_m2: parseFloat(im.area || im.area_m2 || 0),
          descricao: im.description || im.descricao || '',
          link_edital: im.url || im.link || `https://www.resale.com.br/imovel/${im.slug || im.id}`,
          link_foto: im.main_image || im.thumbnail || null,
          leiloeiro: im.auctioneer || 'Resale',
          data_leilao: im.auction_date || im.data_leilao || null,
          forma_pagamento: 'a_vista',
          raw: JSON.stringify(im).slice(0, 500),
        });
      }
    }
    return imoveis;
  } catch (err) {
    console.log(`    Erro Resale ${estado}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER LANCE CERTO ─────────────────────────────────────────────────────

async function scraperLanceCerto(estado) {
  console.log(`  LanceCerto ${estado}...`);
  try {
    const url = `https://www.lancecerto.com.br/imoveis?estado=${estado}`;
    const html = await fetchHtml(url);
    const imoveis = [];

    // Extrai cards de imóveis pelo padrão JSON-LD ou __NEXT_DATA__
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (match) {
      const nd = JSON.parse(match[1]);
      const items = nd?.props?.pageProps?.lots || nd?.props?.pageProps?.items || [];
      for (const im of items.slice(0, 20)) {
        const valorMin = parseFloat(im.lance_inicial || im.starting_bid || im.valor_minimo || 0);
        if (valorMin <= 0) continue;
        imoveis.push({
          fonte: 'JUDICIAL',
          fonte_id: `lc2_${im.id || im.codigo}`,
          titulo: im.titulo || im.title || `Imóvel ${estado}`,
          tipo: normalizarTipo(im.tipo || im.type),
          modalidade: 'judicial',
          estado,
          cidade: im.cidade || im.city || '',
          bairro: im.bairro || '',
          endereco: im.endereco || '',
          valor_avaliacao: parseFloat(im.valor_avaliacao || im.appraisal || 0),
          valor_minimo: valorMin,
          area_m2: parseFloat(im.area || 0),
          descricao: im.descricao || '',
          link_edital: `https://www.lancecerto.com.br/lote/${im.slug || im.id}`,
          link_foto: im.foto || im.image || null,
          leiloeiro: im.leiloeiro || 'Lance Certo',
          data_leilao: im.data_leilao || null,
          forma_pagamento: 'a_vista',
          raw: JSON.stringify(im).slice(0, 500),
        });
      }
    }
    return imoveis;
  } catch (err) {
    console.log(`    Erro LanceCerto ${estado}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER ZUKERMAN (judicial SP) ──────────────────────────────────────────

async function scraperZukerman() {
  console.log(`  Zukerman Leilões...`);
  try {
    const html = await fetchHtml('https://www.zukerman.com.br/imoveis');
    const imoveis = [];
    const cardRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let match;
    while ((match = cardRegex.exec(html)) !== null && imoveis.length < 20) {
      const card = match[1];
      const titulo = card.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
      const valor = card.match(/R\$\s*([\d.,]+)/)?.[1]?.replace(/\./g,'')?.replace(',','.') || '0';
      const link = card.match(/href="([^"]+)"/)?.[1] || '';
      if (titulo && parseFloat(valor) > 0) {
        imoveis.push({
          fonte: 'JUDICIAL',
          fonte_id: `zuk_${link.split('/').pop() || Math.random().toString(36).slice(2)}`,
          titulo,
          tipo: normalizarTipo(titulo),
          modalidade: 'judicial',
          estado: 'SP',
          cidade: '',
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: parseFloat(valor) || 0,
          area_m2: 0,
          descricao: '',
          link_edital: link.startsWith('http') ? link : `https://www.zukerman.com.br${link}`,
          link_foto: card.match(/<img[^>]*src="([^"]+)"/i)?.[1] || null,
          leiloeiro: 'Zukerman Leilões',
          data_leilao: null,
          forma_pagamento: 'a_vista',
          raw: card.slice(0, 300),
        });
      }
    }
    console.log(`    Zukerman: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Zukerman: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── NORMALIZADORES ──────────────────────────────────────────────────────────

function normalizarTipo(tipo) {
  if (!tipo) return 'imovel';
  const t = tipo.toLowerCase();
  if (t.includes('apart') || t.includes('apto')) return 'apartamento';
  if (t.includes('casa') || t.includes('resid')) return 'casa';
  if (t.includes('terreno') || t.includes('lote') || t.includes('area')) return 'terreno';
  if (t.includes('comerci') || t.includes('sala') || t.includes('loja') || t.includes('galpao') || t.includes('galpão')) return 'comercial';
  return 'imovel';
}

function normalizarPagamento(modalidade) {
  if (!modalidade) return 'a_vista';
  const m = modalidade.toLowerCase();
  if (m.includes('financ') || m.includes('fgts')) return 'financiado';
  if (m.includes('parcel')) return 'parcelado';
  return 'a_vista';
}

function parseMoeda(valor) {
  if (!valor) return 0;
  if (typeof valor === 'number') return valor;
  return parseFloat(String(valor).replace(/[^\d,]/g,'').replace(',','.')) || 0;
}

// ─── SALVAR NO SUPABASE ───────────────────────────────────────────────────────

async function salvarImoveis(imoveis) {
  if (imoveis.length === 0) return;

  const comViabilidade = await Promise.all(imoveis.map(async (im) => {
    const v = await avaliarViabilidade({ valorMinimo: im.valor_minimo, valorAvaliacao: im.valor_avaliacao });
    return {
      ...im,
      viavel: v.viavel,
      score_viabilidade: v.score,
      motivo_viabilidade: v.motivo,
      desconto_percentual: im.valor_avaliacao > 0
        ? Math.round((1 - im.valor_minimo / im.valor_avaliacao) * 100)
        : null,
      atualizado_em: new Date().toISOString(),
    };
  }));

  const { error } = await supabase
    .from('imoveis_leilao')
    .upsert(comViabilidade, { onConflict: 'fonte_id', ignoreDuplicates: false });

  if (error) console.error('Erro ao salvar:', error.message);
  else console.log(`    ✅ ${comViabilidade.length} imóveis salvos`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏠 TSN Scraper iniciado em ${new Date().toISOString()}\n`);

  let total = 0;

  // 1. CEF
  console.log('📋 Scraping CEF...');
  for (const estado of ['SP','RJ','MG','BA','PR','RS','PE','CE','GO','SC']) {
    const imoveis = await scraperCEF(estado);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 1000));
  }

  // 2. Leilão Caixa (site alternativo)
  console.log('\n📋 Scraping Leilão Caixa...');
  for (const estado of ['SP','RJ','MG','PR']) {
    const imoveis = await scraperLeilaoCaixa(estado);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 3. Resale
  console.log('\n📋 Scraping Resale...');
  for (const estado of ['SP','RJ','MG','PR','RS']) {
    const imoveis = await scraperResale(estado);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 4. Lance Certo
  console.log('\n📋 Scraping Lance Certo...');
  for (const estado of ['SP','RJ','MG']) {
    const imoveis = await scraperLanceCerto(estado);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 5. Zukerman (judicial SP)
  console.log('\n📋 Scraping leiloeiros judiciais...');
  const zuk = await scraperZukerman();
  await salvarImoveis(zuk);
  total += zuk.length;

  // Marca imóveis antigos como expirados (não vistos há 7 dias)
  const seteDiasAtras = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('imoveis_leilao')
    .update({ ativo: false })
    .lt('atualizado_em', seteDiasAtras)
    .eq('ativo', true);

  console.log(`\n✅ Scraping concluído. ${total} imóveis processados.\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
