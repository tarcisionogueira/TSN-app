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
const UFS = (process.env.UFS ? process.env.UFS.split(',') : TODAS_UFS).map(s => s.trim().toUpperCase());

const csvUrl = (uf) => `https://venda-imoveis.caixa.gov.br/listaweb/Lista_imoveis_${uf}.csv`;

async function baixarCsv(uf) {
  const resp = await fetch(csvUrl(uf), { headers: { 'User-Agent': 'Mozilla/5.0 TSN-Ativos-Scraper' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const buf = await resp.arrayBuffer();
  return new TextDecoder('iso-8859-1').decode(buf);
}

function parseLinha(cols) {
  // Layout Caixa: N° do imóvel; UF; Cidade; Bairro; Endereço; Preço; Valor de avaliação;
  // Desconto; Descrição; Modalidade de venda; Link de acesso
  const [numero, uf, cidade, bairro, endereco, preco, avaliacao, desconto, descricao, modalidade, link] = cols;
  const num = (v) => Number(String(v || '').replace(/[^\d,]/g, '').replace(',', '.')) || 0;
  const valorMin = num(preco);
  const valorAval = num(avaliacao);
  const desc = descricao || '';
  const modal = String(modalidade || '').trim();

  const fracionado = /fra[çc][ãa]o|fracion|ideal|cota|condom[íi]nio.*ideal/i.test(desc);

  let tipo = 'imovel';
  if (/apartamento|apto/i.test(desc)) tipo = 'apartamento';
  else if (/casa/i.test(desc)) tipo = 'casa';
  else if (/terreno|lote/i.test(desc)) tipo = 'terreno';
  else if (/comercial|loja|sala|gal[pã]/i.test(desc)) tipo = 'comercial';

  const aceitaFinanciamento = /financ|fgts|carta.*cr[eé]dito|cr[eé]dito.*carta/i.test(modal)
    || /financ|fgts/i.test(desc);
  const forma_pagamento = aceitaFinanciamento ? 'financiado' : 'a_vista';

  const modalidadeVenda = /judicial/i.test(modal) ? 'judicial'
    : /venda direta|direta online|direta/i.test(modal) ? 'venda_direta'
    : 'extrajudicial';

  // fonte_id aligned with scraper.js format to prevent duplicates
  const idLimpo = String(numero || '').trim().replace(/\s/g, '');

  return {
    fonte: 'CEF',
    fonte_id: `cef_${idLimpo}`,
    titulo: desc.slice(0, 120) || `Imóvel Caixa ${numero}`,
    tipo,
    modalidade: modalidadeVenda,
    estado: (uf || '').trim().toUpperCase(),
    cidade: (cidade || '').trim(),
    bairro: (bairro || '').trim(),
    endereco: (endereco || '').trim(),
    valor_avaliacao: valorAval,
    valor_minimo: valorMin,
    desconto_percentual: num(desconto),
    descricao: desc,
    url_lote: (link || '').trim(),
    link_edital: (link || '').trim(),
    leiloeiro: 'Caixa Econômica Federal',
    forma_pagamento,
    fracionado,
    ativo: true,
    atualizado_em: new Date().toISOString(),
  };
}

async function processarUf(uf) {
  let texto;
  try { texto = await baixarCsv(uf); }
  catch (e) { console.warn(`[${uf}] sem dados (${e.message})`); return 0; }

  const linhas = texto.split('\n');
  const idxHeader = linhas.findIndex(l => /N[º°o].*im[óo]vel|UF;Cidade/i.test(l));
  const dados = linhas.slice(idxHeader + 1).map(l => l.split(';')).filter(c => c.length >= 10 && c[0].trim());

  const registros = dados.map(parseLinha).filter(r => r.fonte_id && r.estado);
  if (registros.length === 0) { console.log(`[${uf}] 0 imóveis`); return 0; }

  let total = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const { error } = await supabase.from('imoveis_leilao').upsert(lote, { onConflict: 'fonte,fonte_id' });
    if (error) { console.error(`[${uf}] erro no lote ${i}:`, error.message); break; }
    total += lote.length;
  }
  console.log(`[${uf}] ${total} imóveis sincronizados`);
  return total;
}

async function desativarExpirados(fonteIds) {
  // Marca como inativo qualquer registro CEF que não veio no CSV atual
  if (fonteIds.size === 0) return;
  const { error } = await supabase
    .from('imoveis_leilao')
    .update({ ativo: false, atualizado_em: new Date().toISOString() })
    .eq('fonte', 'CEF')
    .not('fonte_id', 'in', `(${[...fonteIds].map(id => `'${id}'`).join(',')})`)
    .lt('atualizado_em', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());

  if (error) console.error('Erro ao desativar expirados:', error.message);
  else console.log('Imóveis expirados (>7 dias sem atualização) marcados como inativos.');
}

(async () => {
  console.log(`Scraper Caixa — ${UFS.length} estado(s): ${UFS.join(', ')}`);
  let total = 0;
  const todosIds = new Set();

  for (const uf of UFS) {
    let texto;
    try { texto = await baixarCsv(uf); }
    catch (e) { console.warn(`[${uf}] sem dados (${e.message})`); continue; }

    const linhas = texto.split('\n');
    const idxHeader = linhas.findIndex(l => /N[º°o].*im[óo]vel|UF;Cidade/i.test(l));
    const dados = linhas.slice(idxHeader + 1).map(l => l.split(';')).filter(c => c.length >= 10 && c[0].trim());
    const registros = dados.map(parseLinha).filter(r => r.fonte_id && r.estado);

    registros.forEach(r => todosIds.add(r.fonte_id));

    if (registros.length === 0) { console.log(`[${uf}] 0 imóveis`); continue; }

    let subtotal = 0;
    for (let i = 0; i < registros.length; i += 500) {
      const lote = registros.slice(i, i + 500);
      const { error } = await supabase.from('imoveis_leilao').upsert(lote, { onConflict: 'fonte,fonte_id' });
      if (error) { console.error(`[${uf}] erro no lote ${i}:`, error.message); break; }
      subtotal += lote.length;
    }
    console.log(`[${uf}] ${subtotal} imóveis sincronizados`);
    total += subtotal;
  }

  // Só desativa expirados se rodou todos os estados (para não desativar falsamente)
  if (UFS.length === TODAS_UFS.length) {
    await desativarExpirados(todosIds);
  }

  console.log(`✔ Concluído. ${total} imóveis no total.`);
})();
