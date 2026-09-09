-- 09/09: Inadimplentes/Reembolsos pendentes saíram do Dashboard geral (não é visão de negócio,
-- é cobrança) e foram pra Financeiro. `inadimplentes` já existia aqui; faltava
-- `reembolsos_pendentes` — mesma query que admin_dashboard_contadores() já usa, só espelhada.
create or replace function public.financeiro_resumo(p_meses integer DEFAULT 6)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_ini timestamptz := date_trunc('month', now());
  res jsonb;
begin
  select jsonb_build_object(
    'mes_atual', jsonb_build_object(
      'mensalidades', (select coalesce(sum(valor),0) from mp_pagamentos where origem='recorrente' and user_id is not null and status='approved' and criado_em >= v_ini),
      'vendas',       (select coalesce(sum(valor),0) from mp_pagamentos where origem='avulso'     and user_id is not null and status='approved' and criado_em >= v_ini),
      'saidas',       (select coalesce(sum(-valor),0) from saldo_lancamentos where tipo='saque' and status='sacado' and coalesce(pago_em,criado_em) >= v_ini),
      'a_pagar',      (select coalesce(sum(-valor),0) from saldo_lancamentos where status='solicitado')
    ),
    'assinantes', jsonb_build_object(
      'ativos',        (select count(*) from mp_assinaturas where status='authorized'),
      'mrr_projetado', (select coalesce(sum( nullif(dados_mp->'auto_recurring'->>'transaction_amount','')::numeric ),0)
                          from mp_assinaturas where status='authorized')
    ),
    'inadimplentes',        (select count(*) from perfis where inadimplente_desde is not null),
    'reembolsos_pendentes', (select count(*) from reembolsos_garantia where status = 'solicitado'),
    'saldo_a_pagar_total',  (select coalesce(sum(saldo_disponivel),0) from saldo_usuarios where saldo_disponivel > 0),
    'serie', (
      select coalesce(jsonb_agg(linha order by mes), '[]'::jsonb) from (
        select to_char(m, 'YYYY-MM') as mes,
          jsonb_build_object(
            'mes', to_char(m, 'YYYY-MM'),
            'mensalidades', (select coalesce(sum(valor),0) from mp_pagamentos where origem='recorrente' and user_id is not null and status='approved' and criado_em >= m and criado_em < m + interval '1 month'),
            'vendas',       (select coalesce(sum(valor),0) from mp_pagamentos where origem='avulso'     and user_id is not null and status='approved' and criado_em >= m and criado_em < m + interval '1 month')
          ) as linha
        from generate_series(date_trunc('month', now()) - ((greatest(p_meses,1)-1) || ' months')::interval,
                             date_trunc('month', now()), interval '1 month') m
      ) s
    )
  ) into res;
  return res;
end; $function$;
