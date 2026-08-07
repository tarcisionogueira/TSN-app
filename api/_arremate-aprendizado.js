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
    // ZERO NÃO É PREVISÃO (07/08). Um mercadológico que concluiu sem estimar valor
    // (`mercadoVazio`) entrava aqui como "previu R$ 0" e o previsto×realizado registrava
    // -100% de desvio contra o arremate real — envenenando a calibração que volta ao prompt
    // de TODOS os relatórios daquela modalidade. Sem estimativa, o previsto fica null (a
    // linha existe, o campo é reconhecidamente desconhecido) e não entra na média.
    // O mesmo vale para o veredito de um laudo que na verdade era o aviso "faltam relatórios".
    const positivo = (v) => { const n = num(v); return n != null && n > 0 ? n : null; };
    const previsto = {
      valor_mercado: mr.mercadoVazio === true ? null : positivo(mr.valorMercado),
      valor_locacao: positivo(mr.valorLocacao),
      veredito: lr.precisaRelatorios === true ? null : (lr.veredito || null),
    };

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
// mesma modalidade (mercadológico + jurídico). Vazio quando ainda não há dados.
export async function resumoAprendizadoTexto(modalidade) {
  const [seg, jur] = await Promise.all([
    rpc('arremate_aprendizado_resumo', { p_modalidade: modalidade || null }),
    rpc('arremate_juridico_resumo', { p_modalidade: modalidade || null }),
  ]);
  const linhas = (Array.isArray(seg) ? seg : []).map((s) => {
    const parts = [];
    if (s.valor_delta_pct_med != null) parts.push(`valor de mercado previsto ${s.valor_delta_pct_med > 0 ? '+' : ''}${s.valor_delta_pct_med}% vs a revenda real`);
    if (s.locacao_delta_pct_med != null) parts.push(`aluguel previsto ${s.locacao_delta_pct_med > 0 ? '+' : ''}${s.locacao_delta_pct_med}% vs o real`);
    if (s.desconto_real_pct_med != null) parts.push(`desconto real médio de ${s.desconto_real_pct_med}%`);
    if (!parts.length) return null;
    return `- ${s.modalidade || 'n/d'}${s.tipo_aquisicao ? '/' + s.tipo_aquisicao : ''} (${s.n} arremate(s) real(is)): ${parts.join('; ')}.`;
  }).filter(Boolean);
  const jurLinhas = (Array.isArray(jur) ? jur : []).map((j) => (
    j.com_processo > 0 ? `- ${j.modalidade || 'n/d'}: ${j.encerrados}/${j.com_processo} processo(s) já com desembaraço concluído no CNJ (baixa/arquivamento/trânsito em julgado).` : null
  )).filter(Boolean);
  if (!linhas.length && !jurLinhas.length) return '';
  let txt = '\n\nAPRENDIZADO DE ARREMATES REAIS (calibre por modalidade — ajuste nesta direção; se o previsto costuma ficar acima do real, seja mais conservador):';
  if (linhas.length) txt += `\n${linhas.join('\n')}`;
  if (jurLinhas.length) txt += `\nDESEMBARAÇO JURÍDICO (evolução real no CNJ, por modalidade):\n${jurLinhas.join('\n')}`;
  return txt;
}

// Classifica a EVOLUÇÃO do processo a partir das movimentações (mais novas primeiro).
// encerrado = houve baixa/arquivamento/trânsito em julgado/extinção. marco = o
// milestone relevante mais recente (também posse/carta/auto de arrematação).
const MARCOS = [
  { re: /baixa\s+defini|arquiva(mento|d[oa])\s+defini|arquivad[oa]\s+definitivamente/i, marco: 'baixa/arquivamento definitivo', encerra: true },
  { re: /tr[âa]nsito\s+em\s+julgado/i, marco: 'trânsito em julgado', encerra: true },
  { re: /extin[çc][ãa]o|extint[ao]\s+(a\s+)?execu/i, marco: 'extinção', encerra: true },
  { re: /imiss[ãa]o\s+na\s+posse|imitid[ao]\s+na\s+posse|mandado\s+de\s+imiss/i, marco: 'imissão na posse', encerra: false },
  { re: /carta\s+de\s+arremat/i, marco: 'carta de arrematação', encerra: false },
  { re: /auto\s+de\s+arremat/i, marco: 'auto de arrematação', encerra: false },
];
export function classificarDesfecho(movimentos) {
  const movs = Array.isArray(movimentos) ? movimentos : [];
  let encerrado = false, marco = null, data = null;
  for (const m of movs) {           // vêm do mais novo p/ o mais antigo
    const d = String(m?.descricao || '');
    for (const mk of MARCOS) {
      if (mk.re.test(d)) {
        if (mk.encerra) encerrado = true;
        if (!marco) { marco = mk.marco; data = m?.data || null; } // milestone mais recente
      }
    }
  }
  return { encerrado, marco, data };
}

// Grava a evolução jurídica (CNJ) no realizado do corpus. No-op se não for arremate.
export async function registrarDesfechoJuridico(imovelId, proc, desfecho) {
  if (!SB || !KEY || !imovelId) return false;
  const enc = encodeURIComponent(String(imovelId));
  try {
    const [row] = await (await sb(`arremate_aprendizado?imovel_id=eq.${enc}&limit=1`)).json().catch(() => []);
    if (!row) return false;
    const realizado = (row.realizado && typeof row.realizado === 'object') ? { ...row.realizado } : {};
    realizado.juridico = {
      numero: proc?.numero || null,
      tribunal: proc?.tribunal || null,
      encerrado: !!desfecho?.encerrado,
      marco: desfecho?.marco || null,
      marco_data: desfecho?.data || null,
      atualizado_em: new Date().toISOString().slice(0, 10),
      movimentos: (proc?.movimentos || []).slice(0, 8).map((m) => ({ data: m?.data || null, descricao: String(m?.descricao || '').slice(0, 160) })),
    };
    await sb(`arremate_aprendizado?imovel_id=eq.${enc}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ realizado, updated_at: new Date().toISOString() }) });
    return true;
  } catch { return false; }
}
