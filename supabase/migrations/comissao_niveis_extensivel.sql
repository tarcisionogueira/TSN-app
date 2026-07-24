-- Comissionamento: torna a PROFUNDIDADE extensível (o dono decide quantos níveis ativar
-- inserindo linhas em comissao_regras) e a distribuição passa a respeitar o MAIOR nível
-- ativo, em vez de fixo em 5. Matemática segura: mesmo com a cauda cheia, o total de %
-- (assinatura 16%, produto 30%, venda_direta 17%) fica muito abaixo da margem.

alter table public.comissao_regras drop constraint if exists comissao_regras_nivel_check;
alter table public.comissao_regras add constraint comissao_regras_nivel_check check (nivel between 1 and 10);

create or replace function public.distribuir_comissao_rede(
  p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_cur uuid; v_role text; v_next uuid;
  v_nivel int := 0; v_pct numeric; v_valor_com numeric; v_hops int := 0;
  v_total numeric := 0; v_pagos jsonb := '[]'::jsonb; v_oid text;
  v_max int := (select coalesce(max(nivel),5) from public.comissao_regras where ativo);
begin
  if p_comprador is null or coalesce(p_valor,0) <= 0
     or p_tipo not in ('assinatura','produto','venda_direta') or coalesce(p_gateway_payment_id,'') = ''
  then return jsonb_build_object('ok', false, 'erro', 'parametros'); end if;

  select indicado_por into v_cur from public.perfis where id = p_comprador;
  while v_cur is not null and v_nivel < v_max and v_hops < 30 loop
    v_hops := v_hops + 1;
    select role, indicado_por into v_role, v_next from public.perfis where id = v_cur;
    if public.eh_pagante(v_role) then
      v_nivel := v_nivel + 1;
      select pct into v_pct from public.comissao_regras where tipo = p_tipo and nivel = v_nivel and ativo;
      if coalesce(v_pct,0) > 0 then
        v_valor_com := round(p_valor * v_pct / 100.0, 2);
        v_oid := p_gateway_payment_id || '-n' || v_nivel;
        if v_valor_com > 0 and not exists (
          select 1 from public.saldo_lancamentos where origem_id = v_oid and tipo = 'comissao_rede'
        ) then
          insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
            values (v_cur, p_comprador, 'rede_n'||v_nivel, p_tipo, 'Comissão de rede nível '||v_nivel,
                    p_valor, v_pct, v_valor_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
          insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
            values (v_cur, 'comissao_rede', v_valor_com, p_tipo, v_oid,
                    'Comissão nível '||v_nivel||' ('||p_tipo||')', 'disponivel');
          v_total := v_total + v_valor_com;
          v_pagos := v_pagos || jsonb_build_object('nivel', v_nivel, 'beneficiario', v_cur, 'pct', v_pct, 'valor', v_valor_com);
        end if;
      end if;
    end if;
    v_cur := v_next;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'niveis_pagos', v_nivel, 'detalhe', v_pagos);
end; $function$;
