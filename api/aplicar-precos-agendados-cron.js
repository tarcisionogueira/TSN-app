/**
 * /api/aplicar-precos-agendados-cron — aplica os preços AGENDADOS (gatilho de preço, passo 8)
 * cuja vigência já chegou. Vira o preço direto no planos_config (fonte única lida pelo front e
 * pelo back), então a partir da virada todo novo checkout já cobra o preço novo.
 *
 * REGRA DO DONO (30/07 — fim do grandfather de preço): assinantes ATIVOS também passam a
 * pagar o preço novo na MENSALIDADE SEGUINTE. Depois de aplicar no planos_config, este cron
 * propaga a mudança para as recorrências vivas nos gateways:
 *   - Asaas: PUT /subscriptions/{id} value=novo (updatePendingPayments=false → só a próxima
 *     fatura muda; a já emitida não é reemitida). Localiza por ciclo + valor ANTIGO exato
 *     (não mexe em valores que não batem — ex.: legado 99,90 segue como está até o dono decidir).
 *   - Mercado Pago: PUT /preapproval/{id} auto_recurring.transaction_amount=novo. Localiza
 *     por external_reference (userId|planoKey) + valor antigo.
 * ASSESSORIA fica FORA: é parcelamento finito (12×) de contrato fechado — preço não muda no meio.
 *
 * Idempotente: se nada venceu, não faz nada. Roda 1×/dia (vercel.json). CRON_SECRET.
 */
export const config = { runtime: 'nodejs', maxDuration: 60 };

import { isCronAuthorized } from './_auth.js';
import { alertarErro } from './_error-alert.js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const ASAAS_URL = process.env.ASAAS_ENV === 'sandbox' ? 'https://api-sandbox.asaas.com/v3' : 'https://api.asaas.com/v3';
const ASAAS_KEY = (process.env.ASAAS_API_KEY || '').trim();
const MP_TOKEN = (process.env.MP_ACCESS_TOKEN || '').trim();

// Planos com recorrência ABERTA (mensalidade sem fim) que acompanham o preço vigente.
const PLANOS_RECORRENTES = ['top2', 'clube'];
const mesmoValor = (a, b) => Math.abs(Number(a) - Number(b)) < 0.05;

