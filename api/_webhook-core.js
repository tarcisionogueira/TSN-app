/**
 * _webhook-core.js
 * Lógica de negócio compartilhada entre todos os gateways de pagamento.
 * Asaas e Pagar.me normalizam seus eventos para o formato abaixo
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

export const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
);

// ── Mapeamento valor → plano ──────────────────────────────────────────────────
// Atualizar aqui quando mudar preços. Tolerância de ±1% ou ±R$1 (o que for maior).
function dentroFaixa(valor, alvo, tol = 1) {
  return Math.abs(valor - alvo) <= Math.max(tol, alvo * 0.01);
}

export function mapearPlano(valor, descricao = '') {
  const v = Number(valor) || 0;
  const desc = descricao.toLowerCase();

  // Investidor Pro — mensal ou anual parcelado
  if (dentroFaixa(v, 99.9))  return { plano: 'top2', role: 'top2' }; // Investidor Pro mensal
  if (dentroFaixa(v, 449.9)) return { plano: 'top2', role: 'top2' }; // Investidor Pro anual (12×)

  // Leilão Club — verificar ANTES de assessorado pois ambos têm opção de R$5.000
  if (dentroFaixa(v, 5000) && desc.includes('clube')) return { plano: 'clube', role: 'clube' };
  if (dentroFaixa(v, 48000, 100)) return { plano: 'clube', role: 'clube' };
  if (dentroFaixa(v, 60000, 200)) return { plano: 'clube', role: 'clube' };

  // Assessoria — parcela mensal ou à vista
  if (dentroFaixa(v, 500))   return { plano: 'assessorado', role: 'assessorado' };
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
      .select('id, indicado_por, role, role_anterior, inadimplente_desde')
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
        .select('id, indicado_por, role, role_anterior, inadimplente_desde')
        .eq('id', userId)
        .maybeSingle();
      if (data) return data;
    }
  }

  return null;
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

  // Atualiza perfil: limpa inadimplência, atualiza plano/role
  const campoId = gateway === 'mercadopago' ? 'mp_id' : 'asaas_id';
  const update = {
    inadimplente_desde: null,
    [campoId]: gatewayCustomerId || undefined,
  };
  if (mapeado) {
    update.plano = mapeado.plano;
    update.role = (cliente.role_anterior && cliente.inadimplente_desde)
      ? cliente.role_anterior
      : mapeado.role;
    if (cliente.role_anterior && cliente.inadimplente_desde) update.role_anterior = null;
  }

  const { error } = await supabase.from('perfis').update(update).eq('id', cliente.id);
  if (error) throw new Error(error.message);

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
        .select('nome, cpf, endereco_cep, endereco_logradouro, endereco_numero, endereco_complemento, endereco_bairro, endereco_cidade, endereco_uf')
        .eq('id', cliente.id).single();
      const r = await emitirNFSeServico({
        tomador: { ...(tomador || {}), email },
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

  // Comissão de afiliado
  if (cliente.indicado_por && mapeado && gatewayPaymentId) {
    try {
      const { data: consultor } = await supabase
        .from('perfis')
        .select('comissao_afiliado_pct, role, ativo')
        .eq('id', cliente.indicado_por)
        .single();

      // Comissão fixa de indicação: consultor, analista e advogado podem indicar
      if (['consultor', 'analista', 'advogado'].includes(consultor?.role) && consultor?.ativo !== false) {
        const pct = Number(consultor.comissao_afiliado_pct || 0);
        if (pct > 0) {
          const valorComissao = Number((valor * pct / 100).toFixed(2));
          const { data: existente } = await supabase
            .from('comissoes')
            .select('id')
            .eq('gateway_payment_id', gatewayPaymentId)
            .eq('origem', 'assinatura')
            .maybeSingle();

          if (!existente) {
            await supabase.from('comissoes').insert({
              beneficiario_id:  cliente.indicado_por,
              cliente_id:       cliente.id,
              tipo:             'afiliado',
              origem:           'assinatura',
              referencia:       `Assinatura ${mapeado.plano} via ${gateway}`,
              valor_base:       valor,
              percentual:       pct,
              valor_comissao:   valorComissao,
              competencia:      new Date().toISOString().slice(0, 10),
              status:           'pendente',
              gateway_payment_id: gatewayPaymentId,
              gateway,
            });
            // Credita o saldo unificado (razão saldo_lancamentos) — fonte do saque
            await supabase.from('saldo_lancamentos').insert({
              user_id: cliente.indicado_por, tipo: 'comissao_venda', valor: valorComissao,
              origem_tipo: 'assinatura', origem_id: gatewayPaymentId,
              descricao: `Comissão de afiliado — ${mapeado.plano} (${pct.toFixed(2)}%)`, status: 'disponivel',
            });
          }
        }
      }
    } catch (e) {
      console.error(`[${gateway}] comissao:`, e.message);
      alertarErro(`[${gateway}] Falha ao registrar comissão de afiliado: ${e.message}`, { cliente_id: cliente?.id, indicado_por: cliente?.indicado_por }).catch(() => {});
    }
  }

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

  // Alerta a equipe
  alertarErro(
    `⚠️ Chargeback recebido (${gateway}) — ${email || gatewayPaymentId} — R$ ${Number(valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}. Defesa: ${aceite ? 'dossiê pronto' : 'SEM evidência de aceite'}.`,
    { gatewayPaymentId, plano: aceite?.plano_key, temAceite: !!aceite },
  ).catch(() => {});

  return { ok: true, chargeback: true, defesa: aceite ? 'dossie_pronto' : 'sem_evidencia' };
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
export async function processarRecusado({ gatewayCustomerId, email, motivo, gateway }) {
  const cliente = await buscarCliente({ gatewayCustomerId, email, gateway });
  if (cliente) {
    const ROLES_PAGANTES = ['top2', 'assessorado', 'clube', 'top2_anual', 'assessorado_anual', 'clube_anual'];
    const update = {
      pagamento_erro:      motivo || 'RECUSADO',
      pagamento_erro_data: new Date().toISOString(),
    };
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
