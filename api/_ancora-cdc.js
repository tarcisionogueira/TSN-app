/**
 * api/_ancora-cdc.js — porta ÚNICA para a âncora dos 7 dias (CDC art. 49).
 * ────────────────────────────────────────────────────────────────────────────
 * `perfis.plano_pago_em` é a âncora do direito de arrependimento:
 * `garantia-cancelar.js` faz `dentro7 = plano_pago_em && (agora - plano_pago_em <= 7d)`.
 * **Âncora nula = reembolso NEGADO**, sem erro e sem rastro.
 *
 * ─── POR QUE ESTE ARQUIVO EXISTE (29/08) ────────────────────────────────────
 * A decisão estava escrita em TRÊS lugares (`ativarPlanoDireto`, `processarConfirmado`,
 * `mp.js/ativarRoleInline`), sempre na mesma forma:
 *
 *     if (!plano_pago_em && !PAGANTES.includes(role)) { ancora }
 *
 * Isso usa **"o role já é pagante" como sinônimo de "já foi ancorado"** — e os dois não
 * são a mesma coisa. Quem vira pagante por um caminho que NÃO grava a âncora (concessão
 * manual, cortesia, ativação antiga) ficava preso: o role pagante passava a bloquear para
 * sempre a gravação que faltou, e o cliente perdia um direito legal sem que nada acusasse.
 * Medido: 1 dos 4 pagantes reais estava assim, e uma conta de cortesia cairia no mesmo
 * buraco no dia em que pagasse.
 *
 * ─── ONDE A REGRA MORA (e por que não mora aqui) ────────────────────────────
 * No BANCO, em `public.garantia_7d_avaliar(uuid)`, registrada em `regra_negocio` sob a
 * chave `garantia.ancora_7d`. É o padrão que esta base já cobra de si mesma:
 * `auditoria_regras_negocio()` termina verificando que `solicitar_saque_ledger` delega a
 * `saque_avaliar` — "voltaram os dois cérebros". Regra de dinheiro com cópia em JS é a
 * mesma doença. Com a regra no banco, o auditor confere sozinho que ela existe e é
 * aplicada; se alguém reimplementar a decisão aqui, ela volta a ser invisível.
 *
 * **Não reimplemente a decisão neste arquivo.** Ele é transporte, não regra.
 *
 * ⚠️ **"Não consegui checar" NÃO é "pode ancorar".** Qualquer falha (rede, HTTP não-2xx,
 * corpo inesperado) devolve `false` — não ancora. Preserva o comportamento vigente em vez
 * de abrir uma janela de reembolso por causa de um erro transitório. Mesmo princípio do
 * `verificar:schema`: falha de medição nunca vira aprovação.
 */

const SB_URL = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || '').trim();
const SB_KEY = (process.env.SUPABASE_SERVICE_KEY || '').trim();

/**
 * Deve gravar `plano_pago_em` nesta ativação? Pergunta ao avaliador único do banco.
 * `fetch` puro de propósito: `mp.js` roda em Edge runtime e não pode carregar o
 * `@supabase/supabase-js` do `_webhook-core.js`.
 * @param {string} userId
 * @param {string} [excluirGatewayPaymentId] - o pagamento EM CURSO (o que disparou esta
 *   própria ativação). O webhook já espelha esse pagamento em mp_pagamentos ANTES de
 *   decidir a âncora — sem excluí-lo, a função via seu próprio gatilho como "histórico"
 *   e nunca ancorava quem vira pagante por um caminho sem âncora prévia (bug bounty 03/09).
 * @returns {Promise<boolean>}
 */
export async function deveAncorarGarantia(userId, excluirGatewayPaymentId) {
  if (!userId || !SB_URL || !SB_KEY) return false;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/rpc/garantia_7d_avaliar`, {
      method: 'POST',
      headers: {
        apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        p_user_id: userId,
        ...(excluirGatewayPaymentId ? { p_excluir_mp_payment_id: String(excluirGatewayPaymentId) } : {}),
      }),
    });
    // `.ok` conferido: um não-2xx com corpo JSON seria lido como decisão válida —
    // "não consegui" fundido com "a resposta é não" é a forma nº 2 do CLAUDE.md.
    if (!r.ok) {
      console.error(`[cdc] garantia_7d_avaliar HTTP ${r.status} para ${userId} — nao ancora`);
      return false;
    }
    const d = await r.json();
    // O avaliador devolve {ancorar, motivo, regra}. `ancorar` tem de vir como booleano
    // de verdade: um corpo inesperado não pode virar "sim" por coerção.
    if (typeof d?.ancorar !== 'boolean') {
      console.error(`[cdc] resposta inesperada de garantia_7d_avaliar para ${userId} — nao ancora`);
      return false;
    }
    if (d.ancorar) console.log(`[cdc] ancorando garantia de 7 dias para ${userId} (${d.motivo})`);
    return d.ancorar;
  } catch (e) {
    console.error(`[cdc] falha ao avaliar garantia de ${userId}: ${e?.message || e} — nao ancora`);
    return false;
  }
}
