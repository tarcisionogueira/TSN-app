-- 14/09: pedido do dono — "explorador só nível 1 de comissionamento, Investidor Pro (e demais
-- planos pagos) todos os níveis". Até aqui, a profundidade de cada beneficiário na rede
-- (quantos níveis abaixo dele ainda pagam) era governada pelo RANK dele (comissao_ranks.max_nivel,
-- trilha Pioneiro→Lenda, independente do plano) — um explorador Guardião e um top2 Pioneiro
-- tinham profundidades diferentes das que essa regra pretende agora. Passa a ser pelo PAPEL:
-- eh_pagante() (top2/top2_anual/assessorado/assessorado_anual/clube/clube_anual) = todos os
-- níveis ativos de comissao_regras; explorador = só nível 1 (indicação direta). O rank CONTINUA
-- existindo e seguindo governando só o bônus infinito (bloco logo abaixo, inalterado) — só
-- parou de limitar profundidade de rede.
create or replace function public.distribuir_comissao_rede(p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_cur uuid; v_role text; v_next uuid; v_aceite timestamptz;
  v_ativo boolean; v_inad timestamptz; v_venc date;
  v_nivel int := 0; v_pct numeric; v_valor_com numeric; v_hops int := 0;
  v_total numeric := 0; v_pagos jsonb := '[]'::jsonb; v_oid text; v_maxdepth int;
  v_max int := (select coalesce(max(nivel),5) from public.comissao_regras where ativo);
  v_inf numeric; v_inf_pago numeric := 0; v_inf_com numeric; v_oid_inf text;
  v_empresa uuid := (select empresa_uid from public.rank_config where id = 1);
begin
  if p_comprador is null or coalesce(p_valor,0) <= 0
     or p_tipo not in ('assinatura','produto','venda_direta') or coalesce(p_gateway_payment_id,'') = ''
  then return jsonb_build_object('ok', false, 'erro', 'parametros'); end if;

  -- Venda SEM indicante = venda da EMPRESA (o dono): na 1ª venda paga sem upline,
  -- raiz o comprador sob a empresa para o repasse fluir p/ ela (saldo retido até PJ).
  -- Idempotente (só quando indicado_por é null) e nunca auto-atribui a empresa a si mesma.
  if v_empresa is not null and p_comprador <> v_empresa then
    update public.perfis set indicado_por = v_empresa
     where id = p_comprador and indicado_por is null;
  end if;

  select indicado_por into v_cur from public.perfis where id = p_comprador;
  while v_cur is not null and v_hops < 30 loop
    v_hops := v_hops + 1;
    select role, indicado_por, parceiro_aceite_em, ativo, inadimplente_desde, plano_vencimento
      into v_role, v_next, v_aceite, v_ativo, v_inad, v_venc
      from public.perfis where id = v_cur;
    if v_cur = v_empresa or (public.pode_ganhar_comissao(v_role) and v_aceite is not null
       and coalesce(v_ativo, true) and v_inad is null and (v_venc is null or v_venc >= current_date))
    then
      v_nivel := v_nivel + 1;
      if v_nivel <= v_max then
        -- Profundidade por PAPEL (ver comentário no topo do arquivo): pagante = todos os
        -- níveis ativos; explorador = o teto que a regra 'comissao.profundidade_por_papel'
        -- configurar (hoje 1) — lido do dado, não fixo no código, para o dono poder mudar
        -- sem nova migração, e para auditoria_regras_negocio() confirmar que esta função
        -- de fato aplica a regra (ela verifica se a CHAVE aparece no corpo compilado —
        -- comentário não conta, o Postgres descarta comentário do pg_get_functiondef).
        v_maxdepth := case when public.eh_pagante(v_role) then v_max
                            else coalesce((public.regra('comissao.profundidade_por_papel')->>'explorador_max_nivel')::int, 1) end;
        if v_nivel <= v_maxdepth then
          select pct into v_pct from public.comissao_regras where tipo = p_tipo and nivel = v_nivel and ativo;
          if coalesce(v_pct,0) > 0 then
            v_valor_com := round(p_valor * v_pct / 100.0, 2);
            v_oid := p_gateway_payment_id || '-n' || v_nivel;
            if v_valor_com > 0 and not exists (select 1 from public.saldo_lancamentos where origem_id = v_oid and tipo = 'comissao_rede') then
              insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
                values (v_cur, p_comprador, 'rede_n'||v_nivel, p_tipo, 'Comissão de rede nível '||v_nivel, p_valor, v_pct, v_valor_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
              insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
                values (v_cur, 'comissao_rede', v_valor_com, p_tipo, v_oid, 'Comissão nível '||v_nivel||' ('||p_tipo||')', 'disponivel');
              v_total := v_total + v_valor_com;
              v_pagos := v_pagos || jsonb_build_object('nivel', v_nivel, 'beneficiario', v_cur, 'pct', v_pct, 'valor', v_valor_com);
            end if;
          end if;
        end if;
      end if;
      select coalesce(cr.bonus_infinito_pct, 0) into v_inf
        from public.perfis pp left join public.comissao_ranks cr on cr.rank_key = pp.rank_key where pp.id = v_cur;
      if coalesce(v_inf,0) > v_inf_pago then
        v_inf_com := round(p_valor * (v_inf - v_inf_pago) / 100.0, 2);
        v_oid_inf := p_gateway_payment_id || '-inf' || v_nivel;
        if v_inf_com > 0 and not exists (select 1 from public.saldo_lancamentos where origem_id = v_oid_inf and tipo = 'comissao_infinito') then
          insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
            values (v_cur, p_comprador, 'infinito', p_tipo, 'Bônus infinito (liderança)', p_valor, (v_inf - v_inf_pago), v_inf_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
          insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
            values (v_cur, 'comissao_infinito', v_inf_com, p_tipo, v_oid_inf, 'Bônus infinito ('||p_tipo||')', 'disponivel');
          v_total := v_total + v_inf_com;
          v_pagos := v_pagos || jsonb_build_object('infinito', true, 'beneficiario', v_cur, 'pct', (v_inf - v_inf_pago), 'valor', v_inf_com);
        end if;
        v_inf_pago := v_inf;
      end if;
    end if;
    v_cur := v_next;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'niveis_pagos', v_nivel, 'detalhe', v_pagos);
end; $function$;

-- Fonte de verdade das regras vigentes (auditoria_regras_negocio() acusa se ninguém aplicar).
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'comissao.profundidade_por_papel',
  jsonb_build_object('explorador_max_nivel', 1, 'pagante_max_nivel', 'todos'),
  'Profundidade de comissão de rede é por PAPEL do beneficiário, não mais pelo rank (14/09, pedido do dono). Explorador (parceiro grátis) só ganha como indicante DIRETO (nível 1). Qualquer plano pago (top2/top2_anual/assessorado/assessorado_anual/clube/clube_anual, mesmo critério de eh_pagante()) ganha em todos os níveis ativos de comissao_regras. O rank (comissao_ranks) continua existindo e seguindo governando só o bônus infinito (bonus_infinito_pct) — parou de limitar profundidade de rede, que era o comportamento antigo (cada beneficiário só recebia se a própria posição na cadeia coubesse no max_nivel do PRÓPRIO rank).',
  array['distribuir_comissao_rede'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();
