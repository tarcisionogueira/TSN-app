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
import { veiculoDoLote, complementoGenerico } from './lib/veiculo-do-lote.mjs';
import { patioPreservado } from './lib/patio-veiculo.mjs';
import { registrarSaude } from './_saude-fonte.mjs';
import { classificarVazio, RECUSA_POR_REGRA } from './lib/veiculos-saude.mjs';
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
  // Blocos de 200 (22/10, Savoy ~2.400 de uma vez): o upsert inteiro passa pelos gatilhos de FIPE/motor/
  // pátio e estouraria o statement_timeout — o mesmo defeito que travou o coletor de imóveis em 22/10.
  for (const g of grupos.values()) {
    for (let i = 0; i < g.length; i += 200) {
      const { data, error } = await supabase.from('veiculos_leilao').upsert(g.slice(i, i + 200), { onConflict: 'fonte,fonte_id' }).select('id');
      if (error) throw new Error(`upsert veiculos: ${error.message}`);
      n += data?.length || 0;
    }
  }
  return n;
}

async function desligarSumidos(fonte, idsNoSite) {
  const ativos = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await supabase.from('veiculos_leilao').select('id,fonte_id').eq('fonte', fonte).eq('ativo', true)
      .like('fonte_id', `${fonte.toLowerCase()}_veic_%`).order('id').range(de, de + 999);
    if (error) { console.warn(`  [${fonte}] sumidos: leitura falhou (${error.message}) — pulado`); return; }
    ativos.push(...data);
    if (data.length < 1000) break;
  }
  const sumidos = ativos.filter((v) => !idsNoSite.has(v.fonte_id)).map((v) => v.id);
  if (!sumidos.length) return;
  // Freio: mais da metade do acervo "sumindo" de uma vez é mais provável lista parcial do que o site
  // ter esvaziado — não desliga, avisa.
  if (sumidos.length > Math.max(10, ativos.length / 2)) { console.warn(`  [${fonte}] sumidos: ${sumidos.length} de ${ativos.length} — demais para uma rodada, NÃO desligados (conferir a lista)`); return; }
  const { data, error } = await supabase.from('veiculos_leilao').update({ ativo: false }).in('id', sumidos).select('id');
  if (error) console.warn(`  [${fonte}] sumidos: desligamento falhou (${error.message})`);
  else console.log(`  [${fonte}] ${data.length} veículo(s) que saíram do site desligados`);
}

