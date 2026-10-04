-- 04/10 (revisão de segurança dos webhooks): estornarComissao lia "já existe?" e depois inseria —
-- chargeback e reembolso do MESMO pagamento (chaves de evento diferentes) correm em paralelo e
-- ambos inseriam: afiliado debitado 2×. Índice único parcial; o código trata 23505 como "já feito".
-- Aplicado em 04/10 (0 linhas de estorno_comissao no momento — sem conflito).
create unique index if not exists uq_saldo_estorno_comissao_origem
  on public.saldo_lancamentos (origem_id)
  where tipo = 'estorno_comissao' and origem_id is not null;
