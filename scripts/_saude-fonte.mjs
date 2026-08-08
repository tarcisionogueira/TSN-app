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
 * @param {object} validacao {ok, metricas, motivo} quando o coletor tem portão de qualidade
 */
export async function registrarSaude(supabase, fonte, imoveis, estrategia, validacao) {
  const m = validacao?.metricas || metricasColeta(imoveis || []);
  let status = 'ok', motivo = validacao?.motivo || '';
  if (!m.n) status = 'falhou';
  else if (validacao && validacao.ok === false) status = 'degradado';
  try {
    const { data: ant } = await supabase.from('fonte_saude')
      .select('total').eq('fonte', fonte).order('executado_em', { ascending: false }).limit(1).maybeSingle();
    if (ant && ant.total > 0 && m.n < ant.total * 0.5) {
      if (status === 'ok') status = 'degradado';
      motivo = [motivo, `queda vs anterior (${m.n}<${ant.total})`].filter(Boolean).join('; ');
      console.log(`  ⚠️ [${fonte}] REGRESSÃO: caiu de ${ant.total} para ${m.n}`);
    }
    await supabase.from('fonte_saude').insert({
      fonte, total: m.n, estrategia: estrategia || null,
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
