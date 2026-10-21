/**
 * VEÍCULOS DAS FONTES DO MOTOR (21/10, pedido do dono: "faça todos os veículos, começando pelos
 * maiores"). A varredura de 21/10 mediu ~3.000 veículos à venda em ~25 fontes e ZERO no acervo: o
 * motor de imóveis lê cada lote e descarta o que não é imóvel. Este coletor usa, de cada fonte, a
 * MESMA config do motor (buscador, enumeração, `parseDetalhe`, `montarRow`) e só troca o catálogo
 * pelo de veículos declarado em `cfg.veiculos`; a conversão para `veiculos_leilao` é
 * lib/veiculo-do-lote.mjs (pátio pelo classificador único; bem com o executado nunca é gravado).
 *
 * Uma fonte entra declarando na config:  veiculos: { catalogo, paginaParam?, maxPages?, extrairUrlsDeLote? }
 * (e, por tenant, `catalogoVeiculos` quando o caminho varia por site).
 *
 * Env: VEIC_FONTES (csv de chaves de config; vazio = todas que declaram `veiculos`) ·
 *      VEIC_MAX_LOTES (80 detalhes por tenant por rodada; os NOVOS primeiro) ·
 *      VEIC_DRYRUN (default '1' — grava só com '0') · VEIC_BD ('1' libera o Bright Data se a via
 *      grátis falhar; default: só grátis). Env infra: VITE_SUPABASE_URL, SUPABASE_SERVICE_KEY.
 */
import './lib/env-runner.mjs';
import { createClient } from '@supabase/supabase-js';
import { enumerar } from './lib/motor/runner.mjs';
import { criarMotorFetch } from './lib/motor/fetch-fonte.mjs';
import { criarMotorDom } from './lib/motor/fetch-dom.mjs';
import { criarMotorFirecrawl } from './lib/motor/fetch-firecrawl.mjs';
import { criarMotorApi } from './lib/motor/fetch-api.mjs';
import { veiculoDoLote } from './lib/veiculo-do-lote.mjs';
import { patioPreservado } from './lib/patio-veiculo.mjs';
import { registrarSaude } from './_saude-fonte.mjs';
import { FONTES_VEICULOS } from './lib/motor/fontes-veiculos.mjs';

