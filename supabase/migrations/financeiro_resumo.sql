-- Resumo financeiro (sintético + série p/ analítico) — pedido do dono: separar REAL recebido
-- (mensalidades × vendas) das PROJEÇÕES (MRR se todos efetivarem). Lê as tabelas LOCAIS
-- (mp_pagamentos/mp_assinaturas/saldo_lancamentos) — econômico, sem chamar gateway a cada load.
create or replace function public.financeiro_resumo(p_meses int default 6)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_ini timestamptz := date_trunc('month', now());
  res jsonb;
begin
  select jsonb_build_object(
    'mes_atual', jsonb_build_object(
      -- REAL recebido no mês
      'mensalidades', (select coalesce(sum(valor),0) from mp_pagamentos where origem='recorrente' and status='approved' and criado_em >= v_ini),
      'vendas',       (select coalesce(sum(valor),0) from mp_pagamentos where origem='avulso'     and status='approved' and criado_em >= v_ini),
      -- Saídas (repasses pagos) e fila a pagar
      'saidas',       (select coalesce(sum(-valor),0) from saldo_lancamentos where tipo='saque' and status='sacado' and coalesce(pago_em,criado_em) >= v_ini),
      'a_pagar',      (select coalesce(sum(-valor),0) from saldo_lancamentos where status='solicitado')
    ),
    'assinantes', jsonb_build_object(
      'ativos',        (select count(*) from mp_assinaturas where status='authorized'),
      -- PROJEÇÃO: MRR se todas as assinaturas ativas seguirem sendo cobradas (valor real do preapproval).
      'mrr_projetado', (select coalesce(sum( nullif(dados_mp->'auto_recurring'->>'transaction_amount','')::numeric ),0)
                          from mp_assinaturas where status='authorized')
    ),
    'inadimplentes',        (select count(*) from perfis where inadimplente_desde is not null),
    'saldo_a_pagar_total',  (select coalesce(sum(saldo_disponivel),0) from saldo_usuarios where saldo_disponivel > 0),
    -- Série mensal (analítico): mensalidades × vendas dos últimos p_meses.
    'serie', (
      select coalesce(jsonb_agg(linha order by mes), '[]'::jsonb) from (
        select to_char(m, 'YYYY-MM') as mes,
          jsonb_build_object(
            'mes', to_char(m, 'YYYY-MM'),
            'mensalidades', (select coalesce(sum(valor),0) from mp_pagamentos where origem='recorrente' and status='approved' and criado_em >= m and criado_em < m + interval '1 month'),
            'vendas',       (select coalesce(sum(valor),0) from mp_pagamentos where origem='avulso'     and status='approved' and criado_em >= m and criado_em < m + interval '1 month')
          ) as linha
        from generate_series(date_trunc('month', now()) - ((greatest(p_meses,1)-1) || ' months')::interval,
                             date_trunc('month', now()), interval '1 month') m
      ) s
    )
  ) into res;
  return res;
end; $$;
revoke all on function public.financeiro_resumo(int) from public, anon, authenticated;
grant execute on function public.financeiro_resumo(int) to service_role;
