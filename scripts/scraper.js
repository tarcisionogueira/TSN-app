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
  // CEF usa latin-1 (ISO-8859-1)
  const text = buffer.toString('latin1');
  const lines = text.split(/\r?\n/);

  // Localiza a linha do cabeçalho (contém "Número do imóvel" ou "Numero do imovel")
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes('mero') && lines[i].includes(';')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx === -1) return { headers: [], rows: [] };

  const headers = lines[headerIdx].split(';').map(h => h.trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // remove acentos para comparar
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
    id:              get('numero do im', 'numero im', 'n  do im', 'imovel'),
    tipo:            get('tipo do im', 'tipo im', 'tipo'),
    logradouro:      get('logradouro', 'endereco', 'rua'),
    bairro:          get('bairro'),
    cidade:          get('cidade', 'municipio'),
    uf:              get(' uf', 'estado', 'uf'),
    valor_avaliacao: get('valor de avalia', 'avalia'),
    valor_minimo:    get('valor minimo', 'valor de venda', 'lance inicial', 'preco'),
    modalidade:      get('modalidade', 'tipo de venda'),
    link:            get('link de acesso', 'link', 'url'),
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

    const { rows } = parseCSVCaixa(buffer);
    if (rows.length === 0) {
      console.log(`    CEF CSV ${uf}: 0 linhas após parse`);
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

      return {
        fonte: 'CEF',
        fonte_id: `cef_${m.id.replace(/\s/g,'')}`,
        titulo: `${m.tipo || 'Imóvel'} — ${m.bairro} ${m.cidade} ${uf}`.trim(),
        tipo: normalizarTipo(m.tipo),
        modalidade: isLeilao ? 'judicial' : 'extrajudicial',
        estado: uf,
        cidade: m.cidade,
        bairro: m.bairro,
        endereco: m.logradouro,
        valor_avaliacao: valorAval,
        valor_minimo: valorMin,
        area_m2: 0,
        descricao: `${m.modalidade} — ${m.tipo}`,
        link_edital: m.link || `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${m.id}`,
        link_foto: null,
        leiloeiro: 'Caixa Econômica Federal',
        data_leilao: null,
        forma_pagamento: isFinanciado ? 'financiado' : 'a_vista',
        raw: JSON.stringify(m).slice(0, 400),
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
      raw: JSON.stringify(im).slice(0, 500),
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

    const offers = data?.offers || [];
    if (offers.length === 0) {
      console.log(`    Superbid p${pageNumber}: nenhum resultado`);
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
        raw: JSON.stringify({ id: of.id, shortDesc: p.shortDesc, city: loc.city }).slice(0, 300),
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

  // 1. CEF via CSV (download direto, sem proteção bot)
  console.log('📋 Scraping CEF CSV...');
  const ufs = ['SP','RJ','MG','BA','PR','RS','PE','CE','GO','SC','ES','MA','PA','PB','RN','MT','MS','PI','AL','SE','TO','DF'];
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