const SB_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;
if (!SB_URL || !SB_KEY) { console.error('Faltam VITE_SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(SB_URL, SB_KEY);
const DRYRUN = process.env.VEIC_DRYRUN !== '0';
const MAX_LOTES = Number(process.env.VEIC_MAX_LOTES || 80);
const SEM_BD = process.env.VEIC_BD !== '1';
const PEDIDAS = String(process.env.VEIC_FONTES || '').split(',').map(s => s.trim()).filter(Boolean);

function criarMotor(cfg) {
  return cfg.fetch === 'dom' ? criarMotorDom(cfg.dom)
    : cfg.fetch === 'firecrawl' ? criarMotorFirecrawl(cfg.firecrawl)
    : cfg.fetch === 'api' ? criarMotorApi(cfg)
    : criarMotorFetch(cfg.chave);
}

// Grava em GRUPOS de mesmo conjunto de colunas: num upsert misto o PostgREST põe NULL na coluna que
// falta, e o lote cuja foto não veio nesta rodada perderia a que já tinha (regra do NORDESTE/Astavero).
async function gravar(rows) {
  const grupos = new Map();
  for (const r of rows) { const k = Object.keys(r).sort().join(','); (grupos.get(k) || grupos.set(k, []).get(k)).push(r); }
  let n = 0;
  for (const g of grupos.values()) {
    const { data, error } = await supabase.from('veiculos_leilao').upsert(g, { onConflict: 'fonte,fonte_id' }).select('id');
    if (error) throw new Error(`upsert veiculos: ${error.message}`);
    n += data?.length || 0;
  }
  return n;
}

async function coletarTenant(cfg, fetchFonte, tenant) {
  const v = cfg.veiculos;
  const cfgV = {
    ...cfg, catalogo: v.catalogo, paginaParam: v.paginaParam || cfg.paginaParam, maxPages: v.maxPages ?? cfg.maxPages ?? 3,
    parse: { ...cfg.parse, extrairUrlsDeLote: v.extrairUrlsDeLote || cfg.parse.extrairUrlsDeLote, urlCandidata: v.urlCandidata },
  };
  // O `catalogo` do tenant é o de IMÓVEIS (ex.: Viva/Jinkings no feed): para veículo vale o do bloco.
  const tenantV = { ...tenant, catalogo: tenant.catalogoVeiculos ?? v.catalogo };
  const en = await enumerar(fetchFonte, tenantV, cfgV, { maxPages: cfgV.maxPages, debug: false, semBD: SEM_BD });
  const urls = v.urlCandidata ? en.urls.filter(v.urlCandidata) : en.urls;
  const idDe = (u) => `${tenant.fonte.toLowerCase()}_veic_${cfg.parse.idDaUrl(u)}`;
  // Os NOVOS na frente; depois o mais antigo. Teto por rodada — o resto entra nas próximas.
  const ids = urls.map(idDe);
  const ant = new Map();
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await supabase.from('veiculos_leilao').select('fonte_id,atualizado_em,status_patio,status_patio_motivo')
      .eq('fonte', tenant.fonte).in('fonte_id', ids.slice(i, i + 200));
    if (error) { console.warn(`  [${tenant.fonte}] sem a idade dos já gravados (${error.message}) — ordem da página`); break; }
    for (const r of data || []) ant.set(r.fonte_id, r);
  }
  const alvo = [...urls].sort((a, b) => {
    const ia = ant.get(idDe(a))?.atualizado_em ?? null, ib = ant.get(idDe(b))?.atualizado_em ?? null;
    if (ia === null || ib === null) return (ia === null ? 0 : 1) - (ib === null ? 0 : 1);
    return ia < ib ? -1 : ia > ib ? 1 : 0;
  }).slice(0, MAX_LOTES);
  console.log(`[${tenant.fonte}] veículos: enumerados ${en.urls.length}${en.via ? ` (via ${en.via})` : ''} · no banco ${ant.size} · lendo ${alvo.length}`);

  const rows = []; const motivos = new Map(); let sem = 0, cota = 0;
  for (const url of alvo) {
    const r = await fetchFonte(url, { semBD: SEM_BD });
    if (r?.semCota) { cota = alvo.length - rows.length; console.log(`💰 [${tenant.fonte}] teto de orçamento — parei (não é regressão da fonte)`); break; }
    if (!r?.html) { sem++; continue; }
    const det = await cfg.parse.parseDetalhe(r.html, url, { fetchFonte, tenant });
    if (!det) { sem++; continue; }
    if (det.encerrado) { motivos.set('encerrado', (motivos.get('encerrado') || 0) + 1); continue; }
    const imo = cfg.parse.montarRow(url, det, tenant);
    // Gancho por fonte: o que a página de VEÍCULO tem e o parser de imóvel não lê (título real,
    // comitente, local). Só preenche o que veio — nunca troca dado lido por vazio.
    if (cfg.veiculos.complemento) {
      const c = cfg.veiculos.complemento(r.html) || {};
      if (c.titulo) imo.titulo = c.titulo;
      if (c.cidade && !imo.cidade) imo.cidade = c.cidade;
      if (c.estado && !imo.estado) imo.estado = c.estado;
      if (c.comitente) imo.descricao = `${imo.descricao || ''} Comitente: ${c.comitente}`.trim();
    }
    const { row, motivo } = veiculoDoLote(imo, { id: cfg.parse.idDaUrl(url), fonte: tenant.fonte });
    if (!row || motivo) { motivos.set(motivo, (motivos.get(motivo) || 0) + 1); continue; }
    const anterior = ant.get(row.fonte_id);
    if (patioPreservado(row, anterior)) { row.status_patio = anterior.status_patio; row.status_patio_motivo = anterior.status_patio_motivo; }
    rows.push(row);
    if (rows.length <= 5) console.log(`  [${DRYRUN ? 'seco' : 'ok'}] ${row.tipo_veiculo} · ${row.marca || '?'} ${row.modelo || ''} ${row.ano_modelo || ''} · R$ ${row.valor_minimo} · ${row.cidade || '?'}/${row.estado || '?'} · pátio ${row.status_patio}`);
  }
  // O motivo de cada descarte vai para o log: "N descartados" sozinho obriga outra rodada para saber o porquê.
  console.log(`[${tenant.fonte}] prontos ${rows.length} · sem detalhe ${sem}${[...motivos].map(([m, n]) => ` · ${m}: ${n}`).join('')}`);
  return { rows, enumerados: en.urls.length, fetchOk: en.fetchOk !== false, sem, cota };
}

async function main() {
  const fontes = FONTES_VEICULOS.filter(c => c.veiculos && (!PEDIDAS.length || PEDIDAS.includes(c.chave)));
  if (!fontes.length) { console.error(`nenhuma fonte com veículos para: ${PEDIDAS.join(',') || '(todas)'}`); process.exit(1); }
  console.log(`VEÍCULOS (motor) ${DRYRUN ? '(SECO — não grava)' : '(GRAVANDO)'} · ${fontes.map(f => f.chave).join(', ')} · até ${MAX_LOTES}/tenant`);
  let falhou = false;
  for (const cfg of fontes) {
    const motor = criarMotor(cfg);
    try {
      for (const tenant of (cfg.veiculos.tenants || cfg.tenants)) {
        try {
          const r = await coletarTenant(cfg, motor.fetchFonte, tenant);
          if (!DRYRUN && r.rows.length) console.log(`✅ [${tenant.fonte}] ${await gravar(r.rows)} veículos gravados/atualizados.`);
          if (!DRYRUN) {
            await registrarSaude(supabase, `${tenant.fonte}_VEICULOS`, r.rows, cfg.chave, {
              ok: r.fetchOk && (r.rows.length > 0 || r.enumerados === 0), enumerados: r.enumerados, semCota: r.cota > 0,
              motivo: !r.fetchOk ? 'catálogo de veículos não abriu' : (r.enumerados && !r.rows.length ? `${r.enumerados} enumerados e nenhum gravado` : ''),
            });
          }
        } catch (e) {
          falhou = true;
          console.error(`[${tenant.fonte}] veículos falhou: ${e?.message || e}`);
          if (!DRYRUN) await registrarSaude(supabase, `${tenant.fonte}_VEICULOS`, [], cfg.chave, { ok: false, motivo: String(e?.message || e).slice(0, 200) }).catch((e2) => console.error(`  saúde não gravada: ${e2?.message || e2}`));
        }
      }
    } finally { await motor.fechar?.(); }
  }
  if (falhou) process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exit(1); });
