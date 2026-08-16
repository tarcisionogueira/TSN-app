/**
 * _webhook-core.js
 * Lógica de negócio compartilhada entre todos os gateways de pagamento.
 * Mercado Pago e Asaas normalizam seus eventos para o formato abaixo
 * e chamam processarPagamentoConfirmado / processarPagamentoVencido / etc.
 *
 * Formato normalizado:
 * {
 *   tipo:        'confirmado' | 'vencido' | 'recusado' | 'estornado'
 *   valor:       number          // valor em R$
 *   descricao:   string          // descrição do pagamento
 *   email:       string | null
 *   gatewayCustomerId: string | null   // id do cliente no gateway
 *   gatewayPaymentId:  string          // id único do pagamento no gateway
 *   gateway:     'mercadopago' | 'asaas'
 * }
 */

import { createClient } from '@supabase/supabase-js';
import { alertarErro } from './_error-alert.js';
import { emitirNFSeServico, nfseAtivo } from './_nfse.js';
import { cpfDoRegistro } from './_cpf.js';
import { enviarPurchaseCapi, purchaseEventId } from './_meta-capi.js';
import { enviarConversaoOffline, googleAdsAtivo } from './_google-ads.js';
import { enviarEmail } from './_email.js';

// Normaliza o plano para a BASE (top2/clube/assessorado) — o event_id do Purchase precisa
// bater com o do navegador, que usa a mesma base (sem sufixo _anual/_vista/_mensal).
const planoBase = (p) => String(p || '').replace(/_(anual|vista|mensal)$/i, '');

// ── Escada de planos do CLIENTE (regra do dono, 30/07): um pagamento NUNCA rebaixa ──
// o role. A mensalidade do Investidor Pro CONTINUA sendo cobrada enquanto o cliente é
// assessorado (a assessoria é por arrematação, em cima do Pro) — sem esta guarda, a
// renovação mensal do Pro gravava role='top2' e o assessorado perdia o acompanhamento
// (Caso/jurídico) no meio do contrato. Papéis fora da escada (admin/analista/advogado/
// suporte/consultor) nunca são tocados por pagamento.
const RANK_PLANO = { explorador: 0, top2: 1, top2_anual: 1, assessorado: 2, assessorado_anual: 2, clube: 3, clube_anual: 3 };
export function roleAposPagamento(roleAtual, planoPago) {
  const atual = RANK_PLANO[roleAtual];
  const novo  = RANK_PLANO[planoPago];
  if (novo == null) return roleAtual ?? null;              // pagamento não mapeado → não mexe
  if (roleAtual != null && atual == null) return roleAtual; // papel de equipe/protegido → não mexe
  return (atual ?? -1) >= novo ? roleAtual : planoPago;     // só sobe na escada, nunca desce
}

export const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// ── Idempotência ──────────────────────────────────────────────────────────────
// Registra (gateway, payment_id, evento) e retorna true se JÁ havia sido
// processado. O próprio INSERT é a trava (PK única → 23505 em duplicata),
// então é atômico mesmo com dois disparos simultâneos do gateway.
// Sem payment_id não há como deduplicar → processa (fail-open).
export async function eventoJaProcessado({ gateway, gatewayPaymentId, evento }) {
  if (!gatewayPaymentId || !evento) return false;
  const { error } = await supabase
    .from('webhook_eventos_processados')
    .insert({ gateway, gateway_payment_id: String(gatewayPaymentId), evento });
  if (!error) return false;                 // inseriu agora → primeira vez
  if (error.code === '23505') return true;  // PK duplicada → já processado
  // Erro inesperado: não bloqueia o pagamento (melhor reprocessar do que perder).
  console.error(`[${gateway}] idempotência:`, error.message);
  return false;
}

// Remove a marca de idempotência (gateway, payment_id, evento). Usar quando o EFEITO do
// evento FALHOU depois da marca ter sido gravada: sem isso, o reenvio do gateway seria
// deduplicado e o efeito (ativação/estorno) nunca completaria. Best-effort.
export async function removerEventoProcessado({ gateway, gatewayPaymentId, evento }) {
  if (!gatewayPaymentId || !evento) return;
  try {
    await supabase.from('webhook_eventos_processados')
      .delete()
      .eq('gateway', gateway)
      .eq('gateway_payment_id', String(gatewayPaymentId))
      .eq('evento', evento);
  } catch (e) { console.error(`[${gateway}] remover idempotência:`, e?.message || e); }
}

// ── Mapeamento valor → plano ──────────────────────────────────────────────────
// Atualizar aqui quando mudar preços. Tolerância de ±1% ou ±R$1 (o que for maior).
function dentroFaixa(valor, alvo, tol = 1) {
  return Math.abs(valor - alvo) <= Math.max(tol, alvo * 0.01);
}