async function coletarTenant(cfg, fetchFonte, tenant) {
  const v = cfg.veiculos;
  const cfgV = {
    ...cfg, catalogo: v.catalogo, paginaParam: v.paginaParam || cfg.paginaParam, maxPages: v.maxPages ?? cfg.maxPages ?? 3,
    maxPagesEvento: v.maxPagesEvento ?? cfg.maxPagesEvento,
    parse: { ...cfg.parse, extrairUrlsDeLote: v.extrairUrlsDeLote || cfg.parse.extrairUrlsDeLote, detalhesDoCatalogo: v.detalhesDoCatalogo || cfg.parse.detalhesDoCatalogo, urlCandidata: v.urlCandidata,
      // Nível 2 só de veículo (26/10, Portal dos Leilões: o catálogo de veículo são os LEILÕES abertos).
      extrairUrlsDeEvento: v.extrairUrlsDeEvento || cfg.parse.extrairUrlsDeEvento },
  };
  // O `catalogo` do tenant é o de IMÓVEIS (ex.: Viva/Jinkings no feed): para veículo vale o do bloco.
  // `v.catalogos` (26/10): mais de um catálogo por site (Portal: leilões "em andamento" + "próximos" — o site não
  // tem filtro que traga os dois). Lista lida = a soma; um catálogo que não abre deixa a leitura incompleta.
  const catalogos = tenant.catalogoVeiculos != null ? [tenant.catalogoVeiculos] : (v.catalogos || [v.catalogo]);
  v.cobertura?.zerar();
  let en = null;
  for (const catalogo of catalogos) {
    const r = await enumerar(fetchFonte, { ...tenant, catalogo }, cfgV, { maxPages: cfgV.maxPages, debug: false, semBD: SEM_BD });
    if (!en) { en = { ...r, urls: [...r.urls] }; continue; }
    en.urls = [...new Set([...en.urls, ...r.urls])];
    for (const [u, d] of r.detCatalogo || []) en.detCatalogo.set(u, d);
    en.fetchOk = en.fetchOk && r.fetchOk; en.cortada = en.cortada || r.cortada; en.completa = en.completa && r.completa;
    en.via = en.via || r.via;
  }
  // COMPLETUDE (26/10, pedido do dono): fonte que declara `cobertura` só grava com o que leu ≥ 90% do que o site
  // DECLARA ter (Portal: cards lidos × "X de Y lotes" de cada evento aberto) e sem página/evento que não abriu.
  // Abaixo disso o lote não entra — melhor nenhum dado do que um recorte com cara de inteiro.
  if (v.cobertura) {
    const c = v.cobertura.medir();
    const pct = c.pct == null ? null : Math.round(c.pct * 1000) / 10;
    console.log(`[${tenant.fonte}] cobertura: ${c.lidos} cards lidos de ${c.declarado} que os ${c.eventos.length} evento(s) abertos declaram${pct != null ? ` (${pct}%)` : ''}${c.ocultos ? ` · ${c.ocultos} lote(s) anunciados ainda sem página no site` : ''}${en.cortada ? ` · CORTADA: ${en.cortada}` : ''}`);
    if (!en.fetchOk || en.cortada || (c.pct != null && c.pct < 0.9)) {
      const porque = !en.fetchOk ? 'catálogo de veículos não abriu' : en.cortada ? `lista incompleta (${en.cortada})` : `cobertura ${pct}% < 90%`;
      console.log(`  [${tenant.fonte}] NÃO grava: ${porque}`);
      return { rows: [], enumerados: en.urls.length, fetchOk: false, bloqueio: porque, sem: 0, cota: 0, porque, lidos: 0, porRegra: 0, idsEnumerados: new Set() };
    }
  }
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
    // Fonte cujo CATÁLOGO já traz o detalhe (Nakakogue: `detalhesDoCatalogo`) não abre a página do lote.
    const detPronto = en.detCatalogo?.get(url);
    const r = detPronto ? { html: null } : await fetchFonte(url, { semBD: SEM_BD });
    if (r?.semCota) { cota = alvo.length - rows.length; console.log(`💰 [${tenant.fonte}] teto de orçamento — parei (não é regressão da fonte)`); break; }
    if (!r?.html && !detPronto) { sem++; continue; }
    const det = detPronto || await (v.parseDetalhe || cfg.parse.parseDetalhe)(r.html, url, { fetchFonte, tenant });
    if (!det) { sem++; continue; }
    if (det.encerrado) { motivos.set('encerrado', (motivos.get('encerrado') || 0) + 1); continue; }
    const imo = cfg.parse.montarRow(url, det, tenant);
    // Gancho por fonte: o que a página de VEÍCULO tem e o parser de imóvel não lê (título real,
    // comitente, local). Só preenche o que veio — nunca troca dado lido por vazio.
    {
      // Sem gancho próprio, vale o genérico (rótulos "Marca/Modelo:", "Depósito:", "Descrição do lote").
      const c = r.html ? ((cfg.veiculos.complemento || complementoGenerico)(r.html) || {}) : {};
      if (c.ficha) imo.descricao = `${imo.titulo || ''} ${imo.descricao || ''} ${c.ficha}`.trim();
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
  // O porquê também vai para a saúde (22/10, FREITAS_VEICULOS "652 enumerados e nenhum gravado"): o log fica no PC
  // e, sem isto, descobrir o motivo exigia o dono copiar o terminal.
  const porque = [sem ? `sem detalhe ${sem}` : '', ...[...motivos].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([m, n]) => `${m}: ${n}`)].filter(Boolean).join(' · ');
  const lidos = rows.length + sem + [...motivos.values()].reduce((a, n) => a + n, 0);
  const porRegra = [...motivos].filter(([m]) => RECUSA_POR_REGRA.test(m)).reduce((a, [, n]) => a + n, 0);
  return { rows, enumerados: en.urls.length, fetchOk: en.fetchOk !== false, sem, cota, porque, lidos, porRegra, idsEnumerados: new Set(en.urls.map(idDe)) };
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
          // SUMIDOS (só fonte cujo catálogo vem INTEIRO numa chamada — `listaCompleta`): veículo ativo que
          // não está mais na lista saiu do site. Sem isto, lote sem data no card (Nakakogue) ficaria
          // ativo para sempre — o acervo inflado da varredura de 21/10 (VIP 107 × ~38 no site).
          // Só com a lista lida de verdade e não vazia: lista que não abriu NÃO é "tudo sumiu".
          if (!DRYRUN && cfg.veiculos.listaCompleta && r.fetchOk && r.idsEnumerados.size) await desligarSumidos(tenant.fonte, r.idsEnumerados);
          if (!DRYRUN) {
            const vazio = classificarVazio(r);
            await registrarSaude(supabase, `${tenant.fonte}_VEICULOS`, r.rows, cfg.chave, {
              ok: r.fetchOk && (r.rows.length > 0 || !!vazio), enumerados: r.enumerados, semCota: r.cota > 0, vazio: !!vazio,
              motivo: r.bloqueio ? `não gravado: ${r.bloqueio}` : !r.fetchOk ? 'catálogo de veículos não abriu' : (vazio || (r.enumerados && !r.rows.length ? `${r.enumerados} enumerados e nenhum gravado (${r.porque || 'sem motivo registrado'})`.slice(0, 300) : '')),
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
