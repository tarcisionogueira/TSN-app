import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // chave service_role (não a anon)
);

// Mapeia o valor pago (arredondado) para o plano correspondente
const PLANO_POR_VALOR = {
  50: 'top1',      // R$ 49,90 (arredonda para 50)
  100: 'top2',     // R$ 99,90 (arredonda para 100)
  5000: 'clube',   // mensalidade do Clube de Negócios / Assessorado
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const event = req.body;
  const tipo = event.event;

  // Só processa pagamentos confirmados
  if (tipo !== 'PAYMENT_CONFIRMED' && tipo !== 'PAYMENT_RECEIVED') {
    return res.status(200).json({ ok: true });
  }

  const pagamento = event.payment;
  const email = pagamento?.customer?.email;
  const valor = pagamento?.value;

  if (!email || !valor) return res.status(200).json({ ok: true });

  const plano = PLANO_POR_VALOR[Math.round(valor)] || 'top1';

  // Localiza o perfil do cliente (precisamos do id para a comissão de afiliado)
  const { data: cliente } = await supabase
    .from('perfis')
    .select('id, indicado_por')
    .eq('email', email)
    .single();

  // Atualiza plano do cliente
  const { error } = await supabase
    .from('perfis')
    .update({ plano, asaas_id: pagamento.customer?.id })
    .eq('email', email);

  if (error) {
    console.error('Webhook Supabase error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  // ── Comissão de afiliado (consultor) ──
  // Se o cliente foi indicado por um consultor, registra a comissão recorrente
  // sobre a assinatura paga. A fatia sai da parte da TSN.
  if (cliente?.indicado_por) {
    try {
      const { data: consultor } = await supabase
        .from('perfis')
        .select('comissao_afiliado_pct, role')
        .eq('id', cliente.indicado_por)
        .single();

      if (consultor?.role === 'consultor') {
        const pct = Number(consultor.comissao_afiliado_pct || 0);
        if (pct > 0) {
          const valorComissao = Number((valor * pct / 100).toFixed(2));
          // Evita duplicar comissão para o mesmo pagamento
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
              referencia: `Assinatura ${plano}`,
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
      // não falha o webhook por causa da comissão
    }
  }

  return res.status(200).json({ ok: true, plano });
}