export function mapearPlano(valor, descricao = '') {
  const v = Number(valor) || 0;
  const desc = descricao.toLowerCase();

  // Investidor Pro — mensal (49,90) ou anual (449,90). 99,90 mantido por
  // compatibilidade com assinaturas legadas no preço antigo. O `ciclo` distingue o anual
  // (antes ambos colapsavam em top2 sem ciclo → plano_ciclo='anual' nunca era gravado e a
  // proteção anti-rebaixamento do anual ficava órfã; bug bounty).
  if (dentroFaixa(v, 49.9))  return { plano: 'top2', role: 'top2', ciclo: 'mensal' }; // Pro mensal
  if (dentroFaixa(v, 99.9))  return { plano: 'top2', role: 'top2', ciclo: 'mensal' }; // legado
  if (dentroFaixa(v, 449.9)) return { plano: 'top2', role: 'top2', ciclo: 'anual' };  // Pro anual

  // Leilão Club — verificar ANTES de assessorado pois ambos têm opção de R$5.000.
  // Casa 'clube' E 'club' (o nome oficial é "Leilão Club", sem o 'e'); sem isso
  // um pagamento de Club de R$5.000 caía por engano em assessorado.
  if (dentroFaixa(v, 5000) && desc.includes('club')) return { plano: 'clube', role: 'clube' };
  if (dentroFaixa(v, 48000, 100)) return { plano: 'clube', role: 'clube' };
  if (dentroFaixa(v, 60000, 200)) return { plano: 'clube', role: 'clube' };

  // Assessoria — parcela mensal (500), à vista (4800 = 6000 −20%) ou total (6000).
  // Mantém 5000 por compatibilidade com cobranças à-vista antigas (valor anterior).
  if (dentroFaixa(v, 500))   return { plano: 'assessorado', role: 'assessorado' };
  if (dentroFaixa(v, 4800))  return { plano: 'assessorado', role: 'assessorado' };
  if (dentroFaixa(v, 5000))  return { plano: 'assessorado', role: 'assessorado' };
  if (dentroFaixa(v, 6000, 60)) return { plano: 'assessorado', role: 'assessorado' };

  return null;
}

// ── Busca perfil por gateway_id ou email ──────────────────────────────────────
export async function buscarCliente({ gatewayCustomerId, email, gateway }) {
  // 1. Tenta por ID do gateway no campo correto do perfil
  if (gatewayCustomerId) {
    const campo = gateway === 'mercadopago' ? 'mp_id' : 'asaas_id';
    const { data } = await supabase
      .from('perfis')
      .select('id, indicado_por, comissionado_por, role, role_anterior, inadimplente_desde, plano_pago_em')
      .eq(campo, gatewayCustomerId)
      .maybeSingle();
    if (data) return data;
  }

  // 2. Fallback por email
  if (email) {
    const { data: userId } = await supabase.rpc('get_user_id_by_email', { p_email: email });
    if (userId) {
      const { data } = await supabase
        .from('perfis')
        .select('id, indicado_por, comissionado_por, role, role_anterior, inadimplente_desde, plano_pago_em')
        .eq('id', userId)
        .maybeSingle();
      if (data) return data;
    }
  }

  return null;
}

// ── ATIVAÇÃO DIRETA POR REFERÊNCIA (assinaturas transparentes) ────────────────
// As assinaturas (preapproval) informam o plano no external_reference
// (`userId|planoKey`), então ativamos direto — sem adivinhar o plano pelo valor.
/**
 * CONVERSÃO DE ANÚNCIO — avisa Meta e Google que este pagamento virou venda.
 *
 * Os dois canais medem do SERVIDOR porque o navegador falha justamente onde mais dói: PIX
 * pago depois de sair do checkout, aba fechada, bloqueador de anúncio, iOS. Sem isto, a
 * plataforma de anúncio conclui que a campanha não converte e tira verba de onde está
 * vendendo — o prejuízo é silencioso e cresce com o investimento.
 *
 * • META: `event_id` determinístico, o MESMO que o Pixel do navegador manda → o Meta une os
 *   dois numa conversão só. Quando o Pixel é bloqueado, sobra o do servidor.
 * • GOOGLE: precisa do `gclid` (o clique do anúncio), capturado na chegada e guardado em
 *   `perfis.mkt_gclid`. Sem gclid a venda é orgânica e não há o que atribuir. O mesmo id vai
 *   como `orderId` para o Google não contar duas vezes quando o evento do navegador já saiu.
 *
 * Best-effort por contrato: qualquer falha aqui é logada e engolida — medir venda nunca pode
 * impedir a venda de ser ativada.
 */
async function registrarConversaoAnuncio({ userId, valor, base, gateway, email }) {
  const v = Number(valor) || 0;
  if (!userId || !(v > 0)) return;
  const eventId = purchaseEventId(userId, base);
  try {
    await enviarPurchaseCapi({ userId, email, valor: v, planoBase: base, gateway, eventId });
  } catch (e) { console.error(`[${gateway}] meta capi:`, e?.message || e); }
  try {
    // Só consulta o gclid se o Google Ads estiver ligado — enquanto dormente, zero leitura extra.
    if (googleAdsAtivo()) {
      const { data } = await supabase.from('perfis').select('mkt_gclid').eq('id', userId).maybeSingle();
      if (data?.mkt_gclid) await enviarConversaoOffline({ gclid: data.mkt_gclid, valor: v, orderId: eventId });
    }
  } catch (e) { console.error(`[${gateway}] google ads offline:`, e?.message || e); }
}

