/**
 * Scraper ASTAVERO — 5 leiloeiros no mesmo backend (Damiani, Mazzolli, FB, DBS, Saulo Júlio), pela API
 * JSON da própria plataforma (POST, sem login, sem Cloudflare — custo Bright Data ZERO). Parser puro em
 * lib/astavero-json.mjs. Pendência #41 (recon 05/10: 89 imóveis em aberto, nenhum no acervo).
 *
 * Por execução e por leiloeiro: listagem de Imóveis e de Veículos (#139) + 1 `init` por leilão + 1 `lote` por lote.
 * Veículos vão para `veiculos_leilao` (fonte = a do leiloeiro; saúde em `<FONTE>_VEICULOS`).
 * Detalhe falhou → o lote entra com o que a listagem tem (cidade, valores, data, foto), sem inventar o resto.
 *
 * Env: ASTAVERO_DRYRUN (default '1') · ASTAVERO_TENANTS (csv de fontes, opcional) · VITE_SUPABASE_URL,
 * SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { TENANTS, CORPO_LISTAGEM, CORPO_LISTAGEM_VEICULOS, montarRowAstavero, montarRowVeiculoAstavero } from './lib/astavero-json.mjs';
import { marcaModeloAno, tipoVeiculo } from './lib/nordeste-veiculo.mjs';
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

// VIA BANCO para POST (05/10). Medido: o 1º dry-run pendurou no DETALHE — e não era o IP do runner, era o
// CORPO: sem `id` (= id do leilão) o servidor nunca responde, do runner ou do banco. Com `id` responde na
// hora (recon). A via banco fica como reserva para quando o runner for barrado de verdade. Mesmo desenho do `viaBanco` do motor, com o gêmeo POST
// `pagina_postar_json` (supabase/migrations/20261005_pagina_postar_json.sql); a resposta vem por `pagina_ler`.
async function rpc(fn, body) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${fn} HTTP ${r.status}: ${(await r.text().catch(() => '')).slice(0, 80)}`);
  return r.json();
}
async function postarViaBanco(url, corpo) {
  const id = await rpc('pagina_postar_json', { p_url: url, p_corpo: corpo });
  for (let i = 0; i < 30; i++) {
    await sleep(1000);
    const [row] = await rpc('pagina_ler', { p_id: id });
    if (!row?.pronto) continue;
    if (row.status >= 200 && row.status < 300 && row.conteudo) return row.conteudo;
    throw new Error(row.erro ? String(row.erro).slice(0, 60) : `HTTP ${row.status}`);
  }
  throw new Error('banco: sem resposta em 30 s');
}

const diretoFalhou = new Map();   // fonte → nº de falhas do fetch direto; 2+ = vai direto pelo banco
const vias = new Map();           // fonte → 'direto' | 'banco' (aparece no log e na saúde)
async function postar(tenant, caminho, corpo) {
  const url = `${tenant.base}${caminho}`;
  let corpoTxt = null, motivo = null;
  if ((diretoFalhou.get(tenant.fonte) || 0) < 2) {
    try {
      const r = await fetch(url, {
        method: 'POST', signal: AbortSignal.timeout(15000),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/plain, */*', 'User-Agent': UA, Origin: tenant.base, Referer: `${tenant.base}/` },
        body: JSON.stringify(corpo),
      });
      if (r.ok) { corpoTxt = await r.text(); vias.set(tenant.fonte, vias.get(tenant.fonte) || 'direto'); }
      else motivo = `HTTP ${r.status}`;
    } catch (e) { motivo = e?.name === 'TimeoutError' ? 'timeout 15 s' : String(e?.cause?.code || e?.message || e).slice(0, 60); }
    if (corpoTxt == null) diretoFalhou.set(tenant.fonte, (diretoFalhou.get(tenant.fonte) || 0) + 1);
  }
  if (corpoTxt == null) {
    try { corpoTxt = await postarViaBanco(url, corpo); vias.set(tenant.fonte, 'banco'); }
    catch (e) { throw new Error(`${caminho}: direto ${motivo || 'pulado'} · banco ${String(e?.message || e).slice(0, 60)}`, { cause: e }); }
  }
  let j = null; try { j = JSON.parse(corpoTxt); } catch { j = null; } // padrao-ok: corpo não-JSON é tratado logo abaixo como erro com motivo
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

