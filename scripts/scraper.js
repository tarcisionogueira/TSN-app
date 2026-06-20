#!/usr/bin/env node
/**
 * Scraper diário de leilões imobiliários
 * Fontes: CEF, Leilão Caixa API, OLX Leilões, leiloeiros judiciais
 * Roda via GitHub Actions todo dia às 6h BRT
 */

import { createClient } from '@supabase/supabase-js';
import https from 'https';
import http from 'http';
import { Buffer } from 'buffer';

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

// ─── SCRAPER CEF CSV ─────────────────────────────────────────────────────────

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/csv,text/plain,*/*',
        'Accept-Language': 'pt-BR,pt;q=0.9',
      },
      timeout: 30000,
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBuffer(res.headers.location).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), status: res.statusCode }));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function parseBRNumber(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/R\$\s*/g,'').replace(/\./g,'').replace(',','.').trim()) || 0;
}

function parseCSVCaixa(buffer) {
  // Tenta latin-1 primeiro (formato histórico CEF), depois UTF-8
  let text = buffer.toString('latin1');
  // Se parecer UTF-8 (BOM ou sequências multi-byte comuns), redecodifica
  if (buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    text = buffer.toString('utf8').replace(/^﻿/, '');
  }
  const lines = text.split(/\r?\n/);

  // Localiza a linha de cabeçalho: primeira linha com ≥5 ponto-e-vírgulas
  // que NÃO seja linha de metadado (Lista de Im..., Data de g...)
  let headerIdx = -1;
  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const l = lines[i];
    const semis = (l.match(/;/g) || []).length;
    const lower = l.toLowerCase();
    const isMetadata = lower.includes('lista de im') || lower.includes('data de g') || lower.trim() === '';
    if (semis >= 5 && !isMetadata) {
      headerIdx = i;
      break;
    }
  }

  // Log diagnóstico das primeiras 6 linhas (para debug futuro)
  if (headerIdx === -1) {
    for (let i = 0; i < Math.min(lines.length, 6); i++) {
      // já logado externamente em scraperCEFcsv
    }
    return { headers: [], rows: [] };
  }

  const headers = lines[headerIdx].split(';').map(h => h.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, '').trim()
  );

  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(';');
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cols[idx] || '').trim(); });
    rows.push(obj);
  }
  return { headers, rows };
}

// Mapeamento defensivo de colunas da Caixa (nomes variam por versão do CSV)
function mapearColunaCaixa(row) {
  const get = (...keys) => {
    for (const k of keys) {
      const found = Object.keys(row).find(rk => rk.includes(k));
      if (found && row[found]) return row[found];
    }
    return '';
  };

  return {
    id:               get('numero do im', 'numero im', 'n  do im', 'imovel'),
    tipo:             get('tipo do im', 'tipo im', 'tipo'),
    logradouro:       get('logradouro', 'endereco', 'rua'),
    bairro:           get('bairro'),
    cidade:           get('cidade', 'municipio'),
    uf:               get(' uf', 'estado', 'uf'),
    valor_avaliacao:  get('valor de avalia', 'avalia'),
    valor_minimo:     get('valor minimo', 'valor de venda', 'lance inicial', 'preco'),
    modalidade:       get('modalidade', 'tipo de venda'),
    link:             get('link de acesso', 'link', 'url'),
    descricao_csv:    get('descri', 'observa', 'complemento'),
    numero_edital:    get('edital', 'n do edital', 'numero edital'),
    numero_matricula: get('matricula', 'n da matricula', 'numero matricula', 'registro'),
    numero_processo:  get('processo', 'n do processo', 'numero processo'),
    situacao_ocup:    get('situacao ocup', 'ocupacao', 'ocupa'),
    foto:             get('foto', 'link foto', 'imagem', 'figura', 'link da foto'),
  };
}

