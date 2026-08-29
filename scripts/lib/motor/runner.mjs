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
// `chaveTenant` (29/08): tenants que COMPARTILHAM a mesma `fonte` precisam de id distinto,
// senão o lote 100 do leiloeiro A sobrescreve o lote 100 do leiloeiro B — em silêncio, porque
// upsert por `fonte_id` não reclama de colisão, só apaga. É o modelo que o SUPORTE já usa
// (`sl_<tenant>_<id>`); sem `chaveTenant` o formato antigo continua valendo, intacto.
const idFonte = (tenant, id) => (tenant.chaveTenant
  ? `${tenant.fonte.toLowerCase()}_${tenant.chaveTenant}_${id}`
  : `${tenant.fonte.toLowerCase()}_${id}`);

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
      // ⚠️ O EVENTO TAMBÉM PAGINA (29/08). Isto lia UMA página por evento — o que bastava para o
      // NORDESTE, cujo evento cabe numa página. A HASTA quebrou essa premissa: o leilão 557 tem
      // ~579 lotes a 30/pág, e uma página só traria 30 — **coleta parcial com cara de completa**,
      // que é justamente o desfecho que o `fonte_saude` acusaria como regressão sem haver
      // regressão nenhuma. Que a plataforma pagina por `page` não é palpite: o `url_lote` que já
      // temos no acervo é `/item/10729/detalhes?page=20`, ou seja, o link veio da página 20.
      // O laço para sozinho quando uma página não traz id novo — então, se algum evento ignorar
      // o parâmetro, ele degrada para o comportamento antigo (1 página) em vez de repetir à toa.
      const maxPagEvento = cfg.maxPagesEvento ?? cfg.maxPages ?? 3;
      for (const ev of eventos) {
        const antesEvento = urls.size;
        for (let p = 1; p <= maxPagEvento; p++) {
          const sep = ev.includes('?') ? '&' : '?';
          const re = await fetchFonte(p > 1 ? `${ev}${sep}${cfg.paginaParam}=${p}` : ev, { semBD });
          if (!re.html) break;
          const antes = urls.size;
          for (const [id, u] of cfg.parse.extrairUrlsDeLote(re.html, tenant.base)) urls.set(id, u);
          if (debug) console.log(`   [${tenant.fonte}] evento ${ev.slice(-40)} pág ${p}: +${urls.size - antes} (total ${urls.size})`);
          if (urls.size === antes) break;
          await sleep(400);
        }
        if (!debug) console.log(`   [${tenant.fonte}] evento ${ev.slice(-40)}: +${urls.size - antesEvento}`);
        await sleep(400);
      }
    }
  }
  return { urls: [...urls.values()], fetchOk, via };
}

// A RELEITURA GASTA A SOBRA DO ORÇAMENTO, E SÓ ELA (29/08).
// `alvo` era `novos.length ? novos : urls` — tudo-ou-nada. Com a fonte já coletada, um punhado
// de lotes novos consumia `novos.length` do teto e **o resto do teto era jogado fora**: medido
// na HASTA, 5 lotes tocados em 36 h contra 584 ativos, os outros 579 com `atualizado_em` de
// 25/08. O preço que o cliente vê não depende disso (as duas praças já estão gravadas e
// `valor_minimo_ref` é `least(...)`), mas o lote cujo preço ou data MUDA na fonte nunca se
// atualiza enquanto houver lote novo aparecendo.
//
// A releitura entra DEPOIS dos novos e só até `maxLotes` — o teto declarado não muda, o que
// muda é não desperdiçar a folga. Duas garantias de custo, nesta ordem:
//   1. novo vem primeiro, então uma recusa de orçamento custa releitura, nunca lote novo;
//   2. `pararReleitura` — a releitura é abortada no instante em que um detalhe volta `via: 'bd'`.
//      **Releitura nunca paga.** Lote novo pode pagar (vale o crédito); relê-lo não vale, ainda
//      mais com o teto semanal saturado. É decisão MEDIDA por fetch, não adivinhada por fonte:
//      se a fonte deixar de ser desafiada, a releitura volta sozinha.
// Ordem da fila: praça próxima primeiro (é onde o dado muda), depois o mais velho — assim o
// acervo cicla inteiro em tempo limitado em vez de reler sempre os mesmos.
const DIAS_IMINENTE = 21;

