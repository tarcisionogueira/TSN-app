-- "Toda venda tem a MESMA regra de saque": a base do saldo (saldo_usuarios) cobria só
-- a equipe operacional. Na nova modelagem (MLM + ranks), o CLIENTE PAGANTE também recebe
-- (comissão de rede, bônus de rank, venda direta) e deve sacar pela MESMA regra (razão
-- saldo_lancamentos, pagamento sexta 12h, mesmos pré-requisitos de KYC/PIX). Basta incluir
-- os papéis de cliente pagante na view — o /api/saque e a aba Parceiros já usam essa base.
create or replace view public.saldo_usuarios as
  select p.id as user_id, p.nome, p.role, p.chave_pix,
    coalesce(sum(sl.valor) filter (where sl.status <> 'cancelado'), 0::numeric) as saldo_disponivel,
    coalesce(- sum(sl.valor) filter (where sl.status = 'sacado'), 0::numeric) as total_sacado,
    coalesce(- sum(sl.valor) filter (where sl.status = 'solicitado'), 0::numeric) as saque_pendente
  from public.perfis p
  left join public.saldo_lancamentos sl on sl.user_id = p.id
  where p.role = any (array[
    'admin','analista','advogado','consultor',
    'top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual'
  ])
  group by p.id, p.nome, p.role, p.chave_pix;