export async function ativarPlanoDireto({ userId, planoKey, gateway, cobranca = null }) {
  if (!userId || !planoKey) return { skipped: 'sem_referencia' };
  // O TIER fica no `role` (top2/clube/…). NÃO gravar em `plano`: essa coluna tem
  // check constraint (gratuito|analista|gestor) e planoKey='top2' a VIOLAVA →
  // toda ativação de plano pago falhava (webhook e reconciliação). role é a fonte.
  const PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
  const { data: atual } = await supabase.from('perfis').select('role, role_anterior, inadimplente_desde, plano_pago_em, plano_vencimento, ciclo_agendado').eq('id', userId).maybeSingle();

  // ── ACESSO SÓ COM DINHEIRO NA CONTA (decisão do dono, 16/08) ────────────────────
  // A trava mora AQUI, e não em cada chamador, porque o defeito já tinha aparecido em
  // quatro portas diferentes (assinar-com-cadastro, mp.js, PagamentoServico, ativar-pro-
  // anual) e a quinta seria só questão de tempo. Todo caminho de ativação passa por esta
  // função; travando aqui, um chamador novo nasce protegido em vez de nascer com o furo.
  //
  // O QUE ESTAVA ERRADO: `mp-webhook.js` chama esta função com `cobranca=null` na simples
  // autorização do MANDATO (`subscription_preapproval`), que é o MP dizendo "o cartão é
  // válido e eu tenho permissão de cobrar" — uma transação de R$ 0,00. A primeira cobrança
  // é assíncrona. No 1º assinante Pro ela veio 22 minutos depois e foi RECUSADA por
  // antifraude (`cc_rejected_high_risk`): zero real recebido, mandato `authorized` desde o
  // primeiro segundo. Sem esta guarda, ele teria plano pago sem ter pago.
  //
  // A EXCEÇÃO É DELIBERADA: quem JÁ tem histórico de pagamento (âncora `plano_pago_em`,
  // role pagante, ou `role_anterior` de uma suspensão) continua podendo ser reativado sem
  // cobrança nova — é o que a reconciliação faz para CONSERTAR estado de cliente que já
  // pagou. Negar isso trocaria o buraco de acesso por um buraco de atendimento: cliente
  // adimplente preso como Explorador porque um webhook se perdeu.
  const temCobrancaReal = !!(cobranca?.gatewayPaymentId && Number(cobranca.valor) > 0);
  const semHistoricoDePagamento = !atual?.plano_pago_em && !PAGANTES.includes(atual?.role) && !atual?.role_anterior;
  if (semHistoricoDePagamento && !temCobrancaReal) {
    console.log(`[${gateway}] ativação SEGURADA para ${userId} (${planoKey}): mandato aceito, cobrança ainda não recebida`);
    return { ok: true, skipped: 'aguardando_pagamento' };
  }
  // O role fica sempre na BASE (top2/clube/assessorado) — o CICLO mora só em plano_ciclo (D5).
  // Assim nenhum gate que leia o sufixo do role classifica o anual como mensal.
  const planoBaseKey = String(planoKey).replace(/_anual$/, '');
  // Recuperação de inadimplência restaura o role suspenso (que pode ser MAIOR que o
  // plano pago — ex.: assessorado suspenso pagando a mensalidade do Pro); fora dela,
  // a escada decide: pagamento só SOBE o role, nunca desce (guarda anti-flip).
  const candidato = (atual?.role_anterior && atual?.inadimplente_desde)
    ? roleAposPagamento(atual.role_anterior, planoBaseKey)
    : planoBaseKey;
  const upd = {
    inadimplente_desde: null,
    role_anterior:      null,
    role:               roleAposPagamento(atual?.role, candidato) ?? planoBaseKey,
  };
  // CICLO do plano (mensal/anual) derivado do planoKey — o recorrente MP não usa valor.
  const cicloKey = /_anual$/.test(planoKey) ? 'anual' : 'mensal';
  upd.plano_ciclo = cicloKey;
  if (cicloKey === 'anual' && (cobranca?.gatewayPaymentId || !atual?.plano_vencimento)) {
    // Reancora a vigência de 12m SÓ com COBRANÇA REAL (renovação — regra c) OU na 1ª
    // ativação (sem âncora ainda). A mera autorização do mandato / a reconciliação
    // (cobranca=null com âncora já setada) NÃO estica o vencimento (P1.2 — anti-exploração).
    const venc = new Date(); venc.setMonth(venc.getMonth() + 12);
    upd.plano_vencimento = venc.toISOString();
  }
  // Confirmou a mensal após um agendamento anual→mensal → limpa a intenção (idempotente).
  if (cicloKey === 'mensal' && atual?.ciclo_agendado) upd.ciclo_agendado = null;
  // DOWNGRADE AGENDADO cumprido (ou desfeito): qualquer ativação de plano encerra o
  // agendamento. Deixá-lo pendurado faria o cron seguir convidando para uma troca que já
  // aconteceu — e o cliente receberia e-mail pedindo para ativar o plano que ele já tem.
  upd.plano_agendado = null;
  // Garantia de 7 dias: âncora só na 1ª assinatura (role atual não-pagante e sem
  // âncora). Renovação recorrente NÃO reinicia a janela; resubscrição após cancelar
  // (que zera plano_pago_em) inicia uma nova.
  if (!atual?.plano_pago_em && !PAGANTES.includes(atual?.role)) {
    upd.plano_pago_em = new Date().toISOString();
  }
  const { error } = await supabase.from('perfis').update(upd).eq('id', userId);
  if (error) throw new Error(error.message);
  try {
    // Trava de preço só conhece chaves-base (top2/clube) — normaliza (o valor anual mora
    // no mandato do gateway; preco_contratado é informativo). Evita o no-op silencioso.
    await supabase.rpc('registrar_preco_contratado', { p_user_id: userId, p_plano_key: planoBaseKey });
  } catch (e) {
    console.error(`[${gateway}] registrar_preco_contratado:`, e.message);
  }

  // COMISSÃO DE REDE — repasse MEDIANTE PAGAMENTO (regra do dono: sem pagamento, sem repasse).
  // Só comissiona quando esta ativação carrega uma cobrança RECEBIDA de verdade
  // (cobranca.gatewayPaymentId + valor>0): a mensalidade recorrente PROCESSADA. A mera
  // autorização da assinatura (sem pagamento) e a reconciliação de role passam cobranca=null
  // → NÃO comissionam. Idempotente por (payment_id, nível) na RPC; usa o MESMO id do estorno
  // (chargeback/reembolso reverte por origem_id LIKE '{payment_id}-%'). try/catch NÃO relança
  // (mantém a ativação; o ramo de assinatura não desmarca a idempotência do evento).
  if (cobranca?.gatewayPaymentId && Number(cobranca.valor) > 0) {
    try {
      const p_tipo = ['assessorado', 'assessorado_anual', 'clube', 'clube_anual'].includes(planoKey)
        ? 'venda_direta' : 'assinatura';
      const { data: dist } = await supabase.rpc('distribuir_comissao_rede', {
        p_comprador: userId, p_tipo, p_valor: Number(cobranca.valor), p_gateway_payment_id: String(cobranca.gatewayPaymentId),
      });
      if (dist && dist.ok === false) console.warn(`[${gateway}] comissao_rede (recorrente):`, JSON.stringify(dist).slice(0, 200));
    } catch (e) {
      console.error(`[${gateway}] comissao_rede (recorrente):`, e.message);
    }
    // Conversão de anúncio (Meta + Google) — cobrança recorrente RECEBIDA de verdade.
    await registrarConversaoAnuncio({ userId, valor: cobranca.valor, base: planoBase(planoKey), gateway });

    // BOAS-VINDAS DO PLANO — mora AQUI, dentro do ramo de cobrança recebida, e não em
    // `assinar-com-cadastro.js` (16/08). Lá o gatilho era `preapproval.status ===
    // 'authorized'`, que é o MANDATO aceito (validação de cartão de R$ 0,00), não
    // pagamento: o 1º assinante Pro recebeu "Bem-vindo ao Investidor Pro" 22 minutos
    // ANTES de a cobrança de R$ 49,90 ser recusada por antifraude. Dizer "sua assinatura
    // foi confirmada" para quem não pagou é pior que não dizer nada — some com a conta e
    // deixa o cliente achando que tem acesso.
    // Só na PRIMEIRA ativação: `role_anterior` preenchido indica recuperação de
    // inadimplência (voltou a pagar), e renovação mensal não é estreia.
    if (!atual?.plano_pago_em && !PAGANTES.includes(atual?.role) && !atual?.role_anterior) {
      try {
        // `error` conferido: sem isso, uma falha de leitura vira "usuário sem e-mail" e o
        // cliente que ACABOU de pagar simplesmente não recebe aviso nenhum — silêncio que
        // parece sucesso, que é a família de bugs que este repositório já conhece bem.
        const { data: u, error: errU } = await supabase.auth.admin.getUserById(userId);
        if (errU) throw new Error(`getUserById: ${errU.message}`);
        const paraEmail = u?.user?.email;
        const primeiroNome = String(u?.user?.user_metadata?.nome || '').trim().split(' ')[0] || '';
        if (paraEmail) {
          await enviarEmail({
            from: process.env.EMAIL_FROM || 'BidPro Brasil <nao-responda@bidprobrasil.com.br>',
            to: paraEmail,
            subject: 'Sua assinatura está ativa — BidPro Brasil',
            html: `<p>Olá, ${primeiroNome}!</p><p>Recebemos o seu pagamento e o plano já está <strong>ativo</strong> na sua conta. É só entrar com o seu e-mail e senha.</p><p>Bons arremates!<br/>BidPro Brasil</p>`,
            meta: { tipo: 'boas_vindas', userId },
          });
        } else {
          console.error(`[${gateway}] boas-vindas: e-mail do usuário ${userId} não encontrado`);
        }
      } catch (e) { console.error(`[${gateway}] boas-vindas:`, e?.message || e); }
    }
  }
  return { ok: true, plano: planoKey };
}