/**
 * PLANEJA O QUE O RUN VAI BUSCAR — puro, exportado, e é isto que os testes exercitam.
 * A conta de orçamento é a parte que erra em silêncio (um off-by-one aqui gasta crédito ou
 * deixa de reler para sempre), então ela sai do laço de I/O e vira função testável em seco.
 * Devolve `iReleitura` = o índice a partir do qual `alvo` deixa de ser lote novo.
 */
export function planejarAlvo({ urls, meta, chaveDe, maxLotes, maxRefresh, agora = Date.now() }) {
  const novos = urls.filter(u => !meta.has(chaveDe(u)));
  const limite = agora + DIAS_IMINENTE * 864e5;
  const conhecidas = urls
    .filter(u => meta.has(chaveDe(u)))
    .map((u) => {
      const m = meta.get(chaveDe(u));
      return { url: u, id: m.fonte_id, tocado: Date.parse(m.atualizado_em) || 0,
               fim: m.data_fim ? Date.parse(m.data_fim) : null, ativo: m.ativo !== false };
    })
    .filter(c => c.ativo)              // lote já desativado não volta pela releitura
    .sort((a, b) => {
      // praça próxima primeiro (é onde o dado muda), depois o mais velho, e `id` só para
      // desempatar — sem ele a ordem varia entre runs e o acervo nunca cicla inteiro.
      const ia = a.fim && a.fim <= limite ? 0 : 1;
      const ib = b.fim && b.fim <= limite ? 0 : 1;
      if (ia !== ib) return ia - ib;
      return (a.tocado || 0) - (b.tocado || 0) || (a.id < b.id ? -1 : 1);
    });
  const usadosPorNovos = Math.min(novos.length, maxLotes);
  const folga = maxLotes - usadosPorNovos;
  const teto = maxRefresh === undefined ? folga : Math.max(0, Math.min(folga, maxRefresh));
  const releitura = conhecidas.slice(0, teto).map(c => c.url);
  return {
    novos, releitura,
    alvo: [...novos.slice(0, maxLotes), ...releitura],
    iReleitura: usadosPorNovos,
  };
}

