// Corpus de aprendizado dos arremates reais (previsto × realizado). Compartilhado
// por /api/arremate-recalibrar (recálculo em lote) e pelos geradores de relatório
// (que injetam o resumo por modalidade no prompt e disparam o recálculo).
const SB = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_KEY;

function sb(path, opts = {}) {
  return fetch(`${SB}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
}
async function rpc(fn, args) {
  try {
    const r = await fetch(`${SB}/rest/v1/rpc/${fn}`, {
      method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {}),
    });
    return r.ok ? await r.json().catch(() => null) : null;
  } catch { return null; }
}
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
// variação % de a em relação a b (b = base real). +N = previsto acima do real.
const deltaPct = (a, b) => (a != null && b != null && b > 0) ? Math.round(((a - b) / b) * 1000) / 10 : null;

// Recalcula o previsto×realizado de UM arremate. No-op se não houver linha no corpus
// (só arremates atribuídos entram). Best-effort — nunca lança.
export async function recalcularArremate(imovelId) {
  if (!SB || !KEY || !imovelId) return;
  const enc = encodeURIComponent(String(imovelId));
  try {
    const [row] = await (await sb(`arremate_aprendizado?imovel_id=eq.${enc}&limit=1`)).json().catch(() => []);
    if (!row) return;

    // PREVISTO: último mercadológico + laudo concluídos deste imóvel.
    const merc = await (await sb(`analises_mercado?imovel_id=eq.${enc}&status=eq.concluida&select=result&order=updated_at.desc&limit=1`)).json().catch(() => []);
    const laudo = await (await sb(`analises_laudo?imovel_id=eq.${enc}&status=eq.concluida&select=result&order=updated_at.desc&limit=1`)).json().catch(() => []);
    const mr = merc?.[0]?.result || {};
    const lr = laudo?.[0]?.result || {};
    const previsto = { valor_mercado: num(mr.valorMercado), valor_locacao: num(mr.valorLocacao), veredito: lr.veredito || null };

    // REALIZADO: preserva o que já há (valor arrematado semeado; revenda/aluguel são
    // preenchidos depois, à medida que a operação avança). Fallback do valor pelo caso.
    const realizado = (row.realizado && typeof row.realizado === 'object') ? { ...row.realizado } : {};
    if (realizado.valor_arrematado == null && row.caso_id) {
      const c = await (await sb(`casos?id=eq.${row.caso_id}&select=imovel_valor&limit=1`)).json().catch(() => []);
      if (c?.[0]?.imovel_valor != null) realizado.valor_arrematado = num(c[0].imovel_valor);
    }
    // REVENDA/ALUGUEL realizados: lidos do ledger do arremate (arrematado_lancamentos
    // via arrematados). Venda = soma das entradas categoria 'Venda'; aluguel_mensal =
    // a entrada 'Aluguel recebido' mais recente. Fecham o comparativo de valor e renda.
    if (row.user_id) {
      try {
        const arr = await (await sb(`arrematados?user_id=eq.${row.user_id}&imovel_id=eq.${enc}&select=id&limit=1`)).json().catch(() => []);
        const arrId = arr?.[0]?.id;
        if (arrId) {
          const lanc = await (await sb(`arrematado_lancamentos?arrematado_id=eq.${arrId}&select=categoria,valor,tipo,data&order=data.desc`)).json().catch(() => []);
          if (Array.isArray(lanc) && lanc.length) {
            const entradas = lanc.filter((l) => l.tipo === 'entrada');
            const venda = entradas.filter((l) => l.categoria === 'Venda').reduce((s, l) => s + (Number(l.valor) || 0), 0);
            const alugueis = entradas.filter((l) => l.categoria === 'Aluguel recebido');
            if (venda > 0) realizado.valor_revenda = venda;
            if (alugueis.length && num(alugueis[0].valor)) realizado.aluguel_mensal = num(alugueis[0].valor);
          }
        }
      } catch { /* ledger é best-effort */ }
    }

    // tipo_aquisicao: financiado se há contrato do banco anexado ao imóvel.
    let tipo_aquisicao = row.tipo_aquisicao || null;
    const cb = await (await sb(`imovel_anexos?imovel_id=eq.${enc}&tipo=eq.contrato_banco&select=id&limit=1`)).json().catch(() => []);
    if (Array.isArray(cb) && cb.length) tipo_aquisicao = 'financiado';

    // ASSERTIVIDADE: só onde os dois lados existem.
    const assertividade = {};
    if (previsto.valor_mercado && realizado.valor_arrematado != null) {
      assertividade.desconto_real_pct = Math.round((1 - realizado.valor_arrematado / previsto.valor_mercado) * 1000) / 10;
    }
    const vd = deltaPct(previsto.valor_mercado, realizado.valor_revenda);
    if (vd != null) assertividade.valor_delta_pct = vd;
    const ld = deltaPct(previsto.valor_locacao, realizado.aluguel_mensal);
    if (ld != null) assertividade.locacao_delta_pct = ld;

    await sb(`arremate_aprendizado?imovel_id=eq.${enc}`, {
      method: 'PATCH', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        previsto, realizado, tipo_aquisicao,
        assertividade: Object.keys(assertividade).length ? assertividade : null,
        updated_at: new Date().toISOString(),
      }),
    });
  } catch { /* aprendizado é best-effort */ }
}

// Bloco de texto p/ injetar no prompt do gerador — lições dos arremates reais da
// mesma modalidade. Vazio quando ainda não há assertividade calculada.
export async function resumoAprendizadoTexto(modalidade) {
  const seg = await rpc('arremate_aprendizado_resumo', { p_modalidade: modalidade || null });
  if (!Array.isArray(seg) || !seg.length) return '';
  const linhas = seg.map((s) => {
    const parts = [];
    if (s.valor_delta_pct_med != null) parts.push(`valor de mercado previsto ${s.valor_delta_pct_med > 0 ? '+' : ''}${s.valor_delta_pct_med}% vs a revenda real`);
    if (s.locacao_delta_pct_med != null) parts.push(`aluguel previsto ${s.locacao_delta_pct_med > 0 ? '+' : ''}${s.locacao_delta_pct_med}% vs o real`);
    if (s.desconto_real_pct_med != null) parts.push(`desconto real médio de ${s.desconto_real_pct_med}%`);
    if (!parts.length) return null;
    return `- ${s.modalidade || 'n/d'}${s.tipo_aquisicao ? '/' + s.tipo_aquisicao : ''} (${s.n} arremate(s) real(is)): ${parts.join('; ')}.`;
  }).filter(Boolean);
  if (!linhas.length) return '';
  return `\n\nAPRENDIZADO DE ARREMATES REAIS (calibre por modalidade — ajuste suas estimativas nesta direção; se o previsto costuma ficar acima do real, seja mais conservador):\n${linhas.join('\n')}`;
}
