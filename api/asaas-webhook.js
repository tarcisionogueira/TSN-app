import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY, // chave service_role (não a anon)
);

const PLANO_POR_VALOR = {
  197: 'analista',
  497: 'gestor',
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

  const plano = PLANO_POR_VALOR[Math.round(valor)] || 'analista';

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