async function scraperCEFcsv(uf) {
  console.log(`  CEF CSV ${uf}...`);
  try {
    const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;
    const { buffer, status } = await fetchBuffer(url);

    if (status !== 200) {
      console.log(`    CEF CSV ${uf}: status ${status}`);
      return [];
    }

    const { headers, rows } = parseCSVCaixa(buffer);
    if (rows.length === 0) {
      // Diagnóstico expandido: mostra as 8 primeiras linhas para identificar o formato
      const rawText = buffer.toString('latin1');
      const fl = rawText.split(/\r?\n/).slice(0, 8);
      fl.forEach((l, i) => console.log(`    CEF ${uf} L${i}: ${JSON.stringify(l.slice(0,120))}`));
      console.log(`    CEF CSV ${uf}: headers=${JSON.stringify(headers.slice(0,5))}`);
      console.log(`    CEF CSV ${uf}: 0 registros`);
      return [];
    }

    const imoveis = rows.map(row => {
      const m = mapearColunaCaixa(row);
      const valorMin = parseBRNumber(m.valor_minimo);
      const valorAval = parseBRNumber(m.valor_avaliacao);
      if (!m.id || valorMin <= 0) return null;

      const modalLower = m.modalidade.toLowerCase();
      const isLeilao = modalLower.includes('leil');
      const isFinanciado = modalLower.includes('financ') || modalLower.includes('fgts');

      const linkDetalhe = m.link || `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${m.id.replace(/\s/g,'')}`;
      const descParts = [m.modalidade, m.tipo, m.situacao_ocup, m.descricao_csv].filter(Boolean);
      return {
        fonte: 'CEF',
        fonte_id: `cef_${m.id.replace(/\s/g,'')}`,
        titulo: `${m.tipo || 'Imóvel'} — ${m.bairro} ${m.cidade} ${uf}`.trim(),
        tipo: normalizarTipo(m.tipo),
        modalidade: isLeilao ? 'judicial' : 'extrajudicial',
        estado: uf,
        cidade: toTitleCase(m.cidade),
        bairro: toTitleCase(m.bairro),
        endereco: toTitleCase(m.logradouro),
        valor_avaliacao: valorAval,
        valor_minimo: valorMin,
        area_m2: 0,
        descricao: descParts.join(' — ') || null,
        link_edital: linkDetalhe,
        link_foto: m.foto?.trim() || null,
        _foto_original: m.foto?.trim() || null,
        leiloeiro: 'Caixa Econômica Federal',
        data_leilao: null,
        forma_pagamento: isFinanciado ? 'financiado' : 'a_vista',
        numero_edital: m.numero_edital || null,
        numero_matricula: m.numero_matricula || null,
        numero_processo: m.numero_processo || null,
      };
    }).filter(Boolean);

    console.log(`    CEF CSV ${uf}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro CEF CSV ${uf}: ${err.message.slice(0, 100)}`);
    return [];
  }
}