async function coletarTenant(supabase, fetchFonte, tenant, cfg, { maxLotes, debug, semBD }) {
  const { urls, fetchOk, via } = await enumerar(fetchFonte, tenant, cfg, { maxPages: cfg.maxPages, debug, semBD });
  console.log(`[${tenant.fonte}] enumerados ${urls.length} lote(s)${via ? ` (via ${via})` : ''}`);
  const prontos = []; let encerrados = 0, sem = 0, reprov = 0, cotaNegada = 0, relidos = 0;
  if (urls.length) {
    const ids = urls.map(u => idFonte(tenant, cfg.parse.idDaUrl(u)));
    const meta = new Map();
    for (let i = 0; i < ids.length; i += 200) {
      // padrao-ok: leitura best-effort de dedup; erro → reprocessa lote conhecido (upsert idempotente), nunca corrompe. Mesmo padrão dos scrapers de origem.
      const { data } = await supabase.from('imoveis_leilao')
        .select('fonte_id,atualizado_em,data_fim,ativo').in('fonte_id', ids.slice(i, i + 200));
      for (const r of data || []) meta.set(r.fonte_id, r);
    }
    // Fonte NUNCA coletada (nada no banco): `novos` são todas as urls e não há releitura —
    // o caminho antigo, intacto.
    const { novos, releitura, alvo, iReleitura } = planejarAlvo({
      urls, meta, chaveDe: u => idFonte(tenant, cfg.parse.idDaUrl(u)),
      maxLotes, maxRefresh: cfg.maxRefresh,
    });
    let pararReleitura = false;
    console.log(`[${tenant.fonte}] no banco ${meta.size} · novos ${novos.length} · releitura ${releitura.length} · processando ${alvo.length}`);
    for (let i = 0; i < alvo.length; i++) {
      if (pararReleitura && i >= iReleitura) break;
      const url = alvo[i];
      const r = await fetchFonte(url, { semBD });
      // A releitura é um EXTRA que só existe enquanto for grátis: no primeiro detalhe que vier
      // pela via paga, para. Sem isto, a folga do orçamento viraria gasto de Bright Data em
      // lote que já temos — o oposto de "usar a sobra".
      if (i >= iReleitura && r?.via === 'bd') {
        pararReleitura = true;
        console.log(`💰 [${tenant.fonte}] releitura caiu na via paga no ${i - iReleitura + 1}º lote — abortada (releitura nunca paga).`);
        break;
      }
      if (i >= iReleitura) relidos++;
      // O FREIO DE ORÇAMENTO NO MEIO DA COLETA (27/08). O fetch de cada fonte já devolve
      // `semCota: true` quando o teto recusa, e aqui isso era descartado no destructuring
      // `const { html } = …`: a página recusada por ORÇAMENTO virava um `sem++` igual ao de
      // um erro de rede, a coleta seguia e a saúde gravava `ok` com total parcial — o freio
      // de custo entregue como medição da fonte (forma #5), agora DENTRO de um run que deu
      // certo: a correção de 12/08 só cobria o tudo-ou-nada. Atinge qualquer fonte cujo
      // detalhe caia no caminho pago. Recusou uma, recusa as próximas: para aqui e conta o
      // que ficou por buscar — o número honesto não é "a fonte tem 9", é "vi 9 de 40".
      if (r?.semCota) {
        cotaNegada = alvo.length - i;
        console.log(`💰 [${tenant.fonte}] teto de orçamento no lote ${i + 1}/${alvo.length} — ${cotaNegada} por buscar. NÃO é regressão da fonte.`);
        break;
      }
      const html = r?.html;
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
  console.log(`[${tenant.fonte}] ${prontos.length} prontos (${relidos} por releitura) · ${encerrados} encerrados · ${reprov} descartados · ${sem} sem detalhe · ${cotaNegada} sem cota`);
  // fonteVazia = respondeu mas 0 lotes (não é falha: o leiloeiro só não tem imóveis agora).
  return { prontos, encerrados, fonteVazia: fetchOk && urls.length === 0, enumerados: urls.length, cotaNegada };
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
    const { prontos, encerrados, fonteVazia, enumerados, cotaNegada } = await coletarTenant(supabase, fetchFonte, tenant, cfg, { maxLotes, debug, semBD });

    if (!prontos.length) {
      // ⚠️ 29/08 — FONTE VAZIA PRECISA VIRAR LINHA, NÃO SILÊNCIO. Isto era um `continue` que
      // NÃO registrava nada, e o efeito foi medido no dia: a HASTA enumerou 0 lotes (tinha 579
      // em 25/08), imprimiu "sem alarme" e **não deixou registro nenhum em `fonte_saude`** — o
      // monitor não podia acusar regressão porque não havia medição, e a fonte só reapareceria
      // 108 h depois como `medicao_velha`. É a pergunta de revisão do CLAUDE.md em estado puro:
      // *este vazio é resposta, ou é falha que não sabe que falhou?*
      // Quem responde não é este `if` — é `registrarSaude`, comparando com a execução anterior:
      // sem histórico de acervo fica 'vazio' (leiloeiro pequeno entre leilões, sem ruído); com
      // acervo anterior vira 'degradado' com "queda vs anterior". O mesmo conserto que o
      // `fonte_regressao_suspeita` recebeu em 29/08: "não consegui verificar" é uma LINHA.
      if (fonteVazia) {
        console.log(`[${tenant.fonte}] respondeu e enumerou 0 lote(s) — registrando a medição.`);
        await registrarSaude(supabase, tenant.fonte, [], cfg.chave, {
          ok: false, vazio: true, enumerados: 0,
          metricas: { n: 0, uf_pct: 0, valor_pct: 0, link_pct: 0, foto_pct: 0 },
          motivo: 'respondeu 200 e enumerou 0 lote(s)',
        });
        continue;
      }
      await registrarSaude(supabase, tenant.fonte, [], cfg.chave, {
        ok: false, semCota: estado.semCota || cotaNegada > 0, cotaNegada, enumerados,
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
    // `cotaNegada` no ramo de SUCESSO: coleta cortada no meio pelo orçamento devolve lotes
    // de verdade e cai aqui — sem este número a linha vira medição sadia da fonte.
    await registrarSaude(supabase, tenant.fonte, prontos, cfg.chave, { enumerados, cotaNegada });
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
