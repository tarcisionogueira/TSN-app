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
    id:               get('n do im', 'numero do im', 'numero im', 'imovel'),
    tipo:             get('tipo do im', 'tipo im', 'tipo'),
    logradouro:       get('logradouro', 'endereco', 'rua'),
    bairro:           get('bairro'),
    cidade:           get('cidade', 'municipio'),
    uf:               get(' uf', 'estado', 'uf'),
    valor_avaliacao:  get('valor de avalia', 'avalia'),
    valor_minimo:     get('valor minimo', 'valor de venda', 'lance inicial', 'preco'),
    financiamento:    get('financiamento'),
    modalidade:       get('modalidade', 'tipo de venda'),
    link:             get('link de acesso', 'link', 'url'),
    descricao_csv:    get('descri', 'observa', 'complemento'),
    numero_edital:    get('edital', 'n do edital', 'numero edital'),
    numero_matricula: get('matricula', 'n da matricula', 'numero matricula', 'registro'),
    numero_processo:  get('processo', 'n do processo', 'numero processo'),
    situacao_ocup:    get('situacao ocup', 'ocupacao', 'ocupa'),
  };
}

// Detecta forma de pagamento do imóvel CEF a partir do texto (descrição + modalidade).
// Retorna null quando não há informação confiável (imóvel é omitido dos filtros de pagamento).
function formaPagamentoCEF(descricao, modalidade, financiamento) {
  // A coluna 'financiamento' do CSV é um flag Sim/Não — é a fonte autoritativa.
  const fin = (financiamento || '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const texto = `${descricao || ''} ${modalidade || ''}`
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Hipoteca/ônus tem prioridade (independe do flag)
  if (/hipotec|com onus|gravame/.test(texto)) return 'hipotecado';
  // Flag explícito Sim/Não da Caixa
  if (fin === 'sim') return 'financiado';
  if (fin === 'nao') return 'a_vista';
  // Fallback por texto (caso o flag venha vazio)
  if (/fgts|financ|parcelament|consorci/.test(texto)) return 'financiado';
  if (/a vista|avista|recursos proprios/.test(texto)) return 'a_vista';
  return null;
}

// Normaliza a modalidade de venda da Caixa para os valores usados no app.
// CRÍTICO: 'venda_direta' isenta o imóvel da exigência de data no fluxo.
function normalizarModalidadeCEF(modalidade) {
  const m = (modalidade || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Vendas sem data (contínuas): venda direta, venda online → tratadas como venda_direta
  if (m.includes('venda') && (m.includes('direta') || m.includes('online'))) return 'venda_direta';
  if (m.includes('licitac')) return 'licitacao_aberta';
  if (/(^|[^\d])1.{0,3}(leil|praca)/.test(m) || m.includes('primeiro')) return 'primeiro_leilao';
  if (/(^|[^\d])2.{0,3}(leil|praca)/.test(m) || m.includes('segundo')) return 'segundo_leilao';
  if (m.includes('unica') && m.includes('praca')) return 'primeiro_leilao'; // praça única é datada
  if (m.includes('leil') || m.includes('praca')) return 'judicial';
  // Fallback: nunca descarta — preserva como extrajudicial (aparece no site)
  return 'extrajudicial';
}

// Extrai número da matrícula do texto da descrição ("Matrícula(s): nº 12.345").
function extrairMatriculaTexto(texto) {
  const m = (texto || '').match(/matr[ií]cula[^\d]{0,18}(\d[\d.\-\/]{2,})/i);
  return m ? m[1] : null;
}

// Extrai CEP embutido no endereço ("..., CEP: 40010-000, ...").
function extrairCEP(texto) {
  const m = (texto || '').match(/CEP[:\s]+(\d{5}-?\d{3})/i);
  return m ? m[1].replace('-', '') : null;
}

// Extrai área em m² da descrição.
// Formato atual da Caixa (ponto decimal): "0.00 de área total, 53.68 de área
// privativa, 1200.00 de área do terreno". Prioriza privativa > total > terreno
// (ignorando zeros). Mantém fallback para o formato genérico "50,00 m²".
function extrairAreaM2(texto) {
  const t = texto || '';
  const labels = [
    /([\d.]+)\s*de [áa]rea privativa/i,
    /([\d.]+)\s*de [áa]rea total/i,
    /([\d.]+)\s*de [áa]rea do terreno/i,
  ];
  for (const re of labels) {
    const mm = t.match(re);
    if (mm) {
      const n = parseFloat(mm[1]); // ponto = decimal no CSV da Caixa
      if (!isNaN(n) && n > 0) return n;
    }
  }
  const m = t.match(/([\d.]+,?\d*)\s*m[²2]/i);
  if (!m) return 0;
  const n = parseFloat(m[1].replace(/\./g, '').replace(',', '.'));
  return isNaN(n) ? 0 : n;
}

// Infere o tipo do imóvel CEF. A coluna "tipo" do CSV atual vem vazia; o tipo
// é a 1ª palavra da descrição ("Apartamento, 0.00 de área total, ..."). Espelha
// o mapeamento usado no backfill do banco para manter consistência.
function inferirTipoCEF(m) {
  if (m.tipo) return normalizarTipo(m.tipo);
  const seg = (m.descricao_csv || '').split(/[,\-–—\n]/)[0]
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/apartament/.test(seg)) return 'apartamento';
  if (/casa|sobrado/.test(seg)) return 'casa';
  if (/terreno|lote|gleba/.test(seg)) return 'terreno';
  if (/loja|sala|comerc|galp|predio|conjunto|box/.test(seg)) return 'comercial';
  if (/rural|sitio|fazenda|chacara/.test(seg)) return 'rural';
  return 'imovel';
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
    if (uf === 'SP') console.log(`    CEF headers SP: ${JSON.stringify(headers)}`);
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

      // Modalidade normalizada (venda_direta, 1ª/2ª praça, licitação, judicial...)
      const modalidadeNorm = normalizarModalidadeCEF(m.modalidade);
      const ehVendaDireta = modalidadeNorm === 'venda_direta';
      // Forma de pagamento: a Caixa NÃO tem coluna de financiamento no CSV —
      // a info está no texto da descrição. Escaneia descrição + modalidade.
      const formaPagamento = formaPagamentoCEF(m.descricao_csv, m.modalidade, m.financiamento);

      const numeroLimpo = m.id.replace(/\s/g, '');
      const linkDetalhe = m.link || `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${numeroLimpo}`;
      // Matrícula e edital têm URL determinística no portal da Caixa (a partir do nº do imóvel)
      const linkMatricula = `https://venda-imoveis.caixa.gov.br/sistema/matricula.asp?hdniip=${numeroLimpo}`;
      // CEF não fornece URL de foto no CSV — construir a partir do número do imóvel
      const fotoUrl = `https://venda-imoveis.caixa.gov.br/fotos/F${numeroLimpo}.jpg`;
      // Extrai dados do texto: CEP no endereço, matrícula e área na descrição
      const cep = extrairCEP(m.logradouro) || extrairCEP(m.descricao_csv);
      const enderecoLimpo = toTitleCase((m.logradouro || '').replace(/\s*[-–,]?\s*CEP[:\s]+\d{5}-?\d{3}/i, '').trim());
      const numeroMatricula = m.numero_matricula || extrairMatriculaTexto(m.descricao_csv);
      const areaM2 = extrairAreaM2(m.descricao_csv);
      const tipoNorm = inferirTipoCEF(m);
      const TIPO_LABEL = { apartamento: 'Apartamento', casa: 'Casa', terreno: 'Terreno', comercial: 'Imóvel comercial', rural: 'Imóvel rural', imovel: 'Imóvel' };
      const descParts = [m.modalidade, m.tipo, m.situacao_ocup, m.descricao_csv].filter(Boolean);
      return {
        fonte: 'CEF',
        fonte_id: `cef_${numeroLimpo}`,
        titulo: `${m.tipo || TIPO_LABEL[tipoNorm]} — ${m.bairro} ${m.cidade} ${uf}`.trim(),
        tipo: tipoNorm,
        modalidade: modalidadeNorm,
        estado: uf,
        cidade: toTitleCase(m.cidade),
        bairro: toTitleCase(m.bairro),
        endereco: enderecoLimpo,
        cep: cep || null,
        valor_avaliacao: valorAval,
        valor_minimo: valorMin,
        area_m2: areaM2,
        descricao: descParts.join(' — ') || null,
        // Venda direta → "regra de venda online"; leilão → edital
        link_edital: ehVendaDireta ? null : linkDetalhe,
        link_regras_venda: ehVendaDireta ? linkDetalhe : null,
        link_matricula: linkMatricula,
        url_lote: linkDetalhe,
        link_foto: fotoUrl,
        _foto_original: fotoUrl,
        leiloeiro: 'Caixa Econômica Federal',
        data_leilao: null,
        forma_pagamento: formaPagamento,
        numero_edital: m.numero_edital || null,
        numero_matricula: numeroMatricula,
        numero_processo: m.numero_processo || null,
        dedup_chave: numeroMatricula ? `mat:${numeroMatricula.toLowerCase().replace(/[^a-z0-9]/g, '')}`
                    : (cep && valorMin ? `cep:${cep}:${Math.round(valorMin)}` : null),
      };
    }).filter(Boolean);

    // GUARDA ANTI-CORRUPÇÃO: se a Caixa mudar o layout do CSV e o mapeamento por
    // nome falhar, a maioria cai no fallback (tipo='imovel', modalidade='extrajudicial',
    // forma_pagamento=null). Foi assim que o scraper de índice fixo (descontinuado)
    // corrompeu 91% do acervo. Se >60% vier degradado, ABORTA o UF (não faz upsert)
    // para nunca sobrescrever dados bons com lixo.
    if (imoveis.length >= 20) {
      const degradados = imoveis.filter(i => i.tipo === 'imovel' && !i.forma_pagamento).length;
      const taxa = degradados / imoveis.length;
      if (taxa > 0.6) {
        console.error(`    🛑 CEF ${uf}: ${(taxa * 100).toFixed(0)}% dos registros degradados (tipo desconhecido + sem forma de pagamento). Layout do CSV provavelmente mudou — ABORTANDO ${uf} (sem upsert) para não corromper o acervo.`);
        return [];
      }
    }

    const comFoto = imoveis.filter(i => i._foto_original).length;
    console.log(`    CEF CSV ${uf}: ${imoveis.length} imóveis, ${comFoto} com foto`);
    if (uf === 'SP' && comFoto > 0) {
      const sample = imoveis.find(i => i._foto_original);
      console.log(`    Foto SP sample: ${sample._foto_original}`);
    }
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
    // portalId=[2,15] deve ser percent-encoded para evitar rejeição por alguns servidores/proxies
    const url = `https://offer-query.superbid.net/seo/offers/?locale=pt_BR&portalId=%5B2%2C15%5D&requestOrigin=marketplace&timeZoneId=America%2FSao_Paulo&orderBy=score%3Adesc&pageNumber=${pageNumber}&pageSize=50&searchType=opened&categoryId=imoveis`;
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
        fonte: 'SUPERBID',
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

