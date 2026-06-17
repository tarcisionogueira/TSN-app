import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // chave service_role (não a anon)
);

// Mapeia o valor pago (arredondado) para o plano correspondente
const PLANO_POR_VALOR = {
  50: 'top1',      // R$ 49,90 (arredonda para 50)
  80: 'top2',      // R$ 79,90 (arredonda para 80)
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

  // Atualiza perfil no Supabase pelo email
  const { error } = await supabase
    .from('perfis')
    .update({ plano, asaas_id: pagamento.customer?.id })
    .eq('email', email);

  if (error) {
    console.error('Webhook Supabase error:', error.message);
    return res.status(500).json({ error: error.message });
  }

  return res.status(200).json({ ok: true, plano });
}