// ── SUSPENSÃO DIRETA POR REFERÊNCIA (falha de recorrência) ────────────────────
// Cobrança recorrente recusada / assinatura pausada ou cancelada no MP → rebaixa
// o cliente para 'explorador' e marca inadimplência (dispara o aviso in-app).
// Idempotente: se já está inadimplente, não repete. Guarda role_anterior para
// reativar quando o pagamento voltar.
export async function suspenderPlanoDireto({ userId, gateway }) {
  if (!userId) return { skipped: 'sem_referencia' };
  const { data: cliente } = await supabase
    .from('perfis').select('role, inadimplente_desde, plano_ciclo, plano_vencimento').eq('id', userId).maybeSingle();
  if (!cliente) return { skipped: 'perfil_nao_encontrado' };
  if (cliente.inadimplente_desde) return { ok: true, ja_inadimplente: true };
  // GUARDA da âncora ANUAL: cancelar o MANDATO anual (troca anual→mensal agendada, ou
  // cancelamento no meio do ano já pago) NÃO rebaixa — o cliente pagou os 12 meses e
  // mantém acesso até plano_vencimento. A virada/rebaixe acontece no vencimento.
  if (/anual/i.test(cliente.plano_ciclo || '') && cliente.plano_vencimento
      && new Date(cliente.plano_vencimento).getTime() > Date.now()) {
    return { ok: true, ignorado: 'anual_vigente' };
  }
  const ROLES_PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
  const update = { inadimplente_desde: new Date().toISOString().slice(0, 10) };
  if (ROLES_PAGANTES.includes(cliente.role)) { update.role_anterior = cliente.role; update.role = 'explorador'; }
  const { error } = await supabase.from('perfis').update(update).eq('id', userId);
  if (error) throw new Error(error.message);
  console.log(`[${gateway}] assinatura: cliente ${userId} rebaixado por falha de pagamento`);
  return { ok: true, suspenso: true };
}