async function scraperZukerman(page = 1) {
  console.log(`  Zukerman Leilões página ${page}...`);
  try {
    const html = await fetchHtml(`https://www.zukerman.com.br/imoveis?page=${page}`);
    if (html.length < 1000) {
      console.log(`    Zukerman p${page}: HTML muito curto (${html.length} chars) — fim da paginação`);
      return [];
    }
    const imoveis = [];
    const cardRegex = /<article[^>]*>([\s\S]*?)<\/article>/gi;
    let match;
    while ((match = cardRegex.exec(html)) !== null) {
      const card = match[1];
      const titulo = card.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
      const valor = card.match(/R\$\s*([\d.,]+)/)?.[1]?.replace(/\./g,'')?.replace(',','.') || '0';
      // Prefere link que aponte para lote/imovel — evita pegar links de imagem ou breadcrumb
      const link = card.match(/href="([^"]*(?:lote|imovel|produto|processo)[^"]*)"/i)?.[1]
        || card.match(/href="(\/[^"]+\d{4,}[^"]*)"/)?.[1]
        || card.match(/href="([^"#][^"]+)"/)?.[1]
        || '';
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
    console.log(`    Zukerman p${page}: ${imoveis.length} imóveis`);
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
    // Biassi usa links com /lote/, /produto/ ou /item/ — captura qualquer um
    const lotRegex = /<a[^>]*href="([^"]*\/(?:lote|produto|item|imovel)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    const seen = new Set();

    const extrairImovelBiassi = (href, inner) => {
      if (seen.has(href)) return;
      seen.add(href);
      const valorMatch = inner.match(/R\$\s*([\d.,]+)/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) return;
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
    };

    while ((m = lotRegex.exec(html)) !== null && imoveis.length < 100) {
      const href = m[1];
      const inner = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      extrairImovelBiassi(href, inner);
    }

    // Fallback: extrai por contexto ao redor de qualquer link com ID numérico longo
    if (imoveis.length === 0) {
      const fallbackRegex = /href="(\/[^"]*\d{5,}[^"?#]*)"/gi;
      while ((m = fallbackRegex.exec(html)) !== null && imoveis.length < 100) {
        const href = m[1];
        if (seen.has(href)) continue;
        const pos = html.indexOf(m[0]);
        const ctx = html.slice(Math.max(0, pos - 300), pos + 600).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        extrairImovelBiassi(href, ctx);
      }
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
    // Extrai links de lotes — procura /lote/ ou /processo/ no href
    const linkRegex = /href="(\/(?:lote|processo|imovel)\/[^"?#]+)"/gi;
    let m;
    const seen = new Set();
    while ((m = linkRegex.exec(html)) !== null && imoveis.length < 100) {
      const href = m[1];
      if (seen.has(href)) continue;
      seen.add(href);
      // Usa contexto ao redor do link para extrair título e valor (valor pode estar fora do <a>)
      const pos = html.indexOf(m[0]);
      const ctx = html.slice(Math.max(0, pos - 300), pos + 800);
      const inner = ctx.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      const valorMatch = inner.match(/R\$\s*([\d.]+,\d{2})/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;
      const titulo = ctx.match(/<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim()
        || inner.slice(0, 100);
      const id = href.split('/').filter(Boolean).pop();
      imoveis.push({
        fonte: 'HASTA',
        fonte_id: `hasta_${id}`,
        titulo: titulo.slice(0, 100) || `Imóvel HastaPública ${id}`,
        tipo: normalizarTipo(titulo),
        modalidade: 'judicial',
        estado: '',
        cidade: '',
        bairro: '',
        endereco: '',
        valor_avaliacao: 0,
        valor_minimo: valor,
        area_m2: 0,
        descricao: titulo.slice(0, 300),
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
        fonte: 'SUPERBID',
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

// ─── SCRAPER MEGA LEILÕES ─────────────────────────────────────────────────────

async function scraperMegaLeiloes(uf) {
  console.log(`  Mega Leilões ${uf}...`);
  try {
    // Mega Leilões usa query param ?estado= e não path segment
    const url = `https://www.megaleiloes.com.br/imoveis?estado=${uf}`;
    const html = await fetchHtml(url);
    const imoveis = [];
    const seen = new Set();

    // Mega usa cards com classe "product-item" ou similar
    const cardRegex = /<(?:article|div)[^>]*class="[^"]*(?:product|lote|item|card)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
    let m;
    while ((m = cardRegex.exec(html)) !== null && imoveis.length < 50) {
      const card = m[1];
      const href = card.match(/href="([^"]*(?:lote|imovel|produto)[^"]*)"/i)?.[1] || '';
      if (!href || seen.has(href)) continue;
      seen.add(href);

      const titulo = card.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
      const valorMatch = card.match(/R\$\s*([\d.,]+)/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;

      const avalMatch = card.match(/(?:avalia[çc][aã]o|avaliado)[^\d]*([\d.,]+)/i);
      const aval = avalMatch ? parseFloat(avalMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      const foto = card.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || null;
      const areaMatch = card.match(/(\d+[\.,]?\d*)\s*m[²2]/i);
      const area = areaMatch ? parseFloat(areaMatch[1].replace(',','.')) : 0;
      const id = href.split('/').filter(Boolean).pop().split('?')[0];

      const cidadeMatch = card.match(/(?:cidade|localiza[çc][aã]o)[^>]*>[^<]*([A-Z][a-zÀ-ú]+(?:\s[A-Z][a-zÀ-ú]+)*)/i);
      const cidade = cidadeMatch?.[1] || '';

      imoveis.push({
        fonte: 'MEGA',
        fonte_id: `mega_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Mega Leilões ${uf}`,
        tipo: normalizarTipo(titulo),
        modalidade: titulo.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
        estado: uf,
        cidade,
        bairro: '',
        endereco: '',
        valor_avaliacao: aval,
        valor_minimo: valor,
        area_m2: area,
        descricao: titulo.slice(0, 300),
        link_edital: href.startsWith('http') ? href : `https://www.megaleiloes.com.br${href}`,
        link_foto: foto?.startsWith('http') ? foto : (foto ? `https://www.megaleiloes.com.br${foto}` : null),
        leiloeiro: 'Mega Leilões',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }

    // Fallback: extrai por link com contexto — não usa zip posicional que mistura links com valores errados
    if (imoveis.length === 0) {
      const linkRegex = /href="(\/(?:lote|imovel)[^"?#]+)"/gi;
      let lm;
      while ((lm = linkRegex.exec(html)) !== null && imoveis.length < 30) {
        const href = lm[1];
        if (seen.has(href)) continue;
        seen.add(href);
        // Pega contexto ao redor para extrair valor corretamente (não posicional)
        const pos = html.indexOf(lm[0]);
        const ctx = html.slice(Math.max(0, pos - 200), pos + 500);
        const valorMatch = ctx.match(/R\$\s*([\d.]+,\d{2})/);
        if (!valorMatch) continue;
        const valor = parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.'));
        if (!valor) continue;
        const id = href.split('/').filter(Boolean).pop();
        imoveis.push({
          fonte: 'MEGA',
          fonte_id: `mega_${id}`,
          titulo: `Imóvel Mega Leilões ${uf}`,
          tipo: 'imovel',
          modalidade: 'extrajudicial',
          estado: uf,
          cidade: '',
          bairro: '',
          endereco: '',
          valor_avaliacao: 0,
          valor_minimo: valor,
          area_m2: 0,
          descricao: '',
          link_edital: `https://www.megaleiloes.com.br${href}`,
          link_foto: null,
          leiloeiro: 'Mega Leilões',
          data_leilao: null,
          forma_pagamento: 'a_vista',
        });
      }
    }

    console.log(`    Mega Leilões ${uf}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Mega Leilões ${uf}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER FRAZÃO LEILÕES ──────────────────────────────────────────────────

async function scraperFrazao(page = 1) {
  console.log(`  Frazão Leilões página ${page}...`);
  const urls = [
    `https://www.frazaoleiloes.com.br/imoveis?page=${page}`,
    `https://www.frazaoleiloes.com.br/leiloes/imoveis?pagina=${page}`,
    `https://www.frazaoleiloes.com.br/leiloes?categoria=imoveis&page=${page}`,
    `https://www.frazaoleiloes.com.br/?page=${page}&categoria=imoveis`,
  ];

  for (const url of urls) {
    try {
      const html = await fetchHtml(url, {
        headers: {
          Referer: 'https://www.frazaoleiloes.com.br/',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        },
      });

      if (html.length < 1000) continue;

      const imoveis = [];
      const seen = new Set();

      // Tenta cards com article/div de lote — padrão WordPress/WooCommerce
      const cardRegex = /<(?:article|div)[^>]*class="[^"]*(?:lote|lot|card|product|item)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
      let m;
      while ((m = cardRegex.exec(html)) !== null && imoveis.length < 50) {
        const card = m[1];
        const href = card.match(/href="([^"]+(?:lote|imovel|produto|leilao)[^"]*)"/i)?.[1]
          || card.match(/href="(https?:\/\/[^"]+)"/i)?.[1]
          || '';
        if (!href || seen.has(href)) continue;
        seen.add(href);

        const titulo = card.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1]?.replace(/<[^>]+>/g, '').trim()
          || card.match(/title="([^"]+)"/i)?.[1]
          || '';
        const valorMatch = card.match(/R\$\s*([\d.,]+)/);
        const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.')) : 0;
        if (!valor) continue;

        const avalMatch = card.match(/(?:avalia[çc][aã]o|avaliado)[^R]*R\$\s*([\d.,]+)/i);
        const aval = avalMatch ? parseFloat(avalMatch[1].replace(/\./g, '').replace(',', '.')) : 0;
        const foto = card.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1]
          || card.match(/<img[^>]*(?:src|data-src)="(https?:\/\/[^"]+)"/i)?.[1]
          || null;
        const areaMatch = card.match(/(\d+[\.,]?\d*)\s*m[²2]/i);
        const area = areaMatch ? parseFloat(areaMatch[1].replace(',', '.')) : 0;

        const estadoMatch = card.match(/\b([A-Z]{2})\b(?:\s*[-–]|\s*<)/);
        const estado = estadoMatch?.[1] || 'SP';
        const cidadeMatch = card.match(/(?:cidade|local)[^>]*>[^<]*?([A-ZÀ-Ú][a-zà-ú]+(?:\s[A-ZÀ-Ú][a-zà-ú]+)*)/);
        const cidade = cidadeMatch?.[1] || '';

        const id = href.replace(/[?#].*/, '').split('/').filter(Boolean).pop() || Math.random().toString(36).slice(2);
        const linkAbsoluto = href.startsWith('http') ? href : `https://www.frazaoleiloes.com.br${href}`;
        const fotoAbsoluta = foto ? (foto.startsWith('http') ? foto : `https://www.frazaoleiloes.com.br${foto}`) : null;

        imoveis.push({
          fonte: 'FRAZAO',
          fonte_id: `frazao_${id}`,
          titulo: titulo.slice(0, 120) || `Imóvel Frazão ${id}`,
          tipo: normalizarTipo(titulo),
          modalidade: titulo.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
          estado,
          cidade,
          bairro: '',
          endereco: '',
          valor_avaliacao: aval,
          valor_minimo: valor,
          area_m2: area,
          descricao: titulo.slice(0, 300),
          link_edital: linkAbsoluto,
          link_foto: fotoAbsoluta,
          leiloeiro: 'Frazão Leilões',
          data_leilao: null,
          forma_pagamento: null,
        });
      }

      // Fallback por links diretos se regex de card não pegou nada
      if (imoveis.length === 0) {
        const linkRegex = /href="(https?:\/\/(?:www\.)?frazaoleiloes\.com\.br\/[^"]+)"/gi;
        let lm;
        while ((lm = linkRegex.exec(html)) !== null && imoveis.length < 100) {
          const href = lm[1];
          if (seen.has(href) || !href.match(/lote|imovel|produto|leilao/i)) continue;
          seen.add(href);
          const ctx = html.slice(Math.max(0, html.indexOf(href) - 300), html.indexOf(href) + 300);
          const valorMatch = ctx.match(/R\$\s*([\d.,]+)/);
          const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.')) : 0;
          if (!valor) continue;
          const titulo = ctx.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1]?.replace(/<[^>]+>/g, '').trim() || '';
          const id = href.replace(/[?#].*/, '').split('/').filter(Boolean).pop();
          imoveis.push({
            fonte: 'FRAZAO',
            fonte_id: `frazao_${id}`,
            titulo: titulo.slice(0, 120) || `Imóvel Frazão ${id}`,
            tipo: normalizarTipo(titulo),
            modalidade: 'extrajudicial',
            estado: 'SP',
            cidade: '',
            bairro: '',
            endereco: '',
            valor_avaliacao: 0,
            valor_minimo: valor,
            area_m2: 0,
            descricao: '',
            link_edital: href,
            link_foto: null,
            leiloeiro: 'Frazão Leilões',
            data_leilao: null,
            forma_pagamento: null,
          });
        }
      }

      console.log(`    Frazão p${page} [${url}]: ${imoveis.length} imóveis`);
      return imoveis;
    } catch (err) {
      console.log(`    Frazão tentativa falhou [${url}]: ${err.message.slice(0, 80)}`);
    }
  }
  console.log(`    Frazão p${page}: todas as URLs falharam`);
  return [];
}

// ─── SCRAPER SOLD LEILÕES ─────────────────────────────────────────────────────

async function scraperSold(page = 1) {
  console.log(`  Sold Leilões página ${page}...`);
  try {
    // Sold Leilões tem API JSON acessível via query params
    const url = `https://www.sold.com.br/api/v1/lots?category_ids=1&status=open&page=${page}&per_page=50&order=relevance`;
    const data = await fetchJson(url, {
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://www.sold.com.br/leiloes-de-imoveis',
        'x-requested-with': 'XMLHttpRequest',
      },
    });

    const lots = data?.lots || data?.data || data?.results || data?.items || [];
    if (!lots.length) {
      console.log(`    Sold p${page}: nenhum resultado. Keys: ${JSON.stringify(Object.keys(data || {})).slice(0,80)}`);
      // Tenta HTML scraping como fallback
      return await scraperSoldHtml(page);
    }

    const imoveis = lots.map(lot => {
      const loc = lot.location || lot.address || {};
      return {
        fonte: 'SOLD',
        fonte_id: `sold_${lot.id || lot.lot_id}`,
        titulo: lot.title || lot.name || `Imóvel Sold ${lot.id}`,
        tipo: normalizarTipo(lot.title || lot.category),
        modalidade: (lot.judicial || lot.type === 'judicial') ? 'judicial' : 'extrajudicial',
        estado: loc.state || lot.state || '',
        cidade: loc.city || lot.city || '',
        bairro: loc.neighborhood || lot.neighborhood || '',
        endereco: loc.street || lot.address_street || '',
        valor_avaliacao: parseFloat(lot.appraisal_value || lot.evaluation || 0),
        valor_minimo: parseFloat(lot.minimum_bid || lot.initial_bid || lot.price || 0),
        area_m2: parseFloat(lot.area || lot.useful_area || 0),
        descricao: (lot.description || '').replace(/<[^>]+>/g,'').slice(0, 500),
        link_edital: lot.url || `https://www.sold.com.br/lote/${lot.id}`,
        link_foto: lot.image || lot.thumbnail || lot.photo || null,
        leiloeiro: lot.auctioneer?.name || lot.company || 'Sold Leilões',
        data_leilao: lot.end_date || lot.auction_date || null,
        forma_pagamento: 'a_vista',
      };
    }).filter(im => im.valor_minimo > 0);

    console.log(`    Sold p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch {
    return await scraperSoldHtml(page);
  }
}

async function scraperSoldHtml(page = 1) {
  try {
    const url = `https://www.sold.com.br/leiloes-de-imoveis?page=${page}`;
    const html = await fetchHtml(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-Mode': 'navigate',
        'Upgrade-Insecure-Requests': '1',
      },
    });

    if (html.length < 500 || html.includes('403') || html.includes('Access Denied')) {
      console.log(`    Sold HTML p${page}: bloqueado (${html.length} bytes)`);
      return [];
    }

    const imoveis = [];
    const seen = new Set();
    // Extrai por link (mais robusto que regex de card com nesting)
    const linkRegex = /href="([^"]*\/(?:lote|lot)\/[^"?#]+)"/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null && imoveis.length < 100) {
      const href = m[1].split('?')[0];
      if (seen.has(href)) continue;
      seen.add(href);
      const pos = html.indexOf(m[0]);
      const ctx = html.slice(Math.max(0, pos - 400), pos + 700);
      const titulo = ctx.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
      const valorMatch = ctx.match(/R\$\s*([\d.]+,\d{2})/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;
      const foto = ctx.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || null;
      const id = href.split('/').filter(Boolean).pop();
      imoveis.push({
        fonte: 'SOLD',
        fonte_id: `sold_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Sold ${id}`,
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
        link_edital: href.startsWith('http') ? href : `https://www.sold.com.br${href}`,
        link_foto: foto ? (foto.startsWith('http') ? foto : `https://www.sold.com.br${foto}`) : null,
        leiloeiro: 'Sold Leilões',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    Sold HTML p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Sold HTML p${page}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER BANCO DO BRASIL (Seu Imóvel BB) ──────────────────────────────────

async function scraperBancoBrasil(page = 0) {
  console.log(`  Banco do Brasil página ${page + 1}...`);
  try {
    // API pública do Seu Imóvel BB — tenta www42 (domínio histórico) e www47 (alternativo)
    // Ambos apontam para o portal de imóveis do BB
    const url = `https://www42.bb.com.br/portalbb/imoveisRecurso/imoveis/listar,802,0,0.bbx?page=${page}&size=50&tipoOferta=1,2,3`;
    const data = await fetchJson(url, {
      headers: {
        'Accept': 'application/json',
        'Referer': 'https://www42.bb.com.br/portalbb/imoveis/',
        'Origin': 'https://www42.bb.com.br',
      },
    });

    const lista = data?.listaImoveis || data?.imoveis || data?.content || data?.data || data?.results || [];
    if (!lista.length) {
      // Tenta endpoint alternativo
      return await scraperBancoBrasilAlt(page);
    }

    const imoveis = lista.map(im => {
      const tipo = im.tipoImovel || im.descTipoImovel || '';
      const modalidade = im.modalidadeVenda || im.descModalidade || '';
      const preco = parseFloat(im.precoVenda || im.vlrVenda || im.valorVenda || im.preco || 0);
      const aval = parseFloat(im.valorAvaliacao || im.vlrAvaliacao || 0);
      return {
        fonte: 'BB',
        fonte_id: `bb_${im.codImovel || im.id || im.numeroImovel}`,
        titulo: `${tipo} — ${im.bairro || ''} ${im.cidade || ''} ${im.uf || ''}`.trim(),
        tipo: normalizarTipo(tipo),
        modalidade: modalidade.toLowerCase().includes('leil') ? 'judicial' : 'extrajudicial',
        estado: im.uf || im.estado || '',
        cidade: toTitleCase(im.cidade || im.municipio || ''),
        bairro: toTitleCase(im.bairro || ''),
        endereco: toTitleCase(im.logradouro || im.endereco || ''),
        valor_avaliacao: aval,
        valor_minimo: preco,
        area_m2: parseFloat(im.areaTotal || im.area || 0),
        descricao: im.descricao || im.complemento || '',
        link_edital: im.linkAcesso || im.urlImovel || (im.codImovel ? `https://www42.bb.com.br/portalbb/imoveis/imovel/${im.codImovel}` : null),
        link_foto: im.foto || im.urlFoto || im.imagemPrincipal || null,
        leiloeiro: 'Banco do Brasil',
        data_leilao: im.dataLeilao || im.dtLeilao || null,
        forma_pagamento: normalizarPagamento(modalidade),
      };
    }).filter(im => im.valor_minimo > 0 && im.fonte_id !== 'bb_undefined');

    console.log(`    Banco do Brasil p${page + 1}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch {
    return await scraperBancoBrasilAlt(page);
  }
}

async function scraperBancoBrasilAlt(page = 0) {
  try {
    // Endpoint alternativo com offset/limit (diferente de page/size)
    const offset = page * 50;
    const url = `https://www42.bb.com.br/portalbb/imoveisRecurso/imoveis/listar,802,0,0.bbx?offset=${offset}&limit=50`;
    const data = await fetchJson(url, {
      headers: { 'Accept': 'application/json', 'Referer': 'https://www42.bb.com.br/portalbb/imoveis/' },
    });
    const lista = data?.listaImoveis || data?.imoveis || data?.content || [];
    if (!lista.length) {
      // Tenta scraping HTML do seuimovelbb.com.br
      return await scraperSeuImovelBB(page);
    }
    return lista.map(im => ({
      fonte: 'BB',
      fonte_id: `bb_${im.codImovel || im.id}`,
      titulo: `${im.tipoImovel || 'Imóvel'} BB — ${im.cidade || ''} ${im.uf || ''}`.trim(),
      tipo: normalizarTipo(im.tipoImovel),
      modalidade: 'extrajudicial',
      estado: im.uf || '',
      cidade: toTitleCase(im.cidade || ''),
      bairro: toTitleCase(im.bairro || ''),
      endereco: '',
      valor_avaliacao: parseFloat(im.valorAvaliacao || 0),
      valor_minimo: parseFloat(im.precoVenda || im.valorVenda || 0),
      area_m2: parseFloat(im.areaTotal || 0),
      descricao: im.descricao || '',
      link_edital: im.codImovel ? `https://www42.bb.com.br/portalbb/imoveis/imovel/${im.codImovel}` : null,
      link_foto: im.foto || null,
      leiloeiro: 'Banco do Brasil',
      data_leilao: null,
      forma_pagamento: 'a_vista',
    })).filter(im => im.valor_minimo > 0 && im.link_edital);
  } catch {
    return await scraperSeuImovelBB(page);
  }
}

async function scraperSeuImovelBB(page = 0) {
  try {
    const url = `https://www.seuimovelbb.com.br/imoveis?pagina=${page + 1}`;
    const html = await fetchHtml(url, {
      headers: { 'Referer': 'https://www.seuimovelbb.com.br/' },
    });
    const imoveis = [];
    const seen = new Set();
    const cardRegex = /<(?:article|div)[^>]*class="[^"]*(?:card|item|produto|imovel)[^"]*"[^>]*>([\s\S]*?)<\/(?:article|div)>/gi;
    let m;
    while ((m = cardRegex.exec(html)) !== null && imoveis.length < 30) {
      const card = m[1];
      const href = card.match(/href="([^"]*(?:imovel|lote|detalhe)[^"]*)"/i)?.[1] || '';
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const titulo = card.match(/<h[2-4][^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
      const valorMatch = card.match(/R\$\s*([\d.,]+)/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;
      const foto = card.match(/<img[^>]*(?:src|data-src)="([^"]+)"/i)?.[1] || null;
      const id = href.split('/').filter(Boolean).pop().split('?')[0];
      imoveis.push({
        fonte: 'BB',
        fonte_id: `bb_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel BB ${id}`,
        tipo: normalizarTipo(titulo),
        modalidade: 'extrajudicial',
        estado: '',
        cidade: '',
        bairro: '',
        endereco: '',
        valor_avaliacao: 0,
        valor_minimo: valor,
        area_m2: 0,
        descricao: titulo.slice(0, 300),
        link_edital: href.startsWith('http') ? href : `https://www.seuimovelbb.com.br${href}`,
        link_foto: foto?.startsWith('http') ? foto : null,
        leiloeiro: 'Banco do Brasil',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    Seu Imóvel BB p${page + 1}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro BB: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER ELEILÕES ─────────────────────────────────────────────────────────

async function scraperELeiloes(page = 1) {
  console.log(`  eLeilões página ${page}...`);
  try {
    // Tenta URL de busca; se retornar vazio tenta URL de categoria direta
    const urls = [
      `https://www.eleiloes.com.br/busca?categoria=imoveis&pagina=${page}`,
      `https://www.eleiloes.com.br/imoveis?pagina=${page}`,
    ];
    let html = '';
    for (const u of urls) {
      html = await fetchHtml(u);
      if (html.length > 2000) break;
    }
    const imoveis = [];
    const seenHref = new Set();
    // Extrai links de lotes diretamente — mais robusto que regex de card aninhado
    const linkRegex = /href="([^"]*(?:lote|leilao|produto)\/[^"?#]+)"/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null && imoveis.length < 100) {
      const href = m[1].split('?')[0];
      if (seenHref.has(href)) continue;
      seenHref.add(href);
      // Pega contexto ao redor do link para extrair título e valor
      const pos = html.indexOf(m[0]);
      const ctx = html.slice(Math.max(0, pos - 400), pos + 600);
      const titulo = ctx.match(/<h[2-5][^>]*>([\s\S]*?)<\/h[2-5]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim()
        || ctx.match(/title="([^"]{5,})"/i)?.[1]
        || '';
      const valorMatch = ctx.match(/R\$\s*([\d.]+,\d{2})/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g,'').replace(',','.')) : 0;
      if (!valor) continue;
      const id = href.split('/').filter(Boolean).pop();
      const foto = ctx.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || null;
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
        link_foto: foto ? (foto.startsWith('http') ? foto : `https://www.eleiloes.com.br${foto}`) : null,
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

// ─── SCRAPER KC LEILÕES ───────────────────────────────────────────────────────

async function scraperKcLeiloes(page = 1) {
  console.log(`  KC Leilões página ${page}...`);
  try {
    const url = `https://www.kcleiloes.com.br/imoveis?page=${page}`;
    const html = await fetchHtml(url, { headers: { Referer: 'https://www.kcleiloes.com.br/' } });
    const imoveis = [];
    const seen = new Set();
    const linkRegex = /href="([^"]*\/(?:lote|imovel|leilao|produto)\/[^"?#]+)"/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null && imoveis.length < 100) {
      const href = m[1].split('?')[0];
      if (seen.has(href)) continue;
      seen.add(href);
      const pos = html.indexOf(m[0]);
      const ctx = html.slice(Math.max(0, pos - 400), pos + 700);
      const titulo = ctx.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/i)?.[1]?.trim() || '';
      const valorMatch = ctx.match(/R\$\s*([\d.]+,\d{2})/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.')) : 0;
      if (!valor) continue;
      const foto = ctx.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || null;
      const id = href.split('/').filter(Boolean).pop();
      imoveis.push({
        fonte: 'KCLEILOES',
        fonte_id: `kc_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel KC ${id}`,
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
        link_edital: href.startsWith('http') ? href : `https://www.kcleiloes.com.br${href}`,
        link_foto: foto ? (foto.startsWith('http') ? foto : `https://www.kcleiloes.com.br${foto}`) : null,
        leiloeiro: 'KC Leilões',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    KC Leilões p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro KC Leilões p${page}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER PÁTIO ROCHA ──────────────────────────────────────────────────────

async function scraperPatioRocha(page = 1) {
  console.log(`  Pátio Rocha página ${page}...`);
  try {
    const urls = [
      `https://www.patiorocha.com.br/leiloes/imoveis?page=${page}`,
      `https://www.patiorocha.com.br/imoveis?pagina=${page}`,
      `https://www.patiorocha.com.br/categorias/imoveis?page=${page}`,
    ];
    let html = '';
    for (const url of urls) {
      try {
        html = await fetchHtml(url, { headers: { Referer: 'https://www.patiorocha.com.br/' } });
        if (html.length > 1000) break;
      } catch { continue; }
    }
    if (!html) return [];
    const imoveis = [];
    const seen = new Set();
    const linkRegex = /href="([^"]*\/(?:lote|imovel|leilao|produto|lot)\d*[^"?#]*)"/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null && imoveis.length < 100) {
      const href = m[1].split('?')[0];
      if (seen.has(href) || href.length < 5) continue;
      seen.add(href);
      const pos = html.indexOf(m[0]);
      const ctx = html.slice(Math.max(0, pos - 400), pos + 700);
      const titulo = ctx.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/i)?.[1]?.trim() || '';
      const valorMatch = ctx.match(/R\$\s*([\d.]+,\d{2})/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.')) : 0;
      if (!valor) continue;
      const foto = ctx.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || null;
      const id = href.split('/').filter(Boolean).pop();
      imoveis.push({
        fonte: 'PATIOROCHA',
        fonte_id: `pr_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Pátio Rocha ${id}`,
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
        link_edital: href.startsWith('http') ? href : `https://www.patiorocha.com.br${href}`,
        link_foto: foto ? (foto.startsWith('http') ? foto : `https://www.patiorocha.com.br${foto}`) : null,
        leiloeiro: 'Pátio Rocha',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    Pátio Rocha p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Pátio Rocha p${page}: ${err.message.slice(0, 80)}`);
    return [];
  }
}

// ─── SCRAPER ALBERTO MACEDO ───────────────────────────────────────────────────

async function scraperAlbertoMacedo(page = 1) {
  console.log(`  Alberto Macedo página ${page}...`);
  try {
    const urls = [
      `https://www.albertomacedo.com.br/leiloes/imoveis?page=${page}`,
      `https://www.albertomacedo.com.br/imoveis?page=${page}`,
      `https://www.leiloeiro.com.br/leiloeiro/alberto-macedo?pagina=${page}`,
    ];
    let html = '';
    for (const url of urls) {
      try {
        html = await fetchHtml(url, { headers: { Referer: 'https://www.albertomacedo.com.br/' } });
        if (html.length > 1000) break;
      } catch { continue; }
    }
    if (!html) return [];
    const imoveis = [];
    const seen = new Set();
    const linkRegex = /href="([^"]*\/(?:lote|imovel|leilao|produto|lot)[^"?#]*)"/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null && imoveis.length < 100) {
      const href = m[1].split('?')[0];
      if (seen.has(href) || href.length < 5) continue;
      seen.add(href);
      const pos = html.indexOf(m[0]);
      const ctx = html.slice(Math.max(0, pos - 400), pos + 700);
      const titulo = ctx.match(/<h[2-4][^>]*>([^<]+)<\/h[2-4]>/i)?.[1]?.trim() || '';
      const valorMatch = ctx.match(/R\$\s*([\d.]+,\d{2})/);
      const valor = valorMatch ? parseFloat(valorMatch[1].replace(/\./g, '').replace(',', '.')) : 0;
      if (!valor) continue;
      const foto = ctx.match(/<img[^>]*(?:src|data-src)="([^"]+(?:jpg|jpeg|png|webp)[^"]*)"/i)?.[1] || null;
      const id = href.split('/').filter(Boolean).pop();
      const base = href.startsWith('http') ? '' : 'https://www.albertomacedo.com.br';
      imoveis.push({
        fonte: 'ALBERTOMACEDO',
        fonte_id: `am_${id}`,
        titulo: titulo.slice(0, 120) || `Imóvel Alberto Macedo ${id}`,
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
        link_edital: href.startsWith('http') ? href : `${base}${href}`,
        link_foto: foto ? (foto.startsWith('http') ? foto : `${base}${foto}`) : null,
        leiloeiro: 'Alberto Macedo',
        data_leilao: null,
        forma_pagamento: 'a_vista',
      });
    }
    console.log(`    Alberto Macedo p${page}: ${imoveis.length} imóveis`);
    return imoveis;
  } catch (err) {
    console.log(`    Erro Alberto Macedo p${page}: ${err.message.slice(0, 80)}`);
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

  // Remove campos internos não presentes no schema da tabela imoveis_leilao.
  // ATENÇÃO: dedup_chave NÃO é coluna — se vazar no payload, o PostgREST rejeita
  // o lote inteiro (400) e NADA é salvo (foi o que mantinha o acervo CEF sem atualizar).
  const rows = comViabilidade.map(({ raw: _raw, _foto_original: _fo, dedup_chave: _dc, ...rest }) => rest);

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
  const TODAS_UFS = ['SP','RJ','MG','BA','PR','RS','PE','CE','GO','SC','ES','MA','PA','PB','RN','MT','MS','PI','AL','SE','TO','DF','AC','AM','AP','RO','RR'];
  // UFS por env (botão "disparar por estado" do Admin → /api/trigger-scraper → workflow_dispatch)
  const ufs = (process.env.UFS
    ? process.env.UFS.split(',').map(s => s.trim().toUpperCase()).filter(u => TODAS_UFS.includes(u))
    : TODAS_UFS);
  if (ufs.length === 0) ufs.push(...TODAS_UFS);
  for (const uf of ufs) {
    const imoveis = await scraperCEFcsv(uf);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 800));
  }

  // 2. Superbid (API direta — 1450 imóveis paginados de 50 em 50)
  console.log('\n📋 Scraping Superbid...');
  for (let page = 1; page <= 15; page++) {
    const imoveis = await scraperSuperbid(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 2000));
  }

  // 3. Zukerman (judicial SP)
  console.log('\n📋 Scraping leiloeiros judiciais...');
  for (let page = 1; page <= 8; page++) {
    const zuk = await scraperZukerman(page);
    await salvarImoveis(zuk);
    total += zuk.length;
    if (zuk.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 4. Biassi (extrajudicial/judicial SP e outros estados)
  console.log('\n📋 Scraping Biassi...');
  for (let page = 1; page <= 8; page++) {
    const imoveis = await scraperBiassi(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 5. HastaPública (judicial)
  console.log('\n📋 Scraping HastaPública...');
  for (let page = 1; page <= 8; page++) {
    const imoveis = await scraperHastaPublica(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 6. Superbid URL alternativa
  console.log('\n📋 Scraping Superbid Alt...');
  for (let page = 1; page <= 15; page++) {
    const imoveis = await scraperSuperbidAlt(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 7. eLeilões
  console.log('\n📋 Scraping eLeilões...');
  for (let page = 1; page <= 8; page++) {
    const imoveis = await scraperELeiloes(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 8. Mega Leilões (por UF principal)
  console.log('\n📋 Scraping Mega Leilões...');
  const ufsMega = ['SP','RJ','MG','PR','RS','SC','GO','DF','BA','PE','CE','AM','PA','ES','PB','RN','AL','SE','PI','MT','MS','TO','RO','AC','AP','RR','MA'];
  for (const uf of ufsMega) {
    const imoveis = await scraperMegaLeiloes(uf);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 1200));
  }

  // 9. Sold Leilões
  console.log('\n📋 Scraping Sold Leilões...');
  for (let page = 1; page <= 10; page++) {
    const imoveis = await scraperSold(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 10. Frazão Leilões
  console.log('\n📋 Scraping Frazão Leilões...');
  for (let page = 1; page <= 4; page++) {
    const imoveis = await scraperFrazao(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 11. Banco do Brasil
  console.log('\n📋 Scraping Banco do Brasil...');
  for (let page = 0; page <= 10; page++) {
    const imoveis = await scraperBancoBrasil(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 12. KC Leilões
  console.log('\n📋 Scraping KC Leilões...');
  for (let page = 1; page <= 5; page++) {
    const imoveis = await scraperKcLeiloes(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 13. Pátio Rocha
  console.log('\n📋 Scraping Pátio Rocha...');
  for (let page = 1; page <= 5; page++) {
    const imoveis = await scraperPatioRocha(page);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    if (imoveis.length === 0) break;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 14. Alberto Macedo
  console.log('\n📋 Scraping Alberto Macedo...');
  for (let page = 1; page <= 5; page++) {
    const imoveis = await scraperAlbertoMacedo(page);
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
