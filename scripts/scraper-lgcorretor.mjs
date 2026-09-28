/**
 * Scraper LG CORRETOR JUDICIAL — alienação judicial por iniciativa particular (venda direta,
 * sem praça). Custo ZERO: HTML público renderizado pelo servidor, sem Bright Data e sem a API
 * `/api/*` do site (exige credencial — não é contornada). Parser em lib/lgcorretor-parse.mjs.
 *
 * Env: LGCORRETOR_DRYRUN (default '1' — só grava com '0') · VITE_SUPABASE_URL · SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { BASE, FONTE, extrairImoveis, extrairDocumentos, montarRow } from './lib/lgcorretor-parse.mjs';
import { ehFracaoIdeal } from './lib/scraper-core.mjs';
import { registrarSaude } from './_saude-fonte.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);
const DRYRUN = process.env.LGCORRETOR_DRYRUN !== '0';
const MAX_PAGINAS = 15;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function baixar(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR,pt;q=0.9' }, signal: AbortSignal.timeout(30000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} em ${url}`);
  return r.text();
}

// Enumeração COMPLETA = terminou numa página VAZIA (o site devolve a busca sem imóvel depois
// do fim). Falha de rede ou teto de páginas deixa `completa=false` — e aí a varredura de
// sumidos não roda, porque o que "sumiu" pode só não ter sido lido.
async function enumerar() {
  const porId = new Map();
  let completa = false, motivo = null;
  for (let pg = 1; pg <= MAX_PAGINAS; pg++) {
    let html;
    try { html = await baixar(`${BASE}/buscar?business=JUDICIAL&page=${pg}`); }
    catch (e) { motivo = `página ${pg}: ${String(e.message).slice(0, 80)}`; break; }
    const lote = extrairImoveis(html);
    if (!lote.length) { completa = true; break; }
    for (const p of lote) porId.set(p.id, p);
    await sleep(400);
  }
  return { imoveis: [...porId.values()], completa, motivo };
}

// O MESMO imóvel anunciado duas vezes (28/09: LGCJ-22039 e LGCJ-48492 = matrícula 11.963 de
// Jaú, republicado em 17/06). Chave = cidade + matrícula; fica o anúncio mais recente.
// Sem matrícula legível, não deduplica (Torrinha 2.764 × 2.765 são vizinhos, não cópia).
function semRepetidos(imoveis) {
  const porChave = new Map(); const sem = [];
  for (const p of imoveis) {
    const mat = (String(p.description || '').match(/matr[íi]cula[^0-9]{0,40}([\d.]{3,})/i) || [])[1];
    if (!mat) { sem.push(p); continue; }
    const k = `${p.citySlug || p.city}|${mat.replace(/\D/g, '')}`;
    const atual = porChave.get(k);
    const data = (x) => Date.parse(String(x.createdAt || '').replace(/^\$D/, '')) || 0;
    if (!atual || data(p) > data(atual)) porChave.set(k, p);
  }
  return [...porChave.values(), ...sem];
}

async function varrerSumidos(vistos) {
  const { data: ativos, error } = await supabase.from('imoveis_leilao').select('fonte_id').eq('fonte', FONTE).eq('ativo', true);
  if (error) { console.error(`  varredura PULADA — acervo ativo ilegível (${error.message})`); return; }
  if (vistos.size < (ativos?.length || 0) * 0.5) { console.error(`  🛑 varredura PULADA — ${vistos.size} vistos de ${ativos.length} ativos (< 50%)`); return; }
  const sumidos = (ativos || []).map((r) => r.fonte_id).filter((id) => !vistos.has(id));
  let desligados = 0;
  if (sumidos.length) {
    const { data, error: e } = await supabase.from('imoveis_leilao')
      .update({ ativo: false, suprimido_motivo: 'sumiu_da_fonte' })
      .eq('fonte', FONTE).eq('ativo', true).in('fonte_id', sumidos).select('fonte_id');
    if (e) console.error(`  erro ao desativar sumidos: ${e.message}`); else desligados = data?.length || 0;
  }
  console.log(`  varredura: ${sumidos.length} fora do site · ${desligados} desativados (sumiu_da_fonte)`);
}

async function main() {
  console.log(`LGCORRETOR ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'}`);
  const { imoveis, completa, motivo } = await enumerar();
  const unicos = semRepetidos(imoveis);
  console.log(`  enumerados ${imoveis.length} (${completa ? 'lista completa' : `PARCIAL — ${motivo || 'teto de páginas'}`}) · ${imoveis.length - unicos.length} anúncio(s) repetido(s)`);

  const prontos = []; let fracao = 0, semDoc = 0, invalidos = 0;
  for (const p of unicos) {
    const previa = montarRow(p, []);
    // Fração ideal fica fora do acervo (decisão de negócio — ver ehFracaoIdeal).
    if (ehFracaoIdeal(previa)) { fracao++; continue; }
    let docs = [];
    try { docs = extrairDocumentos(await baixar(previa.url_lote)); }
    catch (e) { semDoc++; console.log(`  ${p.code}: documentos não lidos (${String(e.message).slice(0, 60)}) — segue sem anexos`); }
    const row = montarRow(p, docs);
    if (!row.valor_minimo || !row.estado || !row.cidade) { invalidos++; continue; }
    prontos.push(row);
    await sleep(300);
  }
  console.log(`  ${prontos.length} prontos · ${fracao} fração ideal (fora) · ${invalidos} sem preço/local · ${semDoc} sem documentos`);

  if (DRYRUN) {
    console.log(JSON.stringify(prontos.slice(0, 3).map((r) => ({ ...r, descricao: r.descricao.slice(0, 120) })), null, 2));
    console.log('\nPara gravar, rode com LGCORRETOR_DRYRUN=0.');
    return;
  }
  // "Não achei nada" com a lista completa é medição; com a lista parcial é falha — e sai 1
  // para o check do workflow ficar vermelho em vez de verde sem ter gravado.
  if (!prontos.length) {
    await registrarSaude(supabase, FONTE, [], 'rsc-publico', {
      ok: false, vazio: completa, enumerados: imoveis.length,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: completa ? 'site sem imóvel judicial publicado' : `enumeração falhou (${motivo || 'teto de páginas'})`,
    });
    if (!completa) process.exitCode = 1;
    return;
  }
  const { data: gravados, error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id' }).select('fonte_id');
  if (error) { console.error('erro ao gravar:', error.message); process.exit(1); }
  console.log(`✅ ${gravados?.length ?? 0} imóveis gravados/atualizados.`);
  if (completa) await varrerSumidos(new Set(prontos.map((r) => r.fonte_id)));
  else console.log('  varredura PULADA — enumeração parcial.');
  await registrarSaude(supabase, FONTE, prontos, 'rsc-publico', { enumerados: imoveis.length });
  await registrarConhecimento(supabase, {
    fonte: FONTE, plataforma: 'Next.js (RSC público)', acesso: 'fetch-direto', custo: 'gratis',
    anti_bot: 'nenhum', enumeracao: '/buscar?business=JUDICIAL&page=N', url_lote: '/imovel/{uuid}',
    scraper: 'scraper-lgcorretor.mjs', qualidade: qualidadeColeta(prontos),
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