// ── ESTORNO DE COMISSÃO (chargeback / reembolso) ──────────────────────────────
// Reverte a comissão de afiliado de um pagamento que foi revertido: cancela a
// comissão e lança um ESTORNO NEGATIVO no saldo (fonte do saque). Sem isto o
// afiliado ficava com a comissão MESMO com o pagamento estornado — fraude: indicar
// → comissão vira 'disponivel' → chargeback/reembolso → sacar. Idempotente por
// origem_id (não estorna duas vezes o mesmo pagamento).
export async function estornarComissao({ gatewayPaymentId, gateway, motivo = 'chargeback' }) {
  if (!gatewayPaymentId) return { skipped: 'sem_payment_id' };
  const motivoTxt = motivo === 'reembolso' ? 'reembolso' : 'chargeback';
  try {
    // Cliente (indicado) que gerou a reversão — para SINALIZAR no relatório QUEM contestou
    // e que foi CHARGEBACK. O valor negativo desconta do saldo (fica negativo se já sacado →
    // abate no PAGAMENTO SEGUINTE, como o dono pediu).
    let clienteNome = '';
    try {
      const { data: com } = await supabase.from('comissoes')
        .select('cliente_id').eq('gateway_payment_id', gatewayPaymentId).eq('gateway', 'rede').limit(1).maybeSingle();
      if (com?.cliente_id) {
        const { data: cli } = await supabase.from('perfis').select('nome').eq('id', com.cliente_id).maybeSingle();
        clienteNome = (cli?.nome || '').trim();
      }
    } catch { /* sem nome: segue com descrição genérica */ }
    // Comissão MULTINÍVEL + BÔNUS INFINITO: um pagamento gera N lançamentos (origem_id =
    // <pay>-n1..n5 da rede e <pay>-inf1..N da liderança). Reverte TODOS, cada um idempotente
    // por um origem_id de estorno próprio.
    const { data: lancs } = await supabase.from('saldo_lancamentos')
      .select('id, user_id, valor, origem_id, origem_tipo')
      .in('tipo', ['comissao_rede', 'comissao_infinito']).like('origem_id', `${gatewayPaymentId}-%`);
    let estornado = 0;
    for (const l of (lancs || [])) {
      const estOid = `estorno-${l.origem_id}`;
      const { data: ja } = await supabase.from('saldo_lancamentos')
        .select('id').eq('origem_id', estOid).eq('tipo', 'estorno_comissao').maybeSingle();
      if (!ja && Number(l.valor) > 0) {
        await supabase.from('saldo_lancamentos').insert({
          user_id: l.user_id, tipo: 'estorno_comissao', valor: -Number(l.valor),
          origem_tipo: l.origem_tipo || 'assinatura', origem_id: estOid,
          descricao: `Estorno de comissão — ${motivoTxt.toUpperCase()}${clienteNome ? ` do cliente ${clienteNome}` : ''} (${gateway}); descontado do saldo/pagamento seguinte`, status: 'disponivel',
        });
        estornado += Number(l.valor);
      }
    }
    // Cancela as comissoes de rede deste pagamento e REGISTRA o motivo + o cliente no relatório.
    await supabase.from('comissoes').update({ status: 'cancelado',
      referencia: `Cancelada por ${motivoTxt}${clienteNome ? ` do cliente ${clienteNome}` : ''}` })
      .eq('gateway_payment_id', gatewayPaymentId).eq('gateway', 'rede').neq('status', 'cancelado');
    if (!lancs || lancs.length === 0) return { skipped: 'sem_comissao' };
    return { ok: true, estornado };
  } catch (e) {
    console.error(`[${gateway}] estornarComissao:`, e.message);
    return { erro: e.message };
  }
}

