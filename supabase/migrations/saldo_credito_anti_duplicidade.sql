-- Blindagem do ledger contra crédito em dobro (auditoria de repasses 15/07/2026).
-- A comissão de assinatura já era protegida por um índice único em comissoes
-- (gateway_payment_id) — o saldo só era creditado se a comissão vencesse o INSERT.
-- O HONORÁRIO de êxito não tinha guarda equivalente: dois "finalizar" concorrentes
-- na mesma arrematação (ex.: duplo clique) liam honorarios_status='pendente' e
-- inseriam os lançamentos duas vezes → repasse dobrado.
--
-- Correção: um crédito é ÚNICO por (usuário, tipo, origem). Assim, a 2ª inserção
-- concorrente falha atomicamente e o saldo nunca é creditado em dobro. Índice parcial:
-- só cobre créditos com origem (honorario_exito/comissao_venda); saques não entram.
create unique index if not exists uq_saldo_credito_origem
  on public.saldo_lancamentos (user_id, tipo, origem_tipo, origem_id)
  where tipo in ('honorario_exito','comissao_venda') and origem_id is not null;
