/**
 * MOTOR — RUNNER único (Passo 0). Extrai o laço comum que scraper-leilaopro.mjs e
 * scraper-emiliomatos.mjs traziam duplicado: enumerar catálogo → dedup por fonte_id →
 * buscar detalhe → parsear → filtrar (encerrado/qualidade) → DRY-RUN ou upsert → saúde +
 * conhecimento. NADA de comportamento muda: é o mesmo fluxo do scraper-leilaopro (a versão
 * mais completa, com `fonteVazia`), agora parametrizado por uma CONFIG de fonte.
 *
 * Uma fonte declara (config):
 *   chave        — proposito do Bright Data + rótulo de log (ex.: 'leilaopro')
 *   catalogo     — caminho da listagem por categoria (ex.: '/leilao/lotes/imoveis')
 *   paginaParam  — 'pagina' | 'page' (a querystring de paginação da plataforma)
 *   tenants[]    — { fonte, leiloeiro, base } (1+ leiloeiros na mesma plataforma)
 *   parse        — { extrairUrlsDeLote, idDaUrl, parseDetalhe, montarRow, checarQualidade } (parser puro)
 *   conhecimento — metadados p/ registrarConhecimento (plataforma, anti_bot, url_lote, scraper…)
 */
import { registrarConhecimento, qualidadeColeta } from '../conhecimento.mjs';
import { registrarSaude } from '../../_saude-fonte.mjs';
import { criarMotorFetch } from './fetch-fonte.mjs';
import { criarMotorDom } from './fetch-dom.mjs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const idFonte = (tenant, id) => `${tenant.fonte.toLowerCase()}_${id}`;

// Enumera as URLs de lote do catálogo (pagina até MAX_PAGES ou até uma página não trazer nada
// novo — LeilãoPro é página única; Superbid pagina de verdade). `fetchOk` distingue "a listagem
// respondeu (fonte pode estar vazia)" de "não consegui buscar" (challenge/teto).
async function enumerar(fetchFonte, tenant, cfg, { maxPages, debug, semBD }) {
  const urls = new Map();
  let fetchOk = false, via = null;
  for (let p = 1; p <= maxPages; p++) {
    const url = `${tenant.base}${cfg.catalogo}${p > 1 ? `?${cfg.paginaParam}=${p}` : ''}`;
    const r = await fetchFonte(url, { semBD });
    if (!r.html) break;
    fetchOk = true; via = via || r.via;
    const antes = urls.size;
    for (const [id, u] of cfg.parse.extrairUrlsDeLote(r.html, tenant.base)) urls.set(id, u);
    if (debug) console.log(`   [${tenant.fonte}] pág ${p} (${r.via}): +${urls.size - antes} (total ${urls.size})`);
    if (urls.size === antes) break;
    await sleep(400);
  }

  // NÍVEL 2 (opcional — fontes em que o catálogo lista EVENTOS e o lote mora dentro, ex.:
  // nordeste: home → /leiloes/<evento> → lotes). `extrairUrlsDeEvento` devolve Map id→url de
  // evento; cada evento é buscado e passa pelo MESMO extrairUrlsDeLote. Falha de UM evento
  // não derruba a enumeração — mas zera o `fetchOk` só se NENHUMA página respondeu.
  if (cfg.parse.extrairUrlsDeEvento && fetchOk) {
    const r0 = await fetchFonte(`${tenant.base}${cfg.catalogo}`, { semBD });
    if (r0.html) {
      const eventos = [...cfg.parse.extrairUrlsDeEvento(r0.html, tenant.base).values()]
        .slice(0, cfg.maxEventos ?? 12);
      if (debug) console.log(`   [${tenant.fonte}] nível 2: ${eventos.length} evento(s)`);
      for (const ev of eventos) {
        const re = await fetchFonte(ev, { semBD });
        if (!re.html) continue;
        const antes = urls.size;
        for (const [id, u] of cfg.parse.extrairUrlsDeLote(re.html, tenant.base)) urls.set(id, u);
        if (debug) console.log(`   [${tenant.fonte}] evento ${ev.slice(-60)}: +${urls.size - antes}`);
        await sleep(400);
      }
    }
  }
  return { urls: [...urls.values()], fetchOk, via };
}

async function coletarTenant(supabase, fetchFonte, tenant, cfg, { maxLotes, debug, semBD }) {
  const { urls, fetchOk, via } = await enumerar(fetchFonte, tenant, cfg, { maxPages: cfg.maxPages, debug, semBD });
  console.log(`[${tenant.fonte}] enumerados ${urls.length} lote(s)${via ? ` (via ${via})` : ''}`);
  const prontos = []; let encerrados = 0, sem = 0, reprov = 0;
  if (urls.length) {
    const ids = urls.map(u => idFonte(tenant, cfg.parse.idDaUrl(u)));
    const existentes = new Set();
    for (let i = 0; i < ids.length; i += 200) {
      // padrao-ok: leitura best-effort de dedup; erro → reprocessa lote conhecido (upsert idempotente), nunca corrompe. Mesmo padrão dos scrapers de origem.
      const { data } = await supabase.from('imoveis_leilao').select('fonte_id').in('fonte_id', ids.slice(i, i + 200));
      for (const r of data || []) existentes.add(r.fonte_id);
    }
    const novos = urls.filter(u => !existentes.has(idFonte(tenant, cfg.parse.idDaUrl(u))));
    const alvo = (novos.length ? novos : urls).slice(0, maxLotes);
    console.log(`[${tenant.fonte}] no banco ${existentes.size} · novos ${novos.length} · processando ${alvo.length}`);
    for (const url of alvo) {
      const { html } = await fetchFonte(url, { semBD });
      if (!html) { sem++; continue; }
      const det = cfg.parse.parseDetalhe(html, url);
      if (det.encerrado) { encerrados++; continue; }
      const row = cfg.parse.montarRow(url, det, tenant);
      const q = cfg.parse.checarQualidade(row, { estrito: false });
      if (q.descartar) { reprov++; continue; }
      prontos.push(row);
      await sleep(350);
    }
  }
  console.log(`[${tenant.fonte}] ${prontos.length} prontos · ${encerrados} encerrados · ${reprov} descartados · ${sem} sem detalhe`);
  // fonteVazia = respondeu mas 0 lotes (não é falha: o leiloeiro só não tem imóveis agora).
  return { prontos, encerrados, fonteVazia: fetchOk && urls.length === 0, enumerados: urls.length };
}