// Detalhe de um lote: `init` uma vez por leilão (cache) + `lote` {id} por lote. Medido 05/10: o `lote` que
// vem no `init` é o 1º do leilão, NÃO o pedido — usá-lo copiaria a descrição do lote 01.1 em todos (forma
// nº 10). DISJUNTOR: 3 falhas seguidas e o resto entra só com a listagem, em vez de gastar 30 s × N lotes.
// Compartilhado por imóveis e veículos (mesmo leiloeiro, mesma API).
function criarLeitorDetalhe(tenant) {
  const leiloes = new Map();
  let seguidas = 0, falhas = 0;
  const ler = async (item) => {
    if (seguidas >= 3) { falhas++; return null; }
    try {
      if (!leiloes.has(item.leilao)) leiloes.set(item.leilao, (await postar(tenant, '/app/pregao/init', { id: item.leilao, leilao: item.leilao, lote: item.id }))?.leilao || null);
      const l = await postar(tenant, '/app/pregao/lote', { id: item.id });
      if (l?.lote?._id && l.lote._id !== item.id) throw new Error(`pedi ${item.id} e veio ${l.lote._id}`);
      seguidas = 0;
      return { leilao: leiloes.get(item.leilao), lote: l?.lote || null };
    } catch (e) {
      falhas++; seguidas++;
      if (falhas <= 3) console.log(`  [${tenant.fonte}] ${item.id}: detalhe não lido (${e.message})`);
      return null;
    } finally { await sleep(300); }
  };
  ler.falhas = () => falhas;
  return ler;
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
  console.log(`[${tenant.fonte}] via ${vias.get(tenant.fonte) || '?'} · listagem: ${itens.length} imóvel(is)${Number.isFinite(declarado) ? ` de ${declarado} declarados` : ''}`);

  const prontos = []; let descartados = 0, naoImovel = 0;
  const lerDetalhe = criarLeitorDetalhe(tenant);
  for (const item of itens) {
    const det = await lerDetalhe(item);
    if (det?.lote?.status && det.lote.status !== 'Aberto') { descartados++; continue; }
    const row = montarRowAstavero(item, det, tenant);
    if (naoEhImovel(`${row.titulo} ${row.descricao.slice(0, 600)}`)) { naoImovel++; continue; }
    if (checarQualidade(row, { estrito: false }).descartar) { descartados++; continue; }
    prontos.push(row);
  }
  const pct = (f) => Math.round((100 * prontos.filter(f).length) / Math.max(1, prontos.length));
  console.log(`[${tenant.fonte}] ${prontos.length} prontos · ${descartados} descartados · ${naoImovel} não-imóvel · ${lerDetalhe.falhas()} sem detalhe`
    + ` · cidade ${pct((r) => r.cidade && r.estado)}% · foto ${pct((r) => r.link_foto)}% · edital ${pct((r) => r.link_edital)}% · área ${pct((r) => r.area_m2 > 0)}% · 2ª praça ${pct((r) => r.valor_minimo_2)}%`);

  if (DRYRUN) {
    for (const r of prontos.slice(0, 2)) console.log(`   · ${r.fonte_id} | ${r.titulo.slice(0, 60)} | ${r.cidade}/${r.estado} | 1ª ${r.valor_minimo} · 2ª ${r.valor_minimo_2} | ${r.data_leilao?.slice(0, 10)} | ${r.modalidade} | mat ${r.numero_matricula} | área ${r.area_m2} | docs ${r.anexos?.map((a) => a.tipo).join(',') || '-'}`);
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
    custo: 'gratis', anti_bot: 'nenhum', enumeracao: 'POST /app/lotes {categoria:"Imóveis"} + /app/pregao/init por leilão + /app/pregao/lote {id} por lote',
    url_lote: '/pregao/<leilão>/<lote>', scraper: 'scraper-astavero.mjs', qualidade: qualidadeColeta(prontos) });
  return true;
}

