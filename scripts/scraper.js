#!/usr/bin/env node
/**
 * Scraper diário de leilões imobiliários
 * Fontes: CEF, Sold.com.br, leiloeiros judiciais por estado
 * Roda via GitHub Actions todo dia às 6h BRT
 */

import { createClient } from '@supabase/supabase-js';
import https from 'https';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;
const CLAUDE_KEY   = process.env.CLAUDE_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const ESTADOS = ['SP','RJ','MG','BA','PR','RS','PE','CE','GO','SC','ES','MA','PA','PB','RN','MT','MS','PI','AL','RO','SE','TO','AM','AC','AP','RR','DF'];

// ─── UTILS ───────────────────────────────────────────────────────────────────

function fetchJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; TSNBot/1.0)',
        'Accept': 'application/json',
        ...options.headers,
      },
      timeout: 15000,
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { reject(new Error(`JSON parse error: ${data.slice(0,200)}`)); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function fetchHtml(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TSNBot/1.0)' },
      timeout: 15000,
    }, (res) => {
      // Segue redirecionamentos
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchHtml(res.headers.location).then(resolve).catch(reject);
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
  if (!CLAUDE_KEY) return { viavel: null, score: 0, motivo: 'Sem chave Claude' };

  const desconto = imovel.valorAvaliacao > 0
    ? ((1 - imovel.valorMinimo / imovel.valorAvaliacao) * 100).toFixed(1)
    : 0;

  // Critério rápido sem chamar Claude: desconto >= 30% é pré-viável
  if (desconto >= 40) return { viavel: true, score: 90, motivo: `Desconto de ${desconto}% sobre avaliação` };
  if (desconto >= 30) return { viavel: true, score: 70, motivo: `Desconto de ${desconto}% — avaliar custos` };
  if (desconto >= 20) return { viavel: null, score: 50, motivo: `Desconto de ${desconto}% — análise necessária` };
  return { viavel: false, score: 20, motivo: `Desconto insuficiente (${desconto}%)` };
}

// ─── SCRAPER CEF ─────────────────────────────────────────────────────────────

async function scraperCEF(estado) {
  const url = `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${estado}.json`;
  console.log(`  CEF ${estado}...`);

  try {
    const data = await fetchJson(url);
    const imoveis = Array.isArray(data) ? data : (data?.listaImoveis || data?.imoveis || []);

    return imoveis.slice(0, 50).map(im => ({
      fonte: 'CEF',
      fonte_id: `cef_${im.numeroCEF || im.numeroiep || im.idImovel || Math.random()}`,
      titulo: `${im.tipoImovel || 'Imóvel'} — ${im.bairro || ''} ${im.cidade || ''} ${estado}`.trim(),
      tipo: normalizarTipo(im.tipoImovel),
      modalidade: 'extrajudicial',
      estado,
      cidade: im.cidade || '',
      bairro: im.bairro || '',
      endereco: `${im.logradouro || ''} ${im.numero || ''}`.trim(),
      valor_avaliacao: parseFloat(im.valorAvaliacao?.replace?.(/[^\d,]/g,'')?.replace(',','.') || im.valorAvaliacao || 0),
      valor_minimo: parseFloat(im.valorMinimo?.replace?.(/[^\d,]/g,'')?.replace(',','.') || im.valorMinimo || 0),
      area_m2: parseFloat(im.areaTotal || im.area || 0),
      descricao: im.descricao || '',
      link_edital: im.linkEdital || `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${im.numeroCEF}`,
      link_foto: im.foto || im.urlFoto || null,
      leiloeiro: 'Caixa Econômica Federal',
      data_leilao: im.dataLeilao1 || im.dataLeilao || null,
      forma_pagamento: normalizarPagamento(im.modalidadeVenda),
      raw: JSON.stringify(im).slice(0, 500),
    })).filter(im => im.valor_minimo > 0);
  } catch (err) {
    console.log(`    Erro CEF ${estado}: ${err.message}`);
    return [];
  }
}

// ─── SCRAPER SOLD.COM.BR ─────────────────────────────────────────────────────