// ── PAGAMENTO CONFIRMADO ──────────────────────────────────────────────────────
export async function processarConfirmado({ valor, descricao, email, gatewayCustomerId, gatewayPaymentId, gateway, servico }) {
  const cliente = await buscarCliente({ gatewayCustomerId, email, gateway });
  if (!cliente) {
    console.log(`[${gateway}] perfil não encontrado — id=${gatewayCustomerId} email=${email}`);
    return { skipped: 'perfil_nao_encontrado' };
  }

  // Pagamento avulso de SERVIÇO (mp-checkout sem planoId): apenas limpa
  // inadimplência; NUNCA mapeia valor→plano (senão um serviço de R$500/5000/99,90
  // elevaria o plano do cliente "de graça"). mapeado=null pula toda a elevação.
  const mapeado = servico ? null : mapearPlano(valor, descricao);

  // Atualiza perfil. NÃO limpar inadimplência aqui: um pagamento de SERVIÇO (mapeado=null)
  // não restaura o plano — se limpasse a flag sem restaurar o role, deixaria role_anterior
  // órfão e a recuperação na próxima renovação do Pro falharia (o cliente viraria top2 e
  // perderia o assessorado para sempre). A limpeza da flag só acontece com plano mapeado.
  const campoId = gateway === 'mercadopago' ? 'mp_id' : 'asaas_id';
  const update = {
    [campoId]: gatewayCustomerId || undefined,
  };
  if (mapeado) {
    update.inadimplente_desde = null;
    // NÃO gravar `plano`: a coluna tem check constraint (gratuito|analista|gestor) e
    // planoKey 'top2'/'clube'/'assessorado' a VIOLA → o update inteiro falhava (throw),
    // deixando o cliente PAGO sem acesso (bug ativo no caminho Asaas / fallback, que usa
    // este processarConfirmado). O TIER mora em `role` — mesma correção do ativarPlanoDireto.
    // Escada anti-flip (mesma do ativarPlanoDireto): a renovação do Pro de um cliente
    // que virou assessorado NÃO pode rebaixá-lo; recuperação de inadimplência restaura
    // o role suspenso (role_anterior), que também nunca é rebaixado pelo valor pago.
    const candidato = (cliente.role_anterior && cliente.inadimplente_desde)
      ? roleAposPagamento(cliente.role_anterior, mapeado.role)
      : mapeado.role;
    update.role = roleAposPagamento(cliente.role, candidato) ?? mapeado.role;
    if (cliente.role_anterior && cliente.inadimplente_desde) update.role_anterior = null;
    // Garantia de 7 dias (CDC art. 49): ancora plano_pago_em na 1ª ativação paga —
    // MESMO critério do ativarPlanoDireto. Sem isto, quem paga via Asaas ou plano ANUAL
    // avulso (ambos caem NESTE caminho, não no ativarPlanoDireto) ficava com
    // plano_pago_em=null e tinha o reembolso de 7 dias NEGADO indevidamente
    // (garantia-cancelar.js: dentro7 = null → reembolso:false). Renovação/reativação
    // (já pagante OU já ancorado) não reinicia a janela.
    const PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
    if (!cliente.plano_pago_em && !PAGANTES.includes(cliente.role)) {
      update.plano_pago_em = new Date().toISOString();
    }
    // Grava o CICLO do pagamento (mensal/anual). Antes só o mp.js mensal gravava 'mensal'
    // fixo e o anual (avulso via link/webhook) não gravava nada → plano_ciclo='anual' nunca
    // existia e a proteção anti-rebaixamento do anual (reconciliar-cron, marcar-posse) ficava
    // órfã. Para o ANUAL, também ancora a vigência de 12 meses (usada pela proteção e, no
    // futuro, pela renovação/troca de ciclo).
    if (mapeado.ciclo) {
      update.plano_ciclo = mapeado.ciclo;
      if (mapeado.ciclo === 'anual') {
        const venc = new Date(); venc.setMonth(venc.getMonth() + 12);
        update.plano_vencimento = venc.toISOString();
      } else {
        // Mensal confirmado → limpa qualquer agendamento anual→mensal (idempotente). É por
        // aqui que a regra (b) se materializa quando o cliente re-assina no ciclo mensal.
        update.ciclo_agendado = null;
      }
    }
  }

  // Só grava se há algo REAL a atualizar. Sem isto, um pagamento de SERVIÇO sem customer id
  // (MP avulso com payer.id null) montaria update={[campoId]:undefined} → PATCH de corpo
  // vazio (borda apontada na auditoria de regressão). Remove chaves undefined e pula se vazio.
  for (const k of Object.keys(update)) if (update[k] === undefined) delete update[k];
  if (Object.keys(update).length > 0) {
    const { error } = await supabase.from('perfis').update(update).eq('id', cliente.id);
    if (error) throw new Error(error.message);
  }

  // Grava preço contratado (trava de 12 meses para recorrência)
  if (mapeado) {
    try {
      await supabase.rpc('registrar_preco_contratado', {
        p_user_id:   cliente.id,
        p_plano_key: mapeado.plano,
      });
    } catch (e) {
      console.error(`[${gateway}] registrar_preco_contratado:`, e.message);
    }
  }

  // NFS-e (serviço) — GANCHO preparado; no-op enquanto NFSE_* não configurado.
  // Quando ativo, emite a nota do tomador (perfil) com o valor pago. Nunca
  // bloqueia a ativação do plano (try/catch + função que não lança).
  if (mapeado && Number(valor) > 0 && nfseAtivo()) {
    try {
      const { data: tomador } = await supabase.from('perfis')
        .select('nome, cpf, cpf_enc, endereco_cep, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf')
        .eq('id', cliente.id).single();
      const cpfTomador = await cpfDoRegistro(tomador);
      const r = await emitirNFSeServico({
        tomador: { ...(tomador || {}), cpf: cpfTomador, email },
        valor,
        descricao: descricao || `Assinatura ${mapeado.plano} — BidPro Brasil`,
        referencia: gatewayPaymentId,
      });
      if (r?.ok) console.log(`[${gateway}] NFS-e emitida (${mapeado.plano})`);
      else if (!r?.skipped) console.error(`[${gateway}] NFS-e falhou:`, JSON.stringify(r).slice(0, 300));
    } catch (e) {
      console.error(`[${gateway}] NFS-e (gancho):`, e.message);
    }
  }

  // COMISSÃO MULTINÍVEL (Programa de Parceiros) — substitui o nível-único de afiliado.
  // Distribui pela árvore indicado_por, SÓ para uplines PAGANTES (compressão dinâmica),
  // com os % de comissao_regras (tipo 'assinatura'). NÃO comissiona honorário de êxito
  // nem recarga de crédito (esta função só roda no pagamento de ASSINATURA recorrente).
  // Idempotente por pagamento+nível dentro de distribuir_comissao_rede.
  if (mapeado && gatewayPaymentId) {
    try {
      // Trilho por produto: alto ticket (Assessoria/Leilão Club) usa 'venda_direta' — indicação
      // REDUZIDA (protege a eficiência); os demais (Investidor Pro) usam 'assinatura' (atrativo).
      const p_tipo = ['assessorado', 'assessorado_anual', 'clube', 'clube_anual'].includes(mapeado.plano)
        ? 'venda_direta' : 'assinatura';
      const { data: dist } = await supabase.rpc('distribuir_comissao_rede', {
        p_comprador: cliente.id, p_tipo, p_valor: valor, p_gateway_payment_id: gatewayPaymentId,
      });
      if (dist && dist.ok === false) console.warn(`[${gateway}] comissao_rede:`, JSON.stringify(dist).slice(0, 200));
    } catch (e) {
      console.error(`[${gateway}] comissao_rede:`, e.message);
      // alertarErro é SÍNCRONO e recebe UM objeto { rota, erro, extra } — chamá-lo com args
      // posicionais e .catch() em cima do retorno (undefined) lançava TypeError aqui dentro.
      alertarErro({ rota: `webhook/${gateway}`, erro: `Falha na comissão de rede: ${e.message}`, extra: { cliente_id: cliente?.id } });
    }
  }

  // CONVERSÃO DE ANÚNCIO — este é o caminho do pagamento INICIAL (Asaas e MP), inclusive o
  // PIX confirmado depois que o cliente já saiu do checkout. Ele estava SEM medição alguma:
  // o Meta CAPI só era disparado em `ativarPlanoDireto` (recorrência), então a primeira venda
  // — a que decide se a campanha é lucrativa — só contava quando o navegador conseguia
  // avisar. Com PIX, muitas vezes não conseguia.
  await registrarConversaoAnuncio({
    userId: cliente.id, valor, gateway, email,
    base: mapeado?.plano ? planoBase(mapeado.plano) : (servico ? 'servico' : 'avulso'),
  });

  return { ok: true, plano: mapeado?.plano };
}