// ── VEÍCULOS (#139) ──────────────────────────────────────────────────────────────────────────────────
async function coletarVeiculos(tenant) {
  const fonteSaude = `${tenant.fonte}_VEICULOS`;
  let lista;
  try { lista = await postar(tenant, '/app/lotes', CORPO_LISTAGEM_VEICULOS); }
  catch (e) {
    console.error(`[${tenant.fonte}] veículos: listagem falhou: ${e.message}`);
    if (!DRYRUN) await registrarSaude(supabase, fonteSaude, [], 'astavero-api', { ok: false, enumerados: 0, motivo: `listagem não abriu: ${e.message}` });
    return false;
  }
  const itens = Array.isArray(lista.lotes) ? lista.lotes : [];
  const declarado = Number(lista.pag?.count);
  const completa = !Number.isFinite(declarado) || itens.length >= declarado;
  const lerDetalhe = criarLeitorDetalhe(tenant);
  const prontos = []; let fora = 0, vencidos = 0;
  const limite = Date.now() - 86400000;
  for (const item of itens) {
    const det = await lerDetalhe(item);
    if (det?.lote?.status && det.lote.status !== 'Aberto') { fora++; continue; }
    const row = montarRowVeiculoAstavero(item, det, tenant, { marcaModeloAno, tipoVeiculo });
    if (!row.valor_minimo) { fora++; continue; }
    // Regra do dono (13/09): bem com o executado/devedor NUNCA é gravado — mesmo ponto de salvarVeiculos.
    if (row.status_patio === 'excluido') { fora++; continue; }
    // A plataforma mantém "Aberto" lote de leilão vencido há meses (visto nos imóveis): entra inativo.
    if (row.data_leilao && Date.parse(row.data_leilao) < limite) { row.ativo = false; vencidos++; }
    for (const k of ['fotos', 'anexos']) if (row[k] == null) delete row[k];   // null apagaria o que já existe
    prontos.push(row);
  }
  const pct = (f) => Math.round((100 * prontos.filter(f).length) / Math.max(1, prontos.length));
  console.log(`[${tenant.fonte}] veículos: ${itens.length} listados · ${prontos.length} prontos (${vencidos} vencidos → inativos) · ${fora} fora · ${lerDetalhe.falhas()} sem detalhe`
    + ` · pátio ${pct((r) => r.status_patio === 'confirmado')}%/selo ${pct((r) => r.status_patio === 'nao_confirmado')}% · marca ${pct((r) => r.marca)}% · ano ${pct((r) => r.ano_modelo)}% · placa ${pct((r) => r.placa)}% · foto ${pct((r) => r.fotos)}% · cidade ${pct((r) => r.cidade && r.estado)}%`);
  if (DRYRUN) {
    for (const r of prontos.slice(0, 3)) console.log(`   · ${r.fonte_id} | ${r.tipo_veiculo} | ${r.marca || '?'} ${r.modelo || ''} ${r.ano_fabricacao || '?'}/${r.ano_modelo || '?'} | placa ${r.placa || '—'} | R$ ${r.valor_minimo} / aval ${r.valor_avaliacao} | ${r.cidade}/${r.estado} | ${r.data_leilao?.slice(0, 10)} | sucata=${r.is_sucata} ativo=${r.ativo}`);
    return true;
  }
  if (prontos.length) {
    const grupos = new Map();
    for (const r of prontos) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
    let n = 0;
    for (const g of grupos.values()) {
      const { data, error } = await supabase.from('veiculos_leilao').upsert(g, { onConflict: 'fonte,fonte_id' }).select('id');
      if (error) throw new Error(`upsert veículos: ${error.message}`);
      n += data?.length || 0;
    }
    console.log(`✅ [${tenant.fonte}] ${n} veículos gravados/atualizados.`);
  }
  // Sumidos: só com listagem completa e ao menos metade do acervo ativo visto (mesma trava dos imóveis).
  if (completa) {
    const vistos = new Set(prontos.map((r) => r.fonte_id));
    const { data: ativos, error } = await supabase.from('veiculos_leilao').select('fonte_id').eq('fonte', tenant.fonte).eq('ativo', true);
    if (error) console.error(`  [${tenant.fonte}] veículos: varredura PULADA (${error.message})`);
    else if (vistos.size < (ativos?.length || 0) * 0.5) console.error(`  [${tenant.fonte}] veículos: 🛑 varredura PULADA — ${vistos.size} vistos de ${ativos.length} ativos`);
    else {
      const sumidos = (ativos || []).map((r) => r.fonte_id).filter((id) => !vistos.has(id));
      if (sumidos.length) {
        const { data, error: e } = await supabase.from('veiculos_leilao').update({ ativo: false })
          .eq('fonte', tenant.fonte).eq('ativo', true).in('fonte_id', sumidos).select('fonte_id');
        if (e) console.error(`  [${tenant.fonte}] veículos: erro ao desativar sumidos: ${e.message}`);
        else console.log(`  [${tenant.fonte}] veículos: ${sumidos.length} fora do site · ${data?.length || 0} desativados`);
      }
    }
  }
  // metricasColeta (_saude-fonte.mjs) já entende link_lote/fotos de veículo desde 05/10.
  await registrarSaude(supabase, fonteSaude, prontos.filter((r) => r.ativo), 'astavero-api', {
    ok: true, vazio: !itens.length, enumerados: itens.length, motivo: itens.length ? '' : 'site sem veículo em aberto' });
  return true;
}

async function main() {
  const alvos = TENANTS.filter((t) => !FILTRO.length || FILTRO.includes(t.fonte));
  console.log(`ASTAVERO ${DRYRUN ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · ${alvos.map((t) => t.fonte).join(', ')}`);
  let falhas = 0;
  for (const t of alvos) {
    if (!(await coletar(t))) falhas++;
    if (!(await coletarVeiculos(t))) falhas++;
  }
  if (DRYRUN) console.log('\nPara gravar, rode com ASTAVERO_DRYRUN=0.');
  if (falhas === alvos.length * 2) process.exitCode = 1;   // nenhum leiloeiro abriu: falha de verdade, não "vazio"
}

main().catch((e) => { console.error(e); process.exit(1); });