async function scraperSold(estado) {
  console.log(`  Sold ${estado}...`);
  try {
    const html = await fetchHtml(`https://www.sold.com.br/leiloes/imoveis?uf=${estado}&page=1`);
    const imoveis = [];

    // Extrai dados do JSON embutido na página (Next.js / __NEXT_DATA__)
    const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
    if (match) {
      const nextData = JSON.parse(match[1]);
      const lots = nextData?.props?.pageProps?.lots || nextData?.props?.pageProps?.items || [];

      for (const lot of lots.slice(0, 30)) {
        imoveis.push({
          fonte: 'SOLD',
          fonte_id: `sold_${lot.id || lot.lotId}`,
          titulo: lot.title || lot.name || `Imóvel ${estado}`,
          tipo: normalizarTipo(lot.type || lot.category),
          modalidade: lot.origin?.toLowerCase().includes('judicial') ? 'judicial' : 'extrajudicial',
          estado,
          cidade: lot.city || lot.address?.city || '',
          bairro: lot.neighborhood || '',
          endereco: lot.address?.street || '',
          valor_avaliacao: parseFloat(lot.appraisalValue || lot.evaluation || 0),
          valor_minimo: parseFloat(lot.currentBid || lot.startingBid || lot.minimumBid || 0),
          area_m2: parseFloat(lot.area || lot.totalArea || 0),
          descricao: lot.description || '',
          link_edital: `https://www.sold.com.br/lote/${lot.id || lot.slug}`,
          link_foto: lot.mainImage || lot.images?.[0] || null,
          leiloeiro: lot.auctioneer || 'SOLD Leilões',
          data_leilao: lot.auctionDate || lot.endDate || null,
          forma_pagamento: lot.paymentMethod || 'a_vista',
          raw: JSON.stringify(lot).slice(0, 500),
        });
      }
    }
    return imoveis.filter(im => im.valor_minimo > 0);
  } catch (err) {
    console.log(`    Erro Sold ${estado}: ${err.message}`);
    return [];
  }
}

// ─── SCRAPER LEILOEIROS JUDICIAIS (via sites das JUCAs) ──────────────────────

// Lista de leiloeiros oficiais com sites conhecidos e estruturados
const LEILOEIROS_JUDICIAIS = [
  {
    nome: 'Zukerman Leilões',
    estado: 'SP',
    url: 'https://www.zukerman.com.br/imoveis',
    parser: parseZukerman,
  },
  {
    nome: 'REM Leilões',
    estado: 'SP',
    url: 'https://www.remleiloes.com.br/imoveis',
    parser: parseGenerico,
  },
  {
    nome: 'Frazão Leilões',
    estado: 'PE',
    url: 'https://www.frazaoleiloes.com.br/imoveis',
    parser: parseGenerico,
  },
];

async function parseZukerman(html, leiloeiro) {
  const imoveis = [];
  // Extrai cards de imóveis do HTML do Zukerman
  const cardRegex = /<article[^>]*class="[^"]*lote[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let match;
  while ((match = cardRegex.exec(html)) !== null && imoveis.length < 20) {
    const card = match[1];
    const titulo = card.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]?.replace(/<[^>]+>/g,'').trim() || '';
    const valor = card.match(/R\$\s*([\d.,]+)/)?.[1]?.replace(/\./g,'')?.replace(',','.') || '0';
    const link = card.match(/href="([^"]+)"/)?.[1] || '';
    if (titulo && parseFloat(valor) > 0) {
      imoveis.push({
        fonte: 'JUDICIAL',
        fonte_id: `zuk_${link.split('/').pop()}`,
        titulo,
        tipo: normalizarTipo(titulo),
        modalidade: 'judicial',
        estado: leiloeiro.estado,
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
  return imoveis;
}

async function parseGenerico(html, leiloeiro) {
  // Parser genérico - extrai o que conseguir
  return [];
}

async function scraperJudicial(leiloeiro) {
  console.log(`  Judicial ${leiloeiro.nome}...`);
  try {
    const html = await fetchHtml(leiloeiro.url);
    return await leiloeiro.parser(html, leiloeiro);
  } catch (err) {
    console.log(`    Erro ${leiloeiro.nome}: ${err.message}`);
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

// ─── SALVAR NO SUPABASE ───────────────────────────────────────────────────────

async function salvarImoveis(imoveis) {
  if (imoveis.length === 0) return;

  // Avalia viabilidade de cada imóvel
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
  else console.log(`  ✅ ${comViabilidade.length} imóveis salvos`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🏠 TSN Scraper iniciado em ${new Date().toISOString()}\n`);

  let total = 0;

  // 1. CEF — todos os estados principais
  console.log('📋 Scraping CEF...');
  const estadosCEF = ['SP','RJ','MG','BA','PR','RS','PE','CE','GO','SC'];
  for (const estado of estadosCEF) {
    const imoveis = await scraperCEF(estado);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 1000)); // Rate limit
  }

  // 2. Sold.com.br — estados principais
  console.log('\n📋 Scraping Sold.com.br...');
  for (const estado of ['SP','RJ','MG','PR']) {
    const imoveis = await scraperSold(estado);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 1500));
  }

  // 3. Leiloeiros judiciais
  console.log('\n📋 Scraping leiloeiros judiciais...');
  for (const leiloeiro of LEILOEIROS_JUDICIAIS) {
    const imoveis = await scraperJudicial(leiloeiro);
    await salvarImoveis(imoveis);
    total += imoveis.length;
    await new Promise(r => setTimeout(r, 2000));
  }

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
