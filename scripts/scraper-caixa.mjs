// ============================================================
// Scraper de imóveis da Caixa Econômica Federal
// Fonte oficial: CSVs públicos por estado em venda-imoveis.caixa.gov.br
// Roda diariamente via GitHub Actions e faz upsert no Supabase.
//
// Variáveis de ambiente necessárias:
//   SUPABASE_URL          (mesma de VITE_SUPABASE_URL)
//   SUPABASE_SERVICE_KEY  (chave service_role — bypassa RLS para escrita)
//   UFS                   (opcional, ex: "BA,SP,RJ"; padrão = todas)
// ============================================================
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Faltam SUPABASE_URL e/ou SUPABASE_SERVICE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const TODAS_UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'];
const UFS = (process.env.UFS ? process.env.UFS.split(',') : TODAS_UFS).map(s => s.trim().toUpperCase()).filter(s => TODAS_UFS.includes(s));

const CAIXA_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
  'Referer': 'https://venda-imoveis.caixa.gov.br/sistema/busca-imovel.asp',
};

// Parser CSV que respeita campos entre aspas (inclui campos com ";" internos)
function parseCsvLine(line, sep = ';') {
  const fields = [];
  let cur = '', inQuote = false;
  for (const ch of line) {
    if (ch === '"') { inQuote = !inQuote; }
    else if (ch === sep && !inQuote) { fields.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  fields.push(cur.trim());
  return fields;
}

function detectarSeparador(header) {
  const semis  = (header.match(/;/g)  || []).length;
  const commas = (header.match(/,/g) || []).length;
  return semis >= commas ? ';' : ',';
}

function parseNumeric(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.').trim());
  return isNaN(n) ? null : n;
}

function parseDesconto(str) {
  if (!str) return null;
  const n = parseFloat(String(str).replace('%', '').replace(',', '.').trim());
  return isNaN(n) ? null : n;
}

function inferirTipo(d = '') {
  d = d.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (d.includes('apartamento') || d.includes('apto')) return 'apartamento';
  if (d.includes('casa') || d.includes('sobrado') || d.includes('vila')) return 'casa';
  if (d.includes('terreno') || d.includes('lote') || d.includes('gleba')) return 'terreno';
  if (d.includes('galp') || d.includes('armazem') || d.includes('barracao')) return 'galpao';
  if (d.includes('rural') || d.includes('sitio') || d.includes('fazenda')) return 'rural';
  if (d.includes('vaga') || d.includes('box garage')) return 'vaga';
  if (d.includes('comercial') || d.includes('predio') || d.includes('pavilh')) return 'comercial';
  if (d.includes('sala') || d.includes('loja') || d.includes('conjunto')) return 'sala';
  return 'imovel';
}

function normalizarModalidade(m = '') {
  m = m.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (m.includes('venda') && m.includes('direta')) return 'venda_direta';
  if ((m.includes('1') || m.includes('primeiro') || m.includes('1a') || m.includes('1ª')) && (m.includes('praca') || m.includes('leilao'))) return 'primeiro_leilao';
  if ((m.includes('2') || m.includes('segundo') || m.includes('2a') || m.includes('2ª')) && (m.includes('praca') || m.includes('leilao'))) return 'segundo_leilao';
  if (m.includes('licitacao')) return 'licitacao_aberta';
  return m || null;
}

function extrairFormaPagamento(descricao = '', modalidade = '') {
  const t = `${descricao} ${modalidade}`.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  if (/hipotec|com onus|gravame/.test(t)) return 'hipotecado';
  if (/fgts|financiamento|financiado|parcelamento/.test(t)) return 'financiado';
  if (/a vista|avista|recursos proprios/.test(t)) return 'a_vista';
  return null;
}

async function baixarCsv(uf) {
  const urls = [
    `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`,
    `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf.toLowerCase()}.csv`,
  ];
  for (const url of urls) {
    const res = await fetch(url, { headers: CAIXA_HEADERS, signal: AbortSignal.timeout(30000) });
    if (!res.ok) continue;
    const buf  = await res.arrayBuffer();
    const bytes = new Uint8Array(buf);
    const hasBom = bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
    const text = new TextDecoder(hasBom ? 'utf-8' : 'windows-1252').decode(buf);
    if (text.length > 100) return text;
  }
  throw new Error('CSV não disponível (403/404)');
}

function csvToImoveis(csv, uf) {
  // Remove BOM e normaliza quebras de linha
  const clean = csv.replace(/^﻿/, '');
  const lines = clean.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim());
  if (lines.length < 2) return [];

  // Detectar separador e encontrar linha de header
  const sep = detectarSeparador(lines[0]);
  const idxHeader = lines.findIndex(l => /N[º°o].*im[óo]vel|UF.*Cidade/i.test(l));
  const inicio = idxHeader >= 0 ? idxHeader + 1 : 1;

  const imoveis = [];
  for (let i = inicio; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i], sep);
    if (cols.length < 5) continue;

    // Layout Caixa (14 colunas):
    // 0: N° imóvel  1: UF  2: Cidade  3: Bairro  4: Endereço
    // 5: Preço min  6: Avaliação  7: Desconto%  8: Descrição
    // 9: Modalidade  10: Link doc  11: Link foto
    // 12: Nome leiloeiro  13: Data leilão
    const numeroImovel  = cols[0]?.trim() || '';
    if (!numeroImovel) continue;

    const estado        = (cols[1]?.trim() || uf).toUpperCase();
    const cidade        = cols[2]?.trim() || '';
    const bairro        = cols[3]?.trim() || '';
    const endereco      = cols[4]?.trim() || '';
    const valorMinimo   = parseNumeric(cols[5]);
    const valorAval     = parseNumeric(cols[6]);
    const desconto      = parseDesconto(cols[7]);
    const descricao     = cols[8]?.trim() || '';
    const modalidadeRaw = cols[9]?.trim() || '';
    const linkDoc       = cols[10]?.trim() || '';
    const linkFoto      = cols[11]?.trim() || '';
    // col[12]: nome do leiloeiro (vazio = Caixa direta, preenchido = leiloeiro parceiro)
    const nomeLeiloeiro = cols[12]?.trim() || '';
    const dataLeilaoRaw = cols[13]?.trim() || '';

    const modalidade    = normalizarModalidade(modalidadeRaw);
    const ehVendaDireta = modalidade === 'venda_direta' || modalidadeRaw.toLowerCase().includes('venda');

    // Data do leilão (DD/MM/YYYY → YYYY-MM-DD)
    let dataLeilao = null;
    if (dataLeilaoRaw) {
      const m = dataLeilaoRaw.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
      if (m) dataLeilao = `${m[3]}-${m[2]}-${m[1]}`;
      else if (/^\d{4}-\d{2}-\d{2}/.test(dataLeilaoRaw)) dataLeilao = dataLeilaoRaw.slice(0, 10);
    }

    const fracionado = /fra[çc][ãa]o|fracion|ideal|cota/i.test(descricao);
    const idLimpo = numeroImovel.replace(/\s/g, '');

    imoveis.push({
      fonte: 'CEF',
      fonte_id: `cef_${idLimpo}`,
      titulo: descricao.slice(0, 120) || `Imóvel Caixa ${numeroImovel}`,
      tipo: inferirTipo(descricao),
      modalidade,
      estado,
      cidade,
      bairro,
      endereco,
      valor_avaliacao: valorAval,
      valor_minimo: valorMinimo,
      desconto_percentual: desconto != null ? Math.round(desconto) : null,
      descricao: descricao || null,
      // leiloeiro: nome real do col[12], ou CEF se venda direta / sem leiloeiro
      leiloeiro: nomeLeiloeiro || 'Caixa Econômica Federal',
      data_leilao: dataLeilao,
      link_edital:       ehVendaDireta ? null : (linkDoc || null),
      link_regras_venda: ehVendaDireta ? (linkDoc || null) : null,
      link_matricula: `https://venda-imoveis.caixa.gov.br/sistema/matricula.asp?hdniip=${numeroImovel}`,
      url_lote:       `https://venda-imoveis.caixa.gov.br/sistema/detalhe-imovel.asp?hdniip=${numeroImovel}`,
      link_foto: linkFoto || null,
      forma_pagamento: extrairFormaPagamento(descricao, modalidadeRaw),
      fracionado,
      ativo: true,
      atualizado_em: new Date().toISOString(),
    });
  }
  return imoveis;
}

