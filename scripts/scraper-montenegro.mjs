/**
 * MONTENEGRO LEILÕES (Fortaleza/CE) — coletor pela API do próprio leiloeiro (11/11, 1ª conexão direta da BidPro).
 * Parser em lib/montenegro-api.mjs. Custo zero: fetch direto do runner; se o Cloudflare recusar, via banco (pg_net).
 *
 * Env: MONTENEGRO_DRYRUN (default '1' = não grava) · VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { FONTE, API, lotesDaApi } from './lib/montenegro-api.mjs';
import { ehFracaoIdeal } from './lib/scraper-core.mjs';
import { viaBanco } from './lib/motor/fetch-fonte.mjs';
import { registrarSaude } from './_saude-fonte.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);
const DRYRUN = process.env.MONTENEGRO_DRYRUN !== '0';
const UA = 'BidProBrasil-Integracao/1.0 (+https://www.bidprobrasil.com.br; contato@bidprobrasil.com.br)';

async function baixarApi() {
  let motivo;
  try {
    const r = await fetch(API, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
    if (r.ok) return { texto: await r.text(), via: 'direto' };
    motivo = `HTTP ${r.status}`;
  } catch (e) { motivo = String(e?.message || e).slice(0, 60); }
  const b = await viaBanco(API, { json: true });
  if (b.html) return { texto: b.html, via: 'banco' };
  throw new Error(`API não abriu — direto: ${motivo} · banco: ${b.motivo}`);
}

// Upsert em grupos de mesmo conjunto de colunas: num lote misto o PostgREST grava NULL na coluna que falta
// (apagaria o pino de lote cuja descrição não trouxe o mapa nesta rodada).
async function gravar(rows) {
  const grupos = new Map();
  for (const r of rows) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  let n = 0;
  for (const g of grupos.values()) {
    const { data, error } = await supabase.from('imoveis_leilao').upsert(g, { onConflict: 'fonte_id' }).select('fonte_id');
    if (error) throw new Error(`upsert: ${error.message}`);
    n += data?.length || 0;
  }
  return n;
}

// A API devolve a lista INTEIRA de abertos: lote ativo nosso que não veio mais saiu do site (vendido, retirado, praça
// vencida). Freio: lista com menos da metade do ativo não desliga nada (resposta truncada não aposenta acervo).
async function varrerSumidos(vistos) {
  const { data: ativos, error } = await supabase.from('imoveis_leilao').select('fonte_id').eq('fonte', FONTE).eq('ativo', true);
  if (error) { console.error(`  varredura PULADA — acervo ativo ilegível (${error.message})`); return; }
  if (vistos.size < (ativos?.length || 0) * 0.5) { console.error(`  🛑 varredura PULADA — ${vistos.size} vistos de ${ativos.length} ativos (< 50%)`); return; }
  const sumidos = (ativos || []).map((r) => r.fonte_id).filter((id) => !vistos.has(id));
  if (!sumidos.length) { console.log('  varredura: nenhum sumido'); return; }
  const { data, error: e } = await supabase.from('imoveis_leilao').update({ ativo: false, suprimido_motivo: 'sumiu_da_fonte' })
    .eq('fonte', FONTE).eq('ativo', true).in('fonte_id', sumidos).select('fonte_id');
  if (e) console.error(`  erro ao desativar sumidos: ${e.message}`);
  else console.log(`  varredura: ${sumidos.length} fora da API · ${data?.length || 0} desativados (sumiu_da_fonte)`);
}

async function main() {
  console.log(`${FONTE} ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'}`);
  let texto, via;
  try { ({ texto, via } = await baixarApi()); } catch (e) {
    console.error(`  ${e.message}`);
    if (!DRYRUN) await registrarSaude(supabase, FONTE, [], 'api-leiloeiro', { ok: false, enumerados: 0, metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 }, motivo: e.message.slice(0, 200) });
    process.exit(1);
  }
  const { rows: todas, resumo } = lotesDaApi(JSON.parse(texto));
  const rows = todas.filter((r) => !ehFracaoIdeal(r));
  console.log(`  via ${via} · ${resumo.leiloes} leilões · ${resumo.lotes} lotes · ${resumo.abertos} abertos · ${rows.length} prontos`
    + ` · ${resumo.semLocal} sem cidade/UF · ${resumo.semValor} sem lance · ${todas.length - rows.length} fração ideal · pino do mapa em ${resumo.comPino}`);
  if (DRYRUN) {
    console.log(JSON.stringify(rows.slice(0, 3).map((r) => ({ ...r, descricao: r.descricao.slice(0, 120) })), null, 2));
    console.log('\nPara gravar, rode com MONTENEGRO_DRYRUN=0.');
    return;
  }
  if (!rows.length) {
    // API respondeu ok e sem lote aberto = leiloeiro sem leilão agora (não é falha de coleta).
    await registrarSaude(supabase, FONTE, [], 'api-leiloeiro', { ok: false, vazio: true, enumerados: resumo.lotes,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 }, motivo: 'API do leiloeiro sem lote aberto' });
    return;
  }
  const n = await gravar(rows);
  console.log(`✅ ${n} imóveis gravados/atualizados.`);
  await varrerSumidos(new Set(rows.map((r) => r.fonte_id)));
  await registrarSaude(supabase, FONTE, rows, 'api-leiloeiro', { enumerados: resumo.lotes });
}

main().catch((e) => { console.error(e); process.exit(1); });
