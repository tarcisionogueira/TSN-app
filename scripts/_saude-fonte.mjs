/**
 * SAÚDE DA FONTE — módulo compartilhado por TODOS os coletores.
 *
 * POR QUE EXISTE (achado de 08/08): `registrarSaude` vivia dentro de `scraper-puppeteer.mjs`,
 * então só as fontes coletadas por ELE apareciam no monitor. As demais — coletadas por scrapers
 * próprios (soleon, pecini, gestao, rj, vlance) — nunca escreviam uma linha em `fonte_saude`.
 * Resultado medido: **7 fontes com 418 lotes ativos num ponto cego**. Elas não têm histórico,
 * logo `fonte_baseline_aprendida()` nunca lhes dá piso, logo o alerta de regressão NUNCA dispara
 * para elas. Se qualquer uma quebrasse, o acervo simplesmente encolheria em silêncio — que é
 * exatamente o tipo de falha que o bug bounty dos leiloeiros existe para pegar.
 *
 * Regra ao integrar leiloeiro NOVO: chame `registrarSaude` no fim da coleta. É a linha que
 * ONBOARDA a fonte no monitor — sem ela a fonte nasce invisível.
 */

// Qualidade da coleta em percentuais (0–1) dos campos que decidem se o lote é utilizável.
export function metricasColeta(imoveis) {
  const n = imoveis.length || 0;
  const p = (x) => (n ? Number((x / n).toFixed(3)) : 0);
  const uf    = imoveis.filter(i => /^[A-Z]{2}$/.test(i.estado || '')).length;
  const valor = imoveis.filter(i => Number(i.valor_minimo) > 0).length;
  const link  = imoveis.filter(i => /^https?:\/\//.test(i.link_edital || i.url_lote || '')).length;
  const foto  = imoveis.filter(i => i.link_foto).length;
  return { n, uf_pct: p(uf), valor_pct: p(valor), link_pct: p(link), foto_pct: p(foto) };
}

/**
 * Grava 1 linha por fonte por execução e compara com a execução anterior (queda >50% ou
 * zeragem = regressão). O e-mail de alerta é disparado pelo cron /api/monitor-fontes-cron,
 * que lê esta tabela — aqui só registramos o fato.
 *
 * @param {object} supabase cliente já autenticado do coletor
 * @param {string} fonte    código da fonte (o mesmo gravado em imoveis_leilao.fonte)
 * @param {Array}  imoveis  lotes coletados nesta execução
 * @param {string} estrategia rótulo livre ('principal', 'api', 'html'…)
 * @param {object} validacao {ok, metricas, motivo, semCota, enumerados} quando o coletor tem
 *   portão de qualidade. `semCota: true` marca que o zero veio de decisão de ORÇAMENTO (cota do
 *   fornecedor pago negada) e não de mudança na fonte — nesse caso não se acusa regressão,
 *   porque a ação que resolve é liberar cota, não consertar parser.
 *
 * ─── `enumerados` — POR QUE A REGRESSÃO NÃO PODE OLHAR PARA `total` (17/08) ────────────────
 * `total` é quantos lotes a execução PROCESSOU, e esse número mede duas coisas diferentes
 * conforme o dia. Scrapers como o SOLEON fazem `(novos.length ? novos : urls)`: quando não há
 * nada novo, eles re-raspam os já conhecidos para atualizar preço e data — trabalho legítimo,
 * que enche `total` com o teto do lote. Quando há UM lote novo, `total` vale 1.
 *
 * O resultado medido na VEGAS: 13/08 e 16/08 gravaram `total: 40` com **ZERO** lotes criados
 * (re-raspagem pura); 17/08 gravou `total: 1` com **1** lote criado — captura correta de um
 * site que só tinha um lote novo. O monitor comparou 1 captura contra 40 re-verificações e
 * gritou "queda vs anterior (1<40)", mandando investigar um scraper que estava certo. As
 * irmãs de plataforma provam: CALIL e TORRES3, mesmo código, passaram bem no mesmo run.
 *
 * `enumerados` = quantos lotes a FONTE LISTA. Esse número não depende de quanto já temos, e é
 * o que de fato regride quando o site muda: listagem que cai de 40 URLs para 1 é regressão de
 * verdade. Quando presente nos dois lados, é ele que decide.
 */
export async function registrarSaude(supabase, fonte, imoveis, estrategia, validacao) {
  const m = validacao?.metricas || metricasColeta(imoveis || []);
  const semCota = validacao?.semCota === true;
  // Quantos lotes ficaram POR BUSCAR porque o teto de orçamento recusou NO MEIO da coleta.
  const cotaNegada = Number(validacao?.cotaNegada) || 0;
  let status = 'ok', motivo = validacao?.motivo || '';
  // "NÃO TENTEI" NÃO É "FALHOU" (16/08). O `semCota` já era honrado no teste de regressão
  // logo abaixo e no texto do `motivo` — mas o STATUS, que é o campo que o monitor, os
  // painéis e `fonte_baseline_aprendida()` de fato leem, continuava gravando 'falhou'.
  // O efeito prático: quando o teto semanal do Bright Data satura, CALIL, VEGAS, TORRES3 e
  // RJLEILOES aparecem como fontes quebradas — e ficaram assim 3 dias em 14–16/08, sem
  // NUNCA terem sido consultadas. Pior: o ruído enterrou o achado real, a CREPALDI, que
  // falha de verdade há 10 dias. A ação que resolve cada caso é oposta (liberar orçamento
  // × consertar parser), então o status precisa distinguir os dois.
  // É a forma #5 do CLAUDE.md pela metade: o freio de custo tem que dizer QUAL "não".
  if (!m.n) status = semCota ? 'sem_cota' : 'falhou';
  // COLETA CORTADA PELO ORÇAMENTO NO MEIO (27/08) — o buraco que a correção de 16/08 deixou.
  // Aquela cobria o tudo-ou-nada: `m.n === 0` vira 'sem_cota' em vez de 'falhou'. Mas quando
  // a cota acaba DEPOIS de alguns lotes, `m.n > 0` e a linha saía como 'ok' — com um total
  // que não mede a fonte, e sim até onde o dinheiro deu. Esse total ia parar em dois lugares
  // onde faz estrago: `fonte_regressao_suspeita()`, que o compara contra o piso e manda
  // consertar parser intacto, e `fonte_baseline_aprendida()`, que filtra por `status = 'ok'`
  // e portanto APRENDE com ele, puxando o piso para baixo a cada coleta truncada.
  // `parcial_cota` é o mesmo "não" do orçamento que o 'sem_cota' já dizia, agora com o
  // número junto — e sai das duas amostras de uma vez.
  else if (cotaNegada > 0) {
    status = 'parcial_cota';
    motivo = [motivo, `coleta interrompida pelo teto de orçamento: ${cotaNegada} lote(s) por buscar `
      + `(decisão de orçamento, não regressão da fonte)`].filter(Boolean).join('; ');
  } else if (validacao && validacao.ok === false) status = 'degradado';
  try {
    const enumerados = Number.isFinite(validacao?.enumerados) ? validacao.enumerados : null;
    const { data: ant } = await supabase.from('fonte_saude')
      .select('total,enumerados').eq('fonte', fonte).order('executado_em', { ascending: false }).limit(1).maybeSingle();
    // Compara ENUMERADOS com ENUMERADOS quando os dois lados têm o número; só cai para
    // `total` quando o coletor (ou o histórico) ainda não reporta enumeração. Misturar as
    // duas escalas seria pior que não comparar: são grandezas diferentes com o mesmo nome.
    const usaEnum = enumerados != null && Number(ant?.enumerados) > 0;
    const atual = usaEnum ? enumerados : m.n;
    const anterior = usaEnum ? Number(ant.enumerados) : Number(ant?.total);
    const rotulo = usaEnum ? 'listados' : 'coletados';
    // `cotaNegada` entra junto com `semCota`: comparar um total truncado pelo orçamento
    // contra a execução anterior acusa queda que o leiloeiro não teve.
    if (anterior > 0 && atual < anterior * 0.5 && !semCota && !cotaNegada) {
      if (status === 'ok') status = 'degradado';
      motivo = [motivo, `queda vs anterior (${rotulo} ${atual}<${anterior})`].filter(Boolean).join('; ');
      console.log(`  ⚠️ [${fonte}] REGRESSÃO: ${rotulo} caiu de ${anterior} para ${atual}`);
    } else if (cotaNegada && anterior > 0) {
      console.log(`  💰 [${fonte}] coleta parcial: ${cotaNegada} lote(s) não buscados por orçamento (anterior ${anterior}). NÃO é regressão da fonte.`);
    } else if (semCota && anterior > 0) {
      console.log(`  💰 [${fonte}] sem cota: coleta não tentada (anterior ${anterior}). NÃO é regressão da fonte.`);
    }
    await supabase.from('fonte_saude').insert({
      fonte, total: m.n, enumerados, estrategia: estrategia || null,
      uf_pct: m.uf_pct, valor_pct: m.valor_pct, link_pct: m.link_pct, foto_pct: m.foto_pct,
      status, motivo: motivo || null,
    });
    console.log(`  🩺 [${fonte}] saúde registrada: ${m.n} lotes · ${status}`);
    // Auto-aprendizado: refresca a qualidade na base de conhecimento. Upsert PARCIAL — preserva
    // os campos curados (plataforma, url_lote, observações) que a ofensiva de captura escreve.
    try {
      const q = Number((((m.foto_pct || 0) + (m.valor_pct || 0) + (m.link_pct || 0)) / 3).toFixed(3));
      await supabase.from('leiloeiro_conhecimento').upsert(
        { fonte, qualidade: q, atualizado_em: new Date().toISOString() }, { onConflict: 'fonte' });
    } catch { /* base de conhecimento é opcional */ }
  } catch (e) {
    console.log(`  [${fonte}] registrarSaude erro: ${String(e?.message || e).slice(0, 80)}`);
  }
  return { status, motivo, metricas: m };
}