async function sincronizarAsaas(mudanca, resumo) {
  if (!ASAAS_KEY) return;
  const alvos = [
    { ciclo: 'MONTHLY', antigo: mudanca.preco_antigo, novo: mudanca.preco_novo },
    { ciclo: 'YEARLY', antigo: mudanca.preco_anual_antigo, novo: mudanca.preco_anual_novo },
  ].filter(a => a.antigo != null && a.novo != null && !mesmoValor(a.antigo, a.novo));
  if (!alvos.length) return;
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await fetch(`${ASAAS_URL}/subscriptions?status=ACTIVE&limit=100&offset=${offset}`, { headers: { access_token: ASAAS_KEY } });
    if (!r.ok) { resumo.erros.push(`asaas_list_${r.status}`); break; }
    const data = await r.json().catch(() => null);
    const subs = data?.data || [];
    for (const sub of subs) {
      const alvo = alvos.find(a => a.ciclo === sub.cycle && mesmoValor(sub.value, a.antigo));
      if (!alvo) continue;
      const up = await fetch(`${ASAAS_URL}/subscriptions/${sub.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json', access_token: ASAAS_KEY },
        body: JSON.stringify({ value: alvo.novo, updatePendingPayments: false }),
      });
      if (up.ok) resumo.asaas++; else resumo.erros.push(`asaas_put_${sub.id}_${up.status}`);
    }
    if (!data?.hasMore) break;
  }
}

// MP: a lista de alvos precisa espelhar a do Asaas — era só o MENSAL, e por isso o
// mandato ANUAL e o CLUBE nunca eram reprecificados (07/08):
//   • `top2_anual` é preapproval recorrente de 12 meses com external_reference
//     `userId|top2_anual`; o filtro comparava planoKey com `top2` e descartava todos;
//     além disso a função nem carregava `preco_anual_antigo/novo`, embora a RPC os devolva.
//   • o `clube` é gravado no mandato como `preco/12` (mensalização do anual, ver api/mp.js),
//     e a comparação era contra o total anual — nunca casava. O guard evitava cobrar 12× por
//     engano, mas o efeito pretendido também nunca acontecia.
// Consequência real: assinante anual/clube do MP renovaria para sempre no preço velho
// enquanto Asaas e checkouts novos já cobram o novo. Há uma troca AGENDADA para 01/10
// (top2 49,90→89,90 e anual 449,90→899), então isto tem prazo.
function alvosMP(mudanca) {
  const alvos = [];
  const { plano_key: pk, preco_antigo: pa, preco_novo: pn, preco_anual_antigo: paa, preco_anual_novo: pan } = mudanca;
  // Mensalidade aberta: valor do mandato = preço mensal.
  if (pa != null && pn != null && !mesmoValor(pa, pn)) {
    // O clube é cobrado mensalizado (total anual ÷ 12) — mesma normalização de api/mp.js.
    const div = pk === 'clube' ? 12 : 1;
    alvos.push({ planoKey: pk, antigo: Number(pa) / div, novo: Number(pn) / div });
  }
  // Mandato ANUAL (12 meses): plano_key com sufixo `_anual` e valor = preço anual cheio.
  if (paa != null && pan != null && !mesmoValor(paa, pan)) {
    alvos.push({ planoKey: `${pk}_anual`, antigo: Number(paa), novo: Number(pan) });
  }
  return alvos;
}

async function sincronizarMP(mudanca, resumo) {
  if (!MP_TOKEN) return;
  const alvos = alvosMP(mudanca);
  if (!alvos.length) return;
  for (let offset = 0; offset < 5000; offset += 100) {
    const r = await fetch(`https://api.mercadopago.com/preapproval/search?status=authorized&offset=${offset}&limit=100`, {
      headers: { Authorization: `Bearer ${MP_TOKEN}` },
    });
    if (!r.ok) { resumo.erros.push(`mp_list_${r.status}`); break; }
    const data = await r.json().catch(() => null);
    const results = data?.results || [];
    if (!results.length) break;
    for (const sub of results) {
      const planoKey = String(sub.external_reference || '').split('|')[1];
      const alvo = alvos.find(a => a.planoKey === planoKey);
      if (!alvo) continue;
      const valorAtual = sub?.auto_recurring?.transaction_amount;
      if (!mesmoValor(valorAtual, alvo.antigo)) continue;
      const up = await fetch(`https://api.mercadopago.com/preapproval/${sub.id}`, {
        method: 'PUT', headers: { Authorization: `Bearer ${MP_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_recurring: { transaction_amount: Number(alvo.novo.toFixed(2)), currency_id: 'BRL' } }),
      });
      if (up.ok) resumo.mp++; else resumo.erros.push(`mp_put_${sub.id}_${up.status}`);
    }
    if (offset + 100 >= Number(data?.paging?.total || 0)) break;
  }
}

export default async function handler(req, res) {
  if (!isCronAuthorized(req)) { res.status(401).json({ error: 'Não autorizado' }); return; }
  if (!SUPABASE_URL || !SERVICE_KEY) { res.status(500).json({ error: 'env ausente' }); return; }
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/aplicar_precos_agendados`, {
      method: 'POST',
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
      body: '{}',
    });
    const mudancas = await r.json().catch(() => null);
    if (!r.ok) { res.status(500).json({ ok: false, mudancas }); return; }
    const resumo = { asaas: 0, mp: 0, erros: [], confirmados: [] };

    // DOIS TEMPOS (07/08): não propagamos mais o RETORNO da RPC, e sim a FILA de pendentes.
    // A diferença importa: o retorno traz só o que mudou AGORA, então uma propagação que
    // falhou ontem nunca era retomada — e, como a RPC consumia `preco_agendado` no mesmo
    // statement, o par (de → para) sumia junto. Agora a RPC marca `propagacao_pendente` e
    // guarda o valor anterior; esta fila devolve tanto o que acabou de mudar quanto o que
    // ficou para trás. Retentar é seguro: o PUT no gateway define o valor final (não
    // incrementa) e o filtro só casa mandato que ainda está no preço antigo.
    let pendentes = [];
    try {
      const rp = await fetch(`${SUPABASE_URL}/rest/v1/rpc/precos_propagacao_pendente`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      if (rp.ok) pendentes = await rp.json();
      else resumo.erros.push(`fila_${rp.status}`);
    } catch (e) { resumo.erros.push(`fila: ${e.message}`); }

    // Propaga aos assinantes ativos (mensalidade seguinte) — só recorrência aberta.
    for (const m of (Array.isArray(pendentes) ? pendentes : [])) {
      if (!PLANOS_RECORRENTES.includes(m.plano_key)) continue;
      const errosAntes = resumo.erros.length;
      try { await sincronizarAsaas(m, resumo); } catch (e) { resumo.erros.push(`asaas_${m.plano_key}: ${e.message}`); }
      try { await sincronizarMP(m, resumo); } catch (e) { resumo.erros.push(`mp_${m.plano_key}: ${e.message}`); }
      // Só baixa a marca quando ESTE plano passou sem nenhum erro novo. Com erro, fica
      // pendente e a próxima execução tenta de novo — que é o ponto de todo o desenho.
      if (resumo.erros.length === errosAntes) {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/rpc/precos_propagacao_confirmar`, {
            method: 'POST',
            headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_plano_key: m.plano_key }),
          });
          resumo.confirmados.push(m.plano_key);
        } catch (e) { resumo.erros.push(`confirmar_${m.plano_key}: ${e.message}`); }
      }
    }
    // FALHA DE PROPAGAÇÃO NÃO PODE SAIR COMO SUCESSO (07/08). O preço no banco já mudou,
    // então uma falha aqui deixa o gateway no valor ANTIGO: novos checkouts cobram o novo e
    // assinantes existentes seguem no velho. Com o modelo em dois tempos a informação não se
    // perde mais (o plano fica `propagacao_pendente` e a próxima execução retoma), mas o
    // silêncio ainda seria ruim: antes isso ia só para console.error e o handler respondia
    // 200 ok:true, então uma pendência podia arrastar por semanas sem ninguém olhar.
    // Alerta pelo mesmo canal do resto do repo e devolve 5xx, para o cron falho aparecer.
    if (resumo.erros.length) {
      console.error('[precos-agendados] erros de propagação:', resumo.erros.join(' · '));
      try {
        alertarErro({
          rota: 'cron/aplicar-precos-agendados',
          erro: `Propagação de preço falhou em ${resumo.erros.length} ponto(s)`,
          extra: { erros: resumo.erros.slice(0, 20), aplicados: (mudancas || []).length, mudancas, propagados: { asaas: resumo.asaas, mp: resumo.mp } },
        });
      } catch { /* alerta é best-effort; o 5xx abaixo já sinaliza */ }
      res.status(502).json({ ok: false, aplicados: (mudancas || []).length, mudancas, propagacao: resumo });
      return;
    }
    res.status(200).json({ ok: true, aplicados: (mudancas || []).length, mudancas, propagacao: resumo });
  } catch (e) {
    res.status(500).json({ error: String(e?.message || e) });
  }
}