// ── PAGAMENTO VENCIDO ─────────────────────────────────────────────────────────
export async function processarVencido({ gatewayCustomerId, email, gateway }) {
  const cliente = await buscarCliente({ gatewayCustomerId, email, gateway });
  if (cliente && !cliente.inadimplente_desde) {
    const ROLES_PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
    const update = { inadimplente_desde: new Date().toISOString().slice(0, 10) };
    if (ROLES_PAGANTES.includes(cliente.role)) {
      update.role_anterior = cliente.role;
      update.role = 'explorador';
    }
    // Derruba a âncora anual: reembolso/chargeback/renovação-falha do anual não pode deixar
    // plano_ciclo='anual'+plano_vencimento vigentes, senão marcar-posse/reconciliar
    // re-concedem top2 sobre dinheiro devolvido (P2.2). ciclo_agendado também é limpo.
    update.plano_vencimento = null;
    update.ciclo_agendado = null;
    await supabase.from('perfis').update(update).eq('id', cliente.id);
    // LGPD Art. 16 — documentos pessoais retidos por 90 dias após cancelamento
    await setExpiracaoDocumentos(cliente.id);
  }
  return { ok: true };
}

// ── CHARGEBACK / DISPUTA ──────────────────────────────────────────────────────
// Identifica o chargeback, monta o dossiê de defesa (aceite com IP/UA/versão +
// pagamento), registra em `chargebacks`, suspende o acesso e alerta a equipe.
// TODO (pendência): submissão AUTOMÁTICA da defesa via API de disputas do MP.
// Adiado até poder validar contra a API real — ver docs/PENDENCIAS_PAGAMENTOS.md.
// Hoje o dossiê fica pronto e copiável em /admin/chargebacks (envio manual).
export async function processarChargeback({ valor, descricao, email, gatewayCustomerId, gatewayPaymentId, gatewaySubscriptionId, gateway, evento, motivo, raw }) {
  const cliente = await buscarCliente({ gatewayCustomerId, email, gateway });

  // Busca o aceite mais relevante (por pagamento → por usuário → por email)
  let aceite = null;
  try {
    if (gatewayPaymentId) {
      const { data } = await supabase.from('aceites_plano').select('*')
        .or(`asaas_payment_id.eq.${gatewayPaymentId},asaas_subscription_id.eq.${gatewayPaymentId}`)
        .order('aceito_em', { ascending: false }).limit(1);
      aceite = data?.[0] || null;
    }
    if (!aceite && cliente?.id) {
      const { data } = await supabase.from('aceites_plano').select('*')
        .eq('user_id', cliente.id).order('aceito_em', { ascending: false }).limit(1);
      aceite = data?.[0] || null;
    }
    if (!aceite && email) {
      const { data } = await supabase.from('aceites_plano').select('*')
        .eq('user_email', email).order('aceito_em', { ascending: false }).limit(1);
      aceite = data?.[0] || null;
    }
  } catch (e) { console.error(`[${gateway}] dossiê aceite:`, e.message); }

  const dossie = {
    resumo: 'Defesa de chargeback — serviço digital (plataforma de análise de leilões) contratado, com aceite eletrônico dos termos e acesso disponibilizado ao cliente.',
    cliente: { id: cliente?.id || null, email: email || aceite?.user_email || null },
    pagamento: { gateway, payment_id: gatewayPaymentId, subscription_id: gatewaySubscriptionId || null, valor, descricao: descricao || motivo || evento },
    aceite: aceite ? {
      aceito_em: aceite.aceito_em, ip: aceite.ip, user_agent: aceite.user_agent,
      termos_versao: aceite.termos_versao, plano_key: aceite.plano_key, valor: aceite.valor, gateway: aceite.gateway || null,
    } : null,
    gerado_em: new Date().toISOString(),
  };

  try {
    await supabase.from('chargebacks').upsert({
      gateway,
      gateway_payment_id: gatewayPaymentId,
      gateway_subscription_id: gatewaySubscriptionId || null,
      user_id: cliente?.id || null,
      user_email: email || aceite?.user_email || null,
      plano_key: aceite?.plano_key || null,
      valor,
      status: 'aberto',
      motivo: motivo || descricao || evento,
      evento,
      dossie,
      defesa_status: aceite ? 'pendente' : 'sem_evidencia',
      raw: raw || null,
      atualizado_em: new Date().toISOString(),
    }, { onConflict: 'gateway,gateway_payment_id' });
  } catch (e) {
    console.error(`[${gateway}] insert chargeback:`, e.message);
  }

  // Suspende o acesso (mesmo efeito de inadimplência) enquanto a disputa corre
  try { await processarVencido({ gatewayCustomerId, email, gateway }); } catch (_) {}

  // Estorna a comissão de afiliado deste pagamento (o dinheiro voltou → a comissão
  // não é mais devida). Evita "refund + comissão paga" (perda dupla).
  try { await estornarComissao({ gatewayPaymentId, gateway, motivo: 'chargeback' }); } catch (_) {}

  // Alerta a equipe
  // Assinatura correta ({rota,erro,extra}, síncrona). Antes: dois args posicionais + .catch()
  // sobre undefined → TypeError JUSTO AQUI, depois de já ter gravado o chargeback e suspendido
  // o acesso: a equipe nunca recebia o alerta e o webhook devolvia 5xx ao gateway em TODO
  // chargeback (com o evento já marcado como processado, a reentrega era descartada).
  alertarErro({
    rota: `webhook/${gateway}/chargeback`,
    erro: `Chargeback recebido — ${email || gatewayPaymentId} — R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Defesa: ${aceite ? 'dossiê pronto' : 'SEM evidência de aceite'}.`,
    extra: { gatewayPaymentId, plano: aceite?.plano_key, temAceite: !!aceite },
  });

  return { ok: true, chargeback: true, defesa: aceite ? 'dossie_pronto' : 'sem_evidencia' };
}

