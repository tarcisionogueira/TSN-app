import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // chave service_role (não a anon)
);

// Tolerância de ±1 para evitar problema com arredondamento de gateway
function dentroFaixa(valor, alvo, tol = 1) {
  return Math.abs(valor - alvo) <= tol;
}

function mapearPorValor(valor, descricao) {
  const v = Number(valor) || 0;
  const desc = (descricao || '').toLowerCase();
  if (dentroFaixa(v, 49.9))   return { plano: 'top1',        role: 'top1'        };
  if (dentroFaixa(v, 99.9))   return { plano: 'top2',        role: 'top2'        };
  if (dentroFaixa(v, 499.9))  return { plano: 'assessorado', role: 'assessorado' };
  if (dentroFaixa(v, 5000)) {
    return desc.includes('assessorado')
      ? { plano: 'assessorado', role: 'assessorado' }
      : { plano: 'clube',       role: 'clube'       };
  }
  if (dentroFaixa(v, 48000, 50)) return { plano: 'clube',    role: 'clube'       };
  return null;
}

// Busca o perfil do cliente priorizando asaas_id, com fallback por email
async function buscarCliente(asaasCustomerId, email) {
  // 1. Tenta por asaas_id (mais confiável)
  if (asaasCustomerId) {
    const { data } = await supabase
      .from('perfis')
      .select('id, indicado_por, role, role_anterior, inadimplente_desde')
      .eq('asaas_id', asaasCustomerId)
      .maybeSingle();
    if (data) return data;
  }

  // 2. Fallback: busca o user_id pelo email em auth.users via RPC
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

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Verifica token secreto do webhook (configurado no painel Asaas)
  const webhookToken = process.env.ASAAS_WEBHOOK_TOKEN;
  if (webhookToken) {
    const receivedToken = req.headers['asaas-access-token'] || req.headers['authorization']?.replace('Bearer ', '');
    if (receivedToken !== webhookToken) {
      console.warn('Webhook: token inválido recebido');
      return res.status(401).json({ error: 'Não autorizado' });
    }
  }

  const event = req.body;

  // Validação mínima: rejeita payloads sem estrutura esperada
  if (!event || typeof event.event !== 'string' || !event.payment) {
    return res.status(400).json({ error: 'Payload inválido' });
  }

  const tipo = event.event;
  const pagamento = event.payment;
  const email = pagamento?.customer?.email;
  const asaasCustomerId = pagamento?.customer?.id;
  const valor = pagamento?.value;

  // Rejeita eventos sem identificador de cliente
  if (tipo !== 'PAYMENT_REFUSED' && !email && !asaasCustomerId) {
    return res.status(200).json({ ok: true, skipped: 'sem_identificador_cliente' });
  }

  // ── Pagamento vencido: registra inadimplência ──
  if (tipo === 'PAYMENT_OVERDUE') {
    const cliente = await buscarCliente(asaasCustomerId, email);
    if (cliente) {
      // Só marca inadimplente se ainda não foi marcado (evita sobrescrever a data original)
      if (!cliente.inadimplente_desde) {
        await supabase
          .from('perfis')
          .update({ inadimplente_desde: new Date().toISOString().slice(0, 10) })
          .eq('id', cliente.id);
      }
    }
    return res.status(200).json({ ok: true });
  }

  // ── Pagamento confirmado / recebido ──
  if (tipo === 'PAYMENT_CONFIRMED' || tipo === 'PAYMENT_RECEIVED') {
    if (!email && !asaasCustomerId) return res.status(200).json({ ok: true });

    const cliente = await buscarCliente(asaasCustomerId, email);
    if (!cliente) {
      console.log(`Webhook: perfil não encontrado — asaas_id=${asaasCustomerId} email=${email}`);
      return res.status(200).json({ ok: true, skipped: 'perfil_nao_encontrado' });
    }

    const mapeado = valor ? mapearPorValor(valor, pagamento?.description) : null;

    // Prepara update: limpa inadimplência, atualiza plano/role se mapeado
    const update = {
      inadimplente_desde: null,
      asaas_id: asaasCustomerId || undefined,
    };

    if (mapeado) {
      update.plano = mapeado.plano;
      // Restaura role: se estava inadimplente (role_anterior guardado), volta ao anterior
      // Senão usa o role do plano pago
      update.role = cliente.role_anterior && cliente.inadimplente_desde
        ? cliente.role_anterior
        : mapeado.role;
      // Limpa role_anterior após restaurar
      if (cliente.role_anterior && cliente.inadimplente_desde) {
        update.role_anterior = null;
      }
    }

    const { error } = await supabase.from('perfis').update(update).eq('id', cliente.id);
    if (error) {
      console.error('Webhook Supabase error:', error.message);
      return res.status(500).json({ error: error.message });
    }

    // ── Comissão de afiliado (consultor) ──
    if (cliente.indicado_por && mapeado) {
      try {
        const { data: consultor } = await supabase
          .from('perfis')
          .select('comissao_afiliado_pct, role, ativo')
          .eq('id', cliente.indicado_por)
          .single();

        // Só registra comissão se consultor estiver ativo
        if (consultor?.role === 'consultor' && consultor?.ativo !== false) {
          const pct = Number(consultor.comissao_afiliado_pct || 0);
          if (pct > 0) {
            const valorComissao = Number((valor * pct / 100).toFixed(2));
            const { data: existente } = await supabase
              .from('comissoes')
              .select('id')
              .eq('asaas_payment_id', pagamento.id)
              .maybeSingle();

            if (!existente) {
              await supabase.from('comissoes').insert({
                beneficiario_id: cliente.indicado_por,
                cliente_id: cliente.id,
                tipo: 'afiliado',
                origem: 'assinatura',
                referencia: `Assinatura ${mapeado.plano}`,
                valor_base: valor,
                percentual: pct,
                valor_comissao: valorComissao,
                competencia: new Date().toISOString().slice(0, 10),
                status: 'pendente',
                asaas_payment_id: pagamento.id,
              });
            }
          }
        }
      } catch (e) {
        console.error('Comissão afiliado error:', e.message);
      }
    }

    return res.status(200).json({ ok: true, plano: mapeado?.plano });
  }

  // ── Pagamento recusado ──
  if (tipo === 'PAYMENT_REFUSED') {
    const cliente = await buscarCliente(asaasCustomerId, email);
    if (cliente) {
      const motivo = pagamento?.refusedReason || 'PAYMENT_REFUSED';
      // Registra o motivo de recusa para exibir ao usuário na próxima sessão
      await supabase.from('perfis').update({
        pagamento_erro: motivo,
        pagamento_erro_data: new Date().toISOString(),
      }).eq('id', cliente.id);
    }
    return res.status(200).json({ ok: true, event: 'refused' });
  }

  // Outros eventos ignorados
  return res.status(200).json({ ok: true });
}