// Roda a coleta de uma fonte inteira (todos os tenants). opts:
//   supabase, maxLotes, maxPages, dryrun, debug, exitCodeSeFalha (emiliomatos exigia exit 1).
export async function rodarFonte(cfg, opts) {
  const { supabase, maxLotes = 40, dryrun = true, debug = false, exitCodeSeFalha = false, semBD = false } = opts;
  const rotulo = (cfg.chave || 'fonte').toUpperCase();
  // Eixo de FETCH da matriz: 'dom' renderiza num Chromium (SPA sem SSR); default é o motor
  // grátis→Bright Data. O contrato é o mesmo; o runner não distingue.
  const motor = cfg.fetch === 'dom' ? criarMotorDom(cfg.dom) : criarMotorFetch(cfg.chave);
  const { fetchFonte, estado } = motor;
  cfg.maxPages = opts.maxPages ?? cfg.maxPages ?? 3;

  const tenants = opts.tenants || cfg.tenants;   // wrapper pode filtrar (ex.: LEILAOPRO_TENANTS)
  if (debug) { try { await debugRecon(fetchFonte, { ...cfg, tenants }); } finally { await motor.fechar?.(); } return; }
  try {
  console.log(`${rotulo} ${dryrun ? '(DRY-RUN — não grava)' : '(GRAVANDO)'} · tenants: ${tenants.map(t => t.fonte).join(',')} · max ${maxLotes}/tenant`);

  for (const tenant of tenants) {
    const { prontos, encerrados, fonteVazia, enumerados } = await coletarTenant(supabase, fetchFonte, tenant, cfg, { maxLotes, debug, semBD });

    if (!prontos.length) {
      if (fonteVazia) { console.log(`[${tenant.fonte}] sem imóveis no momento — fonte vazia (sem alarme).`); continue; }
      await registrarSaude(supabase, tenant.fonte, [], cfg.chave, {
        ok: false, semCota: estado.semCota, enumerados,
        metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
        motivo: estado.semCota
          ? 'SEM COTA Bright Data — coleta não tentada (orçamento, não regressão da fonte)'
          : (encerrados ? `sem lote pronto (${encerrados} encerrados)` : 'sem nenhum lote pronto'),
      });
      console.error(`[${tenant.fonte}] nada a gravar.${estado.semCota ? ' (sem cota Bright Data — orçamento, não regressão.)' : ''}`);
      if (exitCodeSeFalha) process.exitCode = 1;
      continue;
    }

    if (dryrun) {
      console.log(`[${tenant.fonte}] DRY-RUN amostra:`);
      console.log(JSON.stringify(prontos.slice(0, 3).map(r => ({ fonte_id: r.fonte_id, titulo: (r.titulo || '').slice(0, 50), cidade: r.cidade, estado: r.estado, aval: r.valor_avaliacao, min: r.valor_minimo, desc: r.desconto_percentual, area: r.area_m2 })), null, 2));
      continue;
    }

    const { error } = await supabase.from('imoveis_leilao').upsert(prontos, { onConflict: 'fonte_id', ignoreDuplicates: false });
    if (error) { console.error(`[${tenant.fonte}] erro ao gravar:`, error.message); process.exitCode = 1; continue; }
    console.log(`✅ [${tenant.fonte}] ${prontos.length} imóveis gravados/atualizados.`);
    await registrarSaude(supabase, tenant.fonte, prontos, cfg.chave, { enumerados });
    await registrarConhecimento(supabase, { fonte: tenant.fonte, ...cfg.conhecimento, qualidade: qualidadeColeta(prontos) });
  }
  if (dryrun) console.log(`\nPara gravar, rode com ${rotulo}_DRYRUN=0.`);
  } finally { await motor.fechar?.(); }
}

// Recon: enumera 1 tenant e disseca o 1º lote (o mesmo debugRecon dos scrapers de origem).
async function debugRecon(fetchFonte, cfg) {
  for (const tenant of cfg.tenants) {
    console.log(`\n🔎 ${tenant.fonte} RECON — ${tenant.base}${cfg.catalogo}`);
    const { urls } = await enumerar(fetchFonte, tenant, cfg, { maxPages: cfg.maxPages || 3, debug: true });
    console.log(`   ${urls.length} lote(s): ${JSON.stringify(urls.slice(0, 4))}`);
    if (urls[0]) {
      const { html, via } = await fetchFonte(urls[0]);
      if (html) {
        const det = cfg.parse.parseDetalhe(html, urls[0]);
        console.log(`   detalhe ${urls[0]} (via ${via}) →`, JSON.stringify({ ...det, anexos: (det.anexos || []).length + ' docs' }, null, 2));
      }
    }
  }
}
