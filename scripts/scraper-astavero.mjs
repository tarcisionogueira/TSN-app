/**
 * Scraper ASTAVERO — 5 leiloeiros no mesmo backend (Damiani, Mazzolli, FB, DBS, Saulo Júlio), pela API
 * JSON da própria plataforma (POST, sem login, sem Cloudflare — custo Bright Data ZERO). Parser puro em
 * lib/astavero-json.mjs. Pendência #41 (recon 05/10: 89 imóveis em aberto, nenhum no acervo).
 *
 * Por execução e por leiloeiro: 1 POST de listagem (categoria Imóveis) + 1 POST de detalhe por lote.
 * Detalhe falhou → o lote entra com o que a listagem tem (cidade, valores, data, foto), sem inventar o resto.
 *
 * Env: ASTAVERO_DRYRUN (default '1') · ASTAVERO_TENANTS (csv de fontes, opcional) · VITE_SUPABASE_URL,
 * SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { TENANTS, CORPO_LISTAGEM, montarRowAstavero } from './lib/astavero-json.mjs';
import { checarQualidade } from './lib/scraper-core.mjs';
import { naoEhImovel } from './lib/dom-parse-util.mjs';
import { registrarSaude } from './_saude-fonte.mjs';
import { registrarConhecimento, qualidadeColeta } from './lib/conhecimento.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);
const DRYRUN = process.env.ASTAVERO_DRYRUN !== '0';
const FILTRO = (process.env.ASTAVERO_TENANTS || '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postar(tenant, caminho, corpo) {
  const r = await fetch(`${tenant.base}${caminho}`, {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', 'User-Agent': UA, Origin: tenant.base, Referer: `${tenant.base}/` },
    body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`${caminho} HTTP ${r.status}`);
  const j = await r.json().catch(() => null);
  // A API devolve `erro: true` dentro de um 200 quando recusa (forma nº 1 do CLAUDE.md).
  if (!j || j.erro) throw new Error(`${caminho}: ${j ? `erro da API (${String(j.msg || j.message || 'sem mensagem').slice(0, 80)})` : 'resposta não é JSON'}`);
  return j;
}

async function varrerSumidos(tenant, vistos) {
  const { data: ativos, error } = await supabase.from('imoveis_leilao').select('fonte_id').eq('fonte', tenant.fonte).eq('ativo', true);
  if (error) { console.error(`  [${tenant.fonte}] varredura PULADA — acervo ativo ilegível (${error.message})`); return; }
  if (vistos.size < (ativos?.length || 0) * 0.5) { console.error(`  [${tenant.fonte}] 🛑 varredura PULADA — ${vistos.size} vistos de ${ativos.length} ativos (< 50%)`); return; }
  const sumidos = (ativos || []).map((r) => r.fonte_id).filter((id) => !vistos.has(id));
  if (!sumidos.length) return;
  const { data, error: e } = await supabase.from('imoveis_leilao').update({ ativo: false, suprimido_motivo: 'sumiu_da_fonte' })
    .eq('fonte', tenant.fonte).eq('ativo', true).in('fonte_id', sumidos).select('fonte_id');
  if (e) console.error(`  [${tenant.fonte}] erro ao desativar sumidos: ${e.message}`);
  else console.log(`  [${tenant.fonte}] ${sumidos.length} fora do site · ${data?.length || 0} desativados (sumiu_da_fonte)`);
}

// Upsert em grupos de MESMO conjunto de colunas (lote sem foto/anexos não pode apagar os de outro).
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

async function coletar(tenant) {
  let lista;
  try { lista = await postar(tenant, '/app/lotes', CORPO_LISTAGEM); }
  catch (e) {
    console.error(`[${tenant.fonte}] listagem falhou: ${e.message}`);
    if (!DRYRUN) await registrarSaude(supabase, tenant.fonte, [], 'astavero-api', { ok: false, enumerados: 0,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 }, motivo: `listagem não abriu: ${e.message}` });
    return false;
  }
  const itens = Array.isArray(lista.lotes) ? lista.lotes : [];
  const declarado = Number(lista.pag?.count);
  const completa = !Number.isFinite(declarado) || itens.length >= declarado;
  console.log(`[${tenant.fonte}] listagem: ${itens.length} imóvel(is)${Number.isFinite(declarado) ? ` de ${declarado} declarados` : ''}`);

  const prontos = []; let semDetalhe = 0, descartados = 0, naoImovel = 0;
  for (const item of itens) {
    let det = null;
    try { det = await postar(tenant, '/app/pregao/init', { leilao: item.leilao, lote: item.id }); }
    catch (e) { semDetalhe++; if (semDetalhe <= 3) console.log(`  [${tenant.fonte}] ${item.id}: detalhe não lido (${e.message})`); }
    await sleep(300);
    if (det?.lote?.status && det.lote.status !== 'Aberto') { descartados++; continue; }
    const row = montarRowAstavero(item, det, tenant);
    if (naoEhImovel(`${row.titulo} ${row.descricao.slice(0, 600)}`)) { naoImovel++; continue; }
    if (checarQualidade(row, { estrito: false }).descartar) { descartados++; continue; }
    prontos.push(row);
  }
  const pct = (f) => Math.round((100 * prontos.filter(f).length) / Math.max(1, prontos.length));
  console.log(`[${tenant.fonte}] ${prontos.length} prontos · ${descartados} descartados · ${naoImovel} não-imóvel · ${semDetalhe} sem detalhe`
    + ` · cidade ${pct((r) => r.cidade && r.estado)}% · foto ${pct((r) => r.link_foto)}% · edital ${pct((r) => r.link_edital)}% · área ${pct((r) => r.area_m2 > 0)}% · 2ª praça ${pct((r) => r.valor_minimo_2)}%`);

  if (DRYRUN) {
    console.log(JSON.stringify(prontos.slice(0, 2).map((r) => ({ ...r, descricao: r.descricao.slice(0, 120) })), null, 2));
    return true;
  }
  if (!prontos.length) {
    await registrarSaude(supabase, tenant.fonte, [], 'astavero-api', { ok: false, vazio: completa, enumerados: itens.length,
      metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
      motivo: itens.length ? `listou ${itens.length} e nenhum passou (${descartados} descartados, ${naoImovel} não-imóvel)` : 'site sem imóvel em aberto' });
    return true;
  }
  const n = await gravar(prontos);
  console.log(`✅ [${tenant.fonte}] ${n} imóveis gravados/atualizados.`);
  if (completa) await varrerSumidos(tenant, new Set(prontos.map((r) => r.fonte_id)));
  else console.log(`  [${tenant.fonte}] varredura PULADA — listagem parcial.`);
  await registrarSaude(supabase, tenant.fonte, prontos, 'astavero-api', { enumerados: itens.length });
  await registrarConhecimento(supabase, { fonte: tenant.fonte, plataforma: 'Astavero (Angular + API JSON)', acesso: 'fetch-post',
    custo: 'gratis', anti_bot: 'nenhum', enumeracao: 'POST /app/lotes {categoria:"Imóveis"} + POST /app/pregao/init por lote',
    url_lote: '/pregao/<leilão>/<lote>', scraper: 'scraper-astavero.mjs', qualidade: qualidadeColeta(prontos) });
  return true;
}

async function main() {
  const alvos = TENANTS.filter((t) => !FILTRO.length || FILTRO.includes(t.fonte));
  console.log(`ASTAVERO ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · ${alvos.map((t) => t.fonte).join(', ')}`);
  let falhas = 0;
  for (const t of alvos) if (!(await coletar(t))) falhas++;
  if (DRYRUN) console.log('\nPara gravar, rode com ASTAVERO_DRYRUN=0.');
  if (falhas === alvos.length) process.exitCode = 1;   // nenhum leiloeiro abriu: falha de verdade, não "vazio"
}

main().catch((e) => { console.error(e); process.exit(1); });
