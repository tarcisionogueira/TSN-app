-- ─── Atualiza valores dos planos premium ─────────────────────────────────────

-- Assessorado: R$ 5.000 por arrematação (pagamento único)
UPDATE planos_config SET
  preco                   = 5000,
  preco_vista             = NULL,       -- não há desconto: é pagamento único
  desconto_vista_pct      = 0,
  preco_anual             = NULL,
  cobrar                  = true,
  assinatura              = false,
  pagamento_tipo          = 'unico',
  fidelidade_meses        = NULL,       -- não tem fidelidade, tem acesso de 12 meses
  acesso_meses            = 12,
  vinculado_arrematacao   = true,
  multa_cancelamento_pct  = 0,
  honorarios_exito_pct    = 10,
  atualizado_em           = now()
WHERE plano_key = 'assessorado';

-- Leilão Club: R$ 60.000 total, R$ 5.000/mês ou 12× cartão/PIX
-- Juros assumidos pelo cliente a partir da 4ª parcela
UPDATE planos_config SET
  preco                   = 5000,      -- parcela mensal / referência recorrente
  preco_vista             = NULL,       -- 12× = mesmo valor, sem desconto à vista
  desconto_vista_pct      = 0,
  preco_anual             = 60000,     -- total da fidelidade (12 × 5.000)
  cobrar                  = true,
  assinatura              = true,
  pagamento_tipo          = 'recorrente',
  fidelidade_meses        = 12,
  acesso_meses            = NULL,
  vinculado_arrematacao   = false,
  multa_cancelamento_pct  = 30,
  honorarios_exito_pct    = 10,
  atualizado_em           = now()
WHERE plano_key = 'clube';
