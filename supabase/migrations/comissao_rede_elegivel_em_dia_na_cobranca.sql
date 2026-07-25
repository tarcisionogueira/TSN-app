-- Regra do dono: a comissão de rede só é DEVIDA ao upline que, NA DATA DA COBRANÇA do indicado
-- (e da rede abaixo), está com a assinatura EM DIA — não basta ser pagante genérico. Antes a
-- função só exigia eh_pagante(role)+aceite; agora exige também ATIVO, NÃO inadimplente e NÃO
-- vencida na data. Quem não está em dia é PULADO (compressão dinâmica: sobe p/ o próximo elegível).
CREATE OR REPLACE FUNCTION public.distribuir_comissao_rede(p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cur uuid; v_role text; v_next uuid; v_aceite timestamptz;
  v_ativo boolean; v_inad timestamptz; v_venc date;
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
    select role, indicado_por, parceiro_aceite_em, ativo, inadimplente_desde, plano_vencimento
      into v_role, v_next, v_aceite, v_ativo, v_inad, v_venc
      from public.perfis where id = v_cur;
    -- ELEGIBILIDADE NA DATA DA COBRANÇA: upline PAGANTE, que ACEITOU o programa, e com a
    -- assinatura EM DIA AGORA (ativo, sem inadimplência, dentro do vencimento). Se não estiver
    -- em dia, é PULADO — a comissão sobe para o próximo upline elegível (compressão dinâmica).
    if public.eh_pagante(v_role) and v_aceite is not null
       and coalesce(v_ativo, true)
       and v_inad is null
       and (v_venc is null or v_venc >= current_date)
    then
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
