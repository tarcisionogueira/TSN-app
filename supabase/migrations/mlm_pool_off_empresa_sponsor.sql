-- Ajustes do MLM (pedidos do dono):
-- (1) POOL de 2% DESLIGADO — o repasse gradual (bônus infinito sobre TODA a rede, das faixas
--     de liderança) já cobre o papel do pool. Não precisa de rateio fechado.
-- (3) EMPRESA (casa) como patrocinadora das vendas SEM indicante: config empresa_uid + o nó
--     empresa é sempre elegível no distribuir (ganha o repasse mesmo sendo admin/não-assinante).
--     O saldo fica retido para a empresa (saque exige PJ). Alinhamento dos 2 Investidor Pro sem
--     upline p/ o dono é DADO (feito à parte), não migração.

update public.rank_config set pool_pct = 0 where id = 1;

alter table public.rank_config add column if not exists empresa_uid uuid;
-- Setar o empresa_uid para o id do dono/empresa no ambiente (feito por UPDATE fora da migração
-- para não fixar um uuid; aqui só garante a coluna). Ex.:
--   update public.rank_config set empresa_uid = '<uuid-do-dono>' where id = 1;

CREATE OR REPLACE FUNCTION public.distribuir_comissao_rede(p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
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

  select indicado_por into v_cur from public.perfis where id = p_comprador;
  while v_cur is not null and v_hops < 30 loop
    v_hops := v_hops + 1;
    select role, indicado_por, parceiro_aceite_em, ativo, inadimplente_desde, plano_vencimento
      into v_role, v_next, v_aceite, v_ativo, v_inad, v_venc
      from public.perfis where id = v_cur;
    if v_cur = v_empresa or (public.eh_pagante(v_role) and v_aceite is not null
       and coalesce(v_ativo, true) and v_inad is null and (v_venc is null or v_venc >= current_date))
    then
      v_nivel := v_nivel + 1;
      if v_nivel <= v_max then
        select coalesce(cr.max_nivel, 1) into v_maxdepth
          from public.perfis pp left join public.comissao_ranks cr on cr.rank_key = pp.rank_key where pp.id = v_cur;
        if v_nivel <= coalesce(v_maxdepth, 1) then
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