// ── REEMBOLSO (refund) ────────────────────────────────────────────────────────
// Diferente de chargeback (que é DISPUTA e abre dossiê de defesa): reembolso é o estorno
// voluntário/administrativo. O dinheiro voltou → a comissão de rede daquele pagamento não é
// mais devida (senão: indicar → comissão vira 'disponivel' → reembolso → sacar = fraude).
// `suspender` (padrão true no reembolso TOTAL) rebaixa o acesso; no PARCIAL fica false
// (o cliente pagou a maior parte) — a reconciliação re-ativa se a assinatura seguir ativa.
export async function processarReembolso({ valor, email, gatewayCustomerId, gatewayPaymentId, gateway, suspender = true }) {
  if (suspender) {
    try { await processarVencido({ gatewayCustomerId, email, gateway }); } catch (_) { /* não bloqueia o estorno */ }
  }
  let estorno = null;
  try { estorno = await estornarComissao({ gatewayPaymentId, gateway, motivo: 'reembolso' }); } catch (e) { estorno = { erro: e?.message || String(e) }; }
  alertarErro({
    rota: `webhook/${gateway}/reembolso`,
    erro: `Reembolso processado — ${email || gatewayPaymentId} — R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Comissão de rede estornada${suspender ? '; acesso suspenso' : ' (reembolso parcial — acesso mantido)'}.`,
    extra: { gatewayPaymentId },
  });
  return { ok: true, reembolso: true, suspenso: suspender, estorno };
}

async function setExpiracaoDocumentos(userId) {
  const expira = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
  // Só seta em docs que ainda não têm expira_em (não sobrescreve prazo já existente)
  await supabase.from('usuario_docs')
    .update({ expira_em: expira })
    .eq('user_id', userId)
    .is('expira_em', null);
}

// ── PAGAMENTO RECUSADO ────────────────────────────────────────────────────────
export async function processarRecusado({ gatewayCustomerId, email, motivo, gateway, servico = false }) {
  const cliente = await buscarCliente({ gatewayCustomerId, email, gateway });
  if (cliente) {
    const ROLES_PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
    const update = {
      pagamento_erro:      motivo || 'RECUSADO',
      pagamento_erro_data: new Date().toISOString(),
    };
    // SERVIÇO AVULSO NÃO É ASSINATURA (05/08): recarga de crédito, assessoria avulsa ou
    // PIX de anuidade ABANDONADO chegam aqui com metadata.tipo='servico'. O chamador já
    // marcava `contexto.servico`, mas esta função nem recebia o campo — então o assinante
    // EM DIA que desistia de um PIX avulso era rebaixado a 'explorador', ganhava
    // inadimplente_desde e tinha os documentos agendados para expurgo LGPD (90 dias).
    // O guard de `ehProdutoMp` no webhook cobria só PRODUTO; serviço passava reto.
    // Falha de cobrança avulsa registra o erro, mas NUNCA suspende o plano vigente.
    if (servico) {
      await supabase.from('perfis').update(update).eq('id', cliente.id);
      return { ok: true, servico: true, suspensao_ignorada: true };
    }
    // Só suspende se ainda não está inadimplente (evita sobrescrever role_anterior já salvo)
    if (ROLES_PAGANTES.includes(cliente.role) && !cliente.inadimplente_desde) {
      update.inadimplente_desde = new Date().toISOString().slice(0, 10);
      update.role_anterior = cliente.role;
      update.role = 'explorador';
      await supabase.from('perfis').update(update).eq('id', cliente.id);
      // LGPD Art. 16 — documentos pessoais retidos por 90 dias após cancelamento
      await setExpiracaoDocumentos(cliente.id);
    } else {
      await supabase.from('perfis').update(update).eq('id', cliente.id);
    }
  }
  return { ok: true };
}