async function desativarExpirados(todosIds) {
  if (todosIds.size === 0) return;
  const { error } = await supabase
    .from('imoveis_leilao')
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq('fonte', 'CEF')
    .not('fonte_id', 'in', `(${[...todosIds].map(id => `'${id}'`).join(',')})`)
    .lt('atualizado_em', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (error) console.error('Erro ao desativar expirados:', error.message);
  else console.log('Imóveis expirados (>7 dias) marcados como inativos.');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  console.log(`Scraper Caixa — ${UFS.length} estado(s): ${UFS.join(', ')}`);
  let totalGeral = 0;
  const todosIds = new Set();

  for (let i = 0; i < UFS.length; i++) {
    const uf = UFS[i];
    if (i > 0) await sleep(3000); // delay entre estados para não sobrecarregar

    process.stdout.write(`  [${uf}] baixando... `);
    let texto;
    try {
      texto = await baixarCsv(uf);
    } catch (e) {
      console.log(`❌ ${e.message}`);
      continue;
    }

    const imoveis = csvToImoveis(texto, uf);
    if (imoveis.length === 0) {
      const primeiraLinha = texto.split('\n')[0]?.slice(0, 120);
      console.log(`⚠️  0 imóveis. Header: ${primeiraLinha}`);
      continue;
    }

    // Contar leiloeiros distintos para log
    const leiloeiros = new Set(imoveis.map(im => im.leiloeiro));
    console.log(`${imoveis.length} imóveis (${leiloeiros.size} leiloeiro(s): ${[...leiloeiros].slice(0,3).join(', ')}${leiloeiros.size > 3 ? '...' : ''})`);

    imoveis.forEach(im => todosIds.add(im.fonte_id));

    // Upsert em lotes de 500
    let subtotal = 0;
    for (let j = 0; j < imoveis.length; j += 500) {
      const lote = imoveis.slice(j, j + 500);
      const { error } = await supabase.from('imoveis_leilao').upsert(lote, { onConflict: 'fonte,fonte_id' });
      if (error) { console.error(`  [${uf}] erro lote ${j}:`, error.message); break; }
      subtotal += lote.length;
    }
    totalGeral += subtotal;
  }

  // Desativa imóveis CEF que saíram do CSV há mais de 7 dias (só se rodou todos os estados)
  if (UFS.length === TODAS_UFS.length && todosIds.size > 0) {
    await desativarExpirados(todosIds);
  }

  console.log(`\n✅ Concluído. ${totalGeral.toLocaleString('pt-BR')} imóveis sincronizados.`);
})();
