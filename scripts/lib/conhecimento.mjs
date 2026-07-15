/**
 * Auto-aprendizado do agente scraper (Passo 1b): cada scraper grava, ao fim da coleta,
 * o que aprendeu na base `leiloeiro_conhecimento` — sem eu semear à mão.
 *
 * Upsert PARCIAL por `fonte`: só atualiza os campos informados (não passados = null →
 * preserva o que já está na base, ex.: plataforma/url_lote/reusavel_por/observacao
 * curados). Assim a telemetria (qualidade, atualizado_em) se renova a cada run e os
 * campos ricos permanecem.
 */
export async function registrarConhecimento(supabase, {
  fonte, acesso = null, custo = null, plataforma = null,
  anti_bot = null, enumeracao = null, url_lote = null, scraper = null, qualidade = null,
}) {
  if (!supabase || !fonte) return;
  const row = { fonte, atualizado_em: new Date().toISOString() };
  if (acesso != null) row.acesso = acesso;
  if (custo != null) row.custo = custo;
  if (plataforma != null) row.plataforma = plataforma;
  if (anti_bot != null) row.anti_bot = anti_bot;
  if (enumeracao != null) row.enumeracao = enumeracao;
  if (url_lote != null) row.url_lote = url_lote;
  if (scraper != null) row.scraper = scraper;
  if (qualidade != null) row.qualidade = Number(qualidade.toFixed ? qualidade.toFixed(3) : qualidade);
  try {
    // merge-duplicates: no conflito atualiza só as colunas presentes no payload.
    await supabase.from('leiloeiro_conhecimento').upsert(row, { onConflict: 'fonte' });
  } catch (e) {
    console.log(`  [conhecimento] ${fonte}: ${String(e.message).slice(0, 80)}`);
  }
}

// Qualidade simples de uma coleta: fração de linhas com foto E valor (0..1).
export function qualidadeColeta(rows) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const ok = rows.filter(r => r && r.link_foto && (r.valor_minimo > 0 || r.valor_avaliacao > 0)).length;
  return ok / rows.length;
}