// ─── SCRAPER CEF (API JSON — fallback) ────────────────────────────────────────

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
    })).filter(im => im.valor_minimo > 0 && im.fonte_id !== 'cef_undefined');
  } catch (err) {
    console.log(`    Erro CEF ${estado}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER SUPERBID (API direta, sem dependência de hash Next.js) ───────────

async function scraperSuperbid(pageNumber = 1) {
  console.log(`  Superbid página ${pageNumber}...`);
  try {
    const url = `https://offer-query.superbid.net/seo/offers/?locale=pt_BR&portalId=[2,15]&requestOrigin=marketplace&timeZoneId=America%2FSao_Paulo&orderBy=score:desc&pageNumber=${pageNumber}&pageSize=50&searchType=opened&categoryId=imoveis`;
    const data = await fetchJson(url, {
      headers: {
        'Origin': 'https://www.superbid.net',
        'Referer': 'https://www.superbid.net/categorias/imoveis',
      }
    });

    // Superbid pode mudar o campo root — tenta vários
    const offers = data?.offers || data?.data?.offers || data?.result?.offers
      || data?.content || data?.items || data?.results || [];
    if (offers.length === 0) {
      const keys = Object.keys(data || {}).slice(0, 8).join(',');
      console.log(`    Superbid p${pageNumber}: nenhum resultado. Keys: ${keys}`);
      return [];
    }

    const imoveis = offers.map(of => {
      const p = of.product || {};
      const loc = p.location || {};
      const det = of.offerDetail || {};
      const isJudicial = (of.auction?.subMarketplaces || []).some(s => s.desc === 'Judicial');

      // Extrai área da descrição
      const areaMatch = (of.offerDescription || '').match(/(\d+[\.,]?\d*)\s*m2/i);
      const area = areaMatch ? parseFloat(areaMatch[1].replace(',', '.')) : 0;

      // Extrai estado da cidade (ex: "Campinas - SP" → "SP")
      const cidadeCompleta = loc.city || '';
      const estadoMatch = cidadeCompleta.match(/[-–]\s*([A-Z]{2})$/);
      const estadoUF = estadoMatch ? estadoMatch[1] : (loc.state || '');
      const cidadeNome = cidadeCompleta.replace(/\s*[-–]\s*[A-Z]{2}$/, '').trim();

      return {
        fonte: 'SOLD',
        fonte_id: `sbid_${of.id}`,
        titulo: p.shortDesc || `Imóvel ${cidadeCompleta}`,
        tipo: normalizarTipo(p.subCategory?.description),
        modalidade: isJudicial ? 'judicial' : 'extrajudicial',
        estado: estadoUF,
        cidade: cidadeNome,
        bairro: loc.neighborhood || '',
        endereco: loc.street || '',
        valor_avaliacao: parseFloat(det.referenceValue || det.directSaleValue || 0),
        valor_minimo: parseFloat(det.initialBidValue || det.currentMinBid || 0),
        area_m2: area,
        descricao: (of.offerDescription || '').replace(/<[^>]+>/g, '').slice(0, 500),
        link_edital: `https://www.superbid.net/lote/${of.id}`,
        link_foto: p.thumbnailUrl || null,
        leiloeiro: of.store?.name || of.seller?.name || 'Superbid',
        data_leilao: of.endDate || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(im => im.valor_minimo > 0);

    console.log(`    Superbid p${pageNumber}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Superbid p${pageNumber}: ${err.message.slice(0, 100)}`);
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

// ─── SCRAPER BIASSI ──────────────────────────────────────────────────────────

async function scraperBiassi(page = 1) {
  console.log(`  Biassi página ${page}...`);
  try {
    const url = `https://www.biassi.com.br/leilao/imoveis?page=${page}`;
    const html = await fetchHtml(url);
    const imoveis = [];
    const cardRegex = /<div[^>]*class="[^"]*card[^"]*lote[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi;
    // Tenta extrair dados dos cards de lote
    const lotRegex = /<a[^>]*href="([^"]*\/lote\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = lotRegex.exec(html)) !== null && imoveis.length < 30) {
      const href = m[1];
      const inner = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const valorMatch = inner.match(/R\$\s*([\d.,]+)/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;
      const id = href.split('/').pop().split('?')[0];
      imoveis.push({
        fonte: 'BIASSI',
        fonte_id: `biassi_${id}`,
        titulo: inner.slice(0, 100) || `Imóvel Biassi ${id}`,
        tipo: normalizarTipo(inner),
        modalidade: inner.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
        estado: '',
        cidade: '',
        bairro: '',
        endereco: '',
        valor_avaliacao: 0,
        valor_minimo: valor,
        area_m2: 0,
        descricao: inner.slice(0, 300),
        link_edital: href.startsWith('http') ? href : `https://www.biassi.com.br${href}`,
        link_foto: null,
        leiloeiro: 'Biassi Leilões',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    Biassi p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Biassi: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER HASTA PÚBLICA ────────────────────────────────────────────────────

async function scraperHastaPublica(page = 1) {
  console.log(`  HastaPública página ${page}...`);
  try {
    const url = `https://www.hastapublica.com.br/busca?categoria=imoveis&pagina=${page}`;
    const html = await fetchHtml(url);
    const imoveis = [];
    // Extrai links de lotes de imóveis
    const linkRegex = /href="(\/lote\/[^"?]+)[^"]*"[^>]*>([\s\S]{0,500}?)<\/a>/gi;
    let m;
    const seen = new Set();
    while ((m = linkRegex.exec(html)) !== null && imoveis.length < 30) {
      const href = m[1];
      if (seen.has(href)) continue;
      seen.add(href);
      const inner = m[2].replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      const valorMatch = inner.match(/R\$\s*([\d.,]+)/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;
      const id = href.split('/').filter(Boolean).pop();
      imoveis.push({
        fonte: 'HASTA',
        fonte_id: `hasta_${id}`,
        titulo: inner.slice(0, 100) || `Imóvel HastaPública ${id}`,
        tipo: normalizarTipo(inner),
        modalidade: 'judicial',
        estado: '',
        cidade: '',
        bairro: '',
        endereco: '',
        valor_avaliacao: 0,
        valor_minimo: valor,
        area_m2: 0,
        descricao: inner.slice(0, 300),
        link_edital: `https://www.hastapublica.com.br${href}`,
        link_foto: null,
        leiloeiro: 'HastaPública',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    HastaPública p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro HastaPública: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER TOP LEILÕES ──────────────────────────────────────────────────────

async function scraperSuperbidAlt(pageNumber = 1) {
  // URL alternativa da API Superbid (busca de imóveis)
  console.log(`  Superbid Alt página ${pageNumber}...`);
  try {
    const url = `https://offer-query.superbid.net/v1/offer/search?locale=pt_BR&categorySlug=imoveis&pageNumber=${pageNumber}&pageSize=50&status=OPENED&orderBy=score`;
    const data = await fetchJson(url, {
      headers: { 'Origin': 'https://www.superbid.net', 'Referer': 'https://www.superbid.net/' },
    });
    const offers = data?.offers || data?.data || data?.content || data?.items || data?.results || [];
    if (!offers.length) {
      console.log(`    Superbid Alt p${pageNumber}: ${JSON.stringify(Object.keys(data || {}))}`);
      return [];
    }
    return offers.map(of => {
      const p = of.product || of;
      const loc = p.location || of.location || {};
      return {
        fonte: 'SOLD',
        fonte_id: `sbid_${of.id || of.offerId}`,
        titulo: p.shortDesc || p.description || `Imóvel Superbid`,
        tipo: normalizarTipo(p.subCategory?.description || of.categoryDesc),
        modalidade: 'extrajudicial',
        estado: loc.state || '',
        cidade: (loc.city || '').replace(/\s*[-–]\s*[A-Z]{2}$/, '').trim(),
        bairro: loc.neighborhood || '',
        endereco: loc.street || '',
        valor_avaliacao: parseFloat(of.referenceValue || of.directSaleValue || 0),
        valor_minimo: parseFloat(of.initialBidValue || of.currentMinBid || of.minBid || 0),
        area_m2: 0,
        descricao: '',
        link_edital: `https://www.superbid.net/lote/${of.id || of.offerId}`,
        link_foto: p.thumbnailUrl || null,
        leiloeiro: of.store?.name || 'Superbid',
        data_leilao: of.endDate || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(im => im.valor_minimo > 0);
  } catch (err) {
    console.log(`    Erro Superbid Alt: ${err.message.slice(0, 100)}`);
    return [];
  }
}

// ─── SCRAPER ELEILÕES ─────────────────────────────────────────────────────────

async function scraperELeiloes(page = 1) {
  console.log(`  eLeilões página ${page}...`);
  try {
    const url = `https://www.eleiloes.com.br/busca?categoria=imoveis&pagina=${page}`;
    const html = await fetchHtml(url);
    const imoveis = [];
    // eLeilões usa cards com data-product ou article
    const cardRegex = /<(?:article|div)[^>]*class="[^"]*(?:card|product|lote)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
    let m;
    while ((m = cardRegex.exec(html)) !== null && imoveis.length < 30) {
      const card = m[1];
      const href = card.match(/href="([^"]*lote[^"]+)"/i)?.[1] || '';
      if (!href) continue;
      const titulo = card.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
      const valorMatch = card.match(/R\$\s*([\d.,]+)/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;
      const id = href.split('/').filter(Boolean).pop().split('?')[0];
      const foto = card.match(/<img[^>]*src="([^"]+)"/i)?.[1] || null;
      imoveis.push({
        fonte: 'ELEILOES',
        fonte_id: `eleil_${id}`,
        titulo: titulo.slice(0, 100) || `Imóvel eLeilões ${id}`,
        tipo: normalizarTipo(titulo),
        modalidade: titulo.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
        estado: '',
        cidade: '',
        bairro: '',
        endereco: '',
        valor_avaliacao: 0,
        valor_minimo: valor,
        area_m2: 0,
        descricao: titulo.slice(0, 300),
        link_edital: href.startsWith('http') ? href : `https://www.eleiloes.com.br${href}`,
        link_foto: foto,
        leiloeiro: 'eLeilões',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    eLeilões p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro eLeilões: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── NORMALIZADORES ──────────────────────────────────────────────────────────

function toTitleCase(str) {
  if (!str) return str;
  return str.toLowerCase().replace(/(?:^|\s|-)(\S)/g, c => c.toUpperCase());
}

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

// ─── UPLOAD DE FOTOS PARA STORAGE ────────────────────────────────────────────

const CEF_IMG_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Referer': 'https://venda-imoveis.caixa.gov.br/',
  'Accept': 'image/webp,image/apng,image/*,*/*;q=0.8',
};

function fetchBinary(url) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;
    const req = lib.get(url, { headers: CEF_IMG_HEADERS, timeout: 12000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchBinary(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return resolve(null);
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers['content-type'] || 'image/jpeg' }));
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

async function uploadFotoStorage(fotoUrl, fonteId) {
  if (!fotoUrl) return null;
  try {
    const result = await fetchBinary(fotoUrl);
    if (!result || result.buffer.length < 500) return null;
    const ext = result.contentType.includes('png') ? 'png' : result.contentType.includes('webp') ? 'webp' : 'jpg';
    const path = `cef/${fonteId}.${ext}`;
    const { error } = await supabase.storage
      .from('imoveis-fotos')
      .upload(path, result.buffer, { contentType: result.contentType, upsert: true });
    if (error) return null;
    const { data } = supabase.storage.from('imoveis-fotos').getPublicUrl(path);
    return data.publicUrl;
  } catch {
    return null;
  }
}

// ─── SALVAR NO SUPABASE ───────────────────────────────────────────────────────

async function salvarImoveis(imoveis) {
  if (imoveis.length === 0) return;

  const comViabilidade = await Promise.all(imoveis.map(async (im) => {
    const v = await avaliarViabilidade({ valorMinimo: im.valor_minimo, valorAvaliacao: im.valor_avaliacao });

    // Upload foto para Storage se for URL externa da CEF
    let linkFoto = im.link_foto;
    const fotoOriginal = im._foto_original || im.link_foto;
    if (fotoOriginal && !fotoOriginal.includes(SUPABASE_URL)) {
      const stored = await uploadFotoStorage(fotoOriginal, im.fonte_id);
      if (stored) linkFoto = stored;
    }

    return {
      ...im,
      link_foto: linkFoto,
      viavel: v.viavel,
      score_viabilidade: v.score,
      motivo_viabilidade: v.motivo,
      desconto_percentual: im.valor_avaliacao > 0
        ? Math.round((1 - im.valor_minimo / im.valor_avaliacao) * 100)
        : null,
      atualizado_em: new Date().toISOString(),
    };
  }));

  // Remove campos internos não presentes no schema
  const rows = comViabilidade.map(({ raw: _raw, _foto_original: _fo, ...rest }) => rest);

  const { error } = await supabase
    .from('imoveis_leilao')
    .upsert(rows, { onConflict: 'fonte,fonte_id', ignoreDuplicates: false });

  if (error) console.error('Erro ao salvar:', error.message);
  else console.log(`    ✅ ${comViabilidade.length} imóveis salvos`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏠 TSN Scraper iniciado em ${new Date().toISOString()}\n`);

  let total = 0;

  // 1. CEF via CSV (download direto, sem proteção bot)
  console.log('📋 Scraping CEF CSV...');
  const ufs = ['SP','RJ','MG','BA','PR','RS','PE','CE','GO','SC','ES','MA','PA','PB','RN','MT','MS','PI','AL','SE','TO','DF','AC','AM','AP','RO','RR'];
  for (const uf of ufs) {
    const imoveis = await scraperCEFcsv(uf);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 800));
  }

  // 2. Superbid (API direta — 1450 imóveis paginados de 50 em 50)
  console.log('\n📋 Scraping Superbid...');
  for (let page = 1; page <= 6; page++) {
    const imoveis = await scraperSuperbid(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. Zukerman (judicial SP)
  console.log('\n📋 Scraping leiloeiros judiciais...');
  const zuk = await scraperZukerman();
  await salvarImoveis(zuk);
  total += zuk.length;

  // 4. Biassi (extrajudicial/judicial SP e outros estados)
  console.log('\n📋 Scraping Biassi...');
  for (let page = 1; page <= 3; page++) {
    const imoveis = await scraperBiassi(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 5. HastaPública (judicial)
  console.log('\n📋 Scraping HastaPública...');
  for (let page = 1; page <= 3; page++) {
    const imoveis = await scraperHastaPublica(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 6. Superbid URL alternativa
  console.log('\n📋 Scraping Superbid Alt...');
  for (let page = 1; page <= 4; page++) {
    const imoveis = await scraperSuperbidAlt(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 7. eLeilões
  console.log('\n📋 Scraping eLeilões...');
  for (let page = 1; page <= 3; page++) {
    const imoveis = await scraperELeiloes(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // Desativa imóveis não arrematados sem atualização há 90 dias
  const noventaDiasAtras = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await supabase
    .from('imoveis_leilao')
    .update({ ativo: false })
    .lt('atualizado_em', noventaDiasAtras)
    .eq('ativo', true)
    .eq('arrematado', false);

  console.log(`\n✅ Scraping concluído. ${total} imóveis processados.\n`);
}

main().catch(err => {
  console.error('Erro fatal:', err);
  process.exit(1);
});
