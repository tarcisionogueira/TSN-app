-- REDE (níveis 2+ e bônus infinito) só sobre ASSINATURA e CURSO (16/10, decisão do dono).
--
--   assinatura ........ direta 25% + rede 4/3/2/2/1 + bônus infinito   (como já era)
--   curso ............. direta 25% + rede 4/3/2/2/1 + bônus infinito   (NOVO — antes só direta)
--   e-book ............ só direta 25%
--   assessoria/clube .. só direta 10%                                   (antes pagava rede + infinito)
--   êxito ............. só direta, 10% do honorário (api/_honorarios.js)
--
-- Regra gravada em regra_negocio 'comissao.rede_escopo' — as duas funções abaixo a citam no corpo,
-- que é o que auditoria_regras_negocio() confere. Histórico: até hoje a rede só pagou em assinatura
-- (13 lançamentos rede_n1), então não há nada retroativo a desfazer em assessoria.

-- ── 1. Assessoria/Clube (venda_direta) deixa de ter rede e bônus infinito ─────────────────────
CREATE OR REPLACE FUNCTION public.distribuir_comissao_rede(p_comprador uuid, p_tipo text, p_valor numeric, p_gateway_payment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Regra 'comissao.rede_escopo' (16/10): rede (níveis 2+) e bônus infinito só em 'assinatura'
-- (e curso, em distribuir_comissao_rede_curso). 'venda_direta' paga SÓ o nível 1.
declare
  v_cur uuid; v_role text; v_next uuid; v_aceite timestamptz;
  v_ativo boolean; v_inad timestamptz; v_venc date;
  v_nivel int := 0; v_pct numeric; v_valor_com numeric; v_hops int := 0;
  v_total numeric := 0; v_pagos jsonb := '[]'::jsonb; v_oid text; v_maxdepth int;
  v_max int := case when p_tipo = 'venda_direta' then 1
                    else (select coalesce(max(nivel),5) from public.comissao_regras where ativo) end;
  v_com_rede boolean := (p_tipo <> 'venda_direta');
  v_inf numeric; v_inf_pago numeric := 0; v_inf_com numeric; v_oid_inf text;
  v_empresa uuid := (select empresa_uid from public.rank_config where id = 1);
begin
  if p_comprador is null or coalesce(p_valor,0) <= 0
     or p_tipo not in ('assinatura','produto','venda_direta') or coalesce(p_gateway_payment_id,'') = ''
  then return jsonb_build_object('ok', false, 'erro', 'parametros'); end if;

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
      if v_com_rede then
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
      elsif v_nivel >= v_max then
        exit;  -- venda_direta: nível 1 resolvido, não há mais o que pagar acima
      end if;
    end if;
    v_cur := v_next;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'niveis_pagos', v_nivel, 'detalhe', v_pagos);
end; $function$;

-- ── 2. Curso ganha rede: níveis 2+ acima do indicante DIRETO ─────────────────────────────────
-- O nível 1 já é pago em confirmar_compra_produto (25% do comissao_pct do produto, a quem trouxe
-- o código). Aqui o indicante direto conta como nível 1 SEMPRE (não paga de novo) e a subida
-- começa no upline DELE — não no do comprador: com last-touch, quem vendeu pode não ser o
-- `indicado_por` gravado, e a rede tem de ser a de quem vendeu. Percentuais: comissao_regras
-- tipo 'produto' (4/3/2/2/1, iguais aos da assinatura). Mesmos critérios de elegibilidade e de
-- profundidade por papel da assinatura; bônus infinito igual, incluindo o do direto.
CREATE OR REPLACE FUNCTION public.distribuir_comissao_rede_curso(p_direto uuid, p_comprador uuid, p_valor numeric, p_gateway_payment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- Regra 'comissao.rede_escopo' (16/10): curso tem rede; e-book não (quem chama filtra o tipo).
declare
  v_cur uuid; v_role text; v_next uuid; v_aceite timestamptz;
  v_ativo boolean; v_inad timestamptz; v_venc date; v_elegivel boolean;
  v_nivel int := 0; v_pct numeric; v_valor_com numeric; v_hops int := 0;
  v_total numeric := 0; v_pagos jsonb := '[]'::jsonb; v_oid text; v_maxdepth int;
  v_max int := (select coalesce(max(nivel),5) from public.comissao_regras where ativo and tipo = 'produto');
  v_inf numeric; v_inf_pago numeric := 0; v_inf_com numeric; v_oid_inf text;
  v_empresa uuid := (select empresa_uid from public.rank_config where id = 1);
begin
  if p_direto is null or p_comprador is null or coalesce(p_valor,0) <= 0 or coalesce(p_gateway_payment_id,'') = ''
  then return jsonb_build_object('ok', false, 'erro', 'parametros'); end if;

  v_cur := p_direto;
  while v_cur is not null and v_hops < 30 loop
    v_hops := v_hops + 1;
    select role, indicado_por, parceiro_aceite_em, ativo, inadimplente_desde, plano_vencimento
      into v_role, v_next, v_aceite, v_ativo, v_inad, v_venc
      from public.perfis where id = v_cur;
    v_elegivel := v_cur = v_empresa or (public.pode_ganhar_comissao(v_role) and v_aceite is not null
       and coalesce(v_ativo, true) and v_inad is null and (v_venc is null or v_venc >= current_date));

    if v_cur = p_direto then
      v_nivel := 1;               -- já recebeu o nível 1 na venda; aqui só conta a posição
    elsif v_elegivel then
      v_nivel := v_nivel + 1;
      if v_nivel <= v_max then
        v_maxdepth := case when public.eh_pagante(v_role) then v_max
                            else coalesce((public.regra('comissao.profundidade_por_papel')->>'explorador_max_nivel')::int, 1) end;
        if v_nivel <= v_maxdepth then
          select pct into v_pct from public.comissao_regras where tipo = 'produto' and nivel = v_nivel and ativo;
          if coalesce(v_pct,0) > 0 then
            v_valor_com := round(p_valor * v_pct / 100.0, 2);
            v_oid := p_gateway_payment_id || '-prod-n' || v_nivel;
            if v_valor_com > 0 and not exists (select 1 from public.saldo_lancamentos where origem_id = v_oid and tipo = 'comissao_rede') then
              insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
                values (v_cur, p_comprador, 'rede_n'||v_nivel, 'produto', 'Comissão de rede nível '||v_nivel||' (curso)', p_valor, v_pct, v_valor_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
              insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
                values (v_cur, 'comissao_rede', v_valor_com, 'produto', v_oid, 'Comissão nível '||v_nivel||' (curso)', 'disponivel');
              v_total := v_total + v_valor_com;
              v_pagos := v_pagos || jsonb_build_object('nivel', v_nivel, 'beneficiario', v_cur, 'pct', v_pct, 'valor', v_valor_com);
            end if;
          end if;
        end if;
      end if;
    end if;

    if v_elegivel then
      select coalesce(cr.bonus_infinito_pct, 0) into v_inf
        from public.perfis pp left join public.comissao_ranks cr on cr.rank_key = pp.rank_key where pp.id = v_cur;
      if coalesce(v_inf,0) > v_inf_pago then
        v_inf_com := round(p_valor * (v_inf - v_inf_pago) / 100.0, 2);
        v_oid_inf := p_gateway_payment_id || '-prod-inf' || v_nivel;
        if v_inf_com > 0 and not exists (select 1 from public.saldo_lancamentos where origem_id = v_oid_inf and tipo = 'comissao_infinito') then
          insert into public.comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
            values (v_cur, p_comprador, 'infinito', 'produto', 'Bônus infinito (liderança) — curso', p_valor, (v_inf - v_inf_pago), v_inf_com, current_date, 'pendente', p_gateway_payment_id, 'rede');
          insert into public.saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
            values (v_cur, 'comissao_infinito', v_inf_com, 'produto', v_oid_inf, 'Bônus infinito (curso)', 'disponivel');
          v_total := v_total + v_inf_com;
          v_pagos := v_pagos || jsonb_build_object('infinito', true, 'beneficiario', v_cur, 'pct', (v_inf - v_inf_pago), 'valor', v_inf_com);
        end if;
        v_inf_pago := v_inf;
      end if;
    end if;
    v_cur := v_next;
  end loop;
  return jsonb_build_object('ok', true, 'total', v_total, 'niveis', v_nivel, 'detalhe', v_pagos);
end; $function$;

revoke all on function public.distribuir_comissao_rede_curso(uuid, uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.distribuir_comissao_rede_curso(uuid, uuid, numeric, text) to service_role;

-- ── 3. confirmar_compra_produto chama a rede quando o produto é CURSO ─────────────────────────
-- (corpo idêntico ao vigente; só entra o bloco marcado "REDE DO CURSO")
CREATE OR REPLACE FUNCTION public.confirmar_compra_produto(p_compra_id uuid, p_gateway text, p_gateway_payment_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  -- Regra de negócio aplicada aqui: produto.concede_plano, produto.order_bump, produto.bonus_e_upsell, comissao.rede_escopo
declare
  v_user uuid; v_valor numeric; v_status text; v_ref text; v_pct numeric; v_tipo text;
  v_ref_id uuid; v_com numeric; v_oid text; v_prod uuid; v_extras jsonb; v_item jsonb;
  v_concede text; v_meses int; v_bonus jsonb; v_bt text; v_bid uuid; v_bonus_dados int := 0;
  v_grants jsonb := '{}'::jsonb;              -- {plano: meses somados}
  v_k text; v_rank int; v_melhor_rank int := -1;
  v_plano_final text; v_meses_final int; v_ate timestamptz;
  v_rede jsonb;
  TETO_MESES constant int := 36;
begin
  select user_id, valor, status, ref_codigo, coalesce(comissao_pct,0), produto_tipo, produto_id,
         coalesce(itens_extras,'[]'::jsonb)
    into v_user, v_valor, v_status, v_ref, v_pct, v_tipo, v_prod, v_extras
    from compras_produtos where id = p_compra_id;
  if v_user is null then return jsonb_build_object('ok',false,'erro','compra_inexistente'); end if;
  if v_status = 'ativo' then return jsonb_build_object('ok',true,'ja_ativo',true,'produto_tipo',v_tipo,'produto_id',v_prod,'valor',v_valor); end if;
  if v_status <> 'pendente' then return jsonb_build_object('ok',false,'erro','status_'||v_status); end if;

  update compras_produtos
    set status='ativo', gateway=p_gateway, gateway_payment_id=p_gateway_payment_id, pago_em=now()
    where id = p_compra_id and status='pendente';

  -- ── Comissão do parceiro ───────────────────────────────────────────────────
  if coalesce(v_ref,'') <> '' and v_pct > 0 and coalesce(p_gateway_payment_id,'') <> '' then
    select id into v_ref_id from perfis where codigo_indicacao = v_ref and id <> v_user limit 1;
    if v_ref_id is not null then
      v_com := round(v_valor * v_pct / 100.0, 2);
      v_oid := p_gateway_payment_id || '-prod';
      if v_com > 0 and not exists (select 1 from saldo_lancamentos where origem_id = v_oid) then
        insert into comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
          values (v_ref_id, v_user, 'afiliado', 'produto', 'Venda de '||v_tipo, v_valor, v_pct, v_com, current_date, 'pendente', p_gateway_payment_id, p_gateway);
        insert into saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
          values (v_ref_id, 'comissao_venda', v_com, 'produto', v_oid, 'Comissao de venda de '||v_tipo, 'disponivel');
      end if;
      -- ── REDE DO CURSO (comissao.rede_escopo, 16/10) ──────────────────────────
      -- Curso paga rede (níveis 2+) acima de quem vendeu; e-book fica só no direto.
      -- Idempotente por pagamento+nível dentro da função; valor 0 (bônus) nem chega aqui.
      if v_tipo = 'curso' and v_valor > 0 then
        v_rede := distribuir_comissao_rede_curso(v_ref_id, v_user, v_valor, p_gateway_payment_id);
      end if;
    end if;
  end if;

  -- ── O que este produto concede ─────────────────────────────────────────────
  if v_tipo = 'curso' then
    select concede_plano, concede_meses, coalesce(bonus_produtos,'[]'::jsonb)
      into v_concede, v_meses, v_bonus from cursos_admin where id = v_prod;
  elsif v_tipo = 'ebook' then
    select concede_plano, concede_meses, coalesce(bonus_produtos,'[]'::jsonb)
      into v_concede, v_meses, v_bonus from ebooks_admin where id = v_prod;
  end if;
  v_bonus := coalesce(v_bonus, '[]'::jsonb);

  -- ── Bônus: os produtos que vêm junto ───────────────────────────────────────
  -- UM NÍVEL SÓ, deliberadamente: o bônus não concede os bônus dele. Dois produtos que se
  -- incluem mutuamente fariam recursão infinita, e mesmo sem ciclo a corrente de bônus de
  -- bônus entrega acesso que ninguém consegue prever lendo o cadastro.
  if jsonb_typeof(v_bonus) = 'array'
     and not exists (select 1 from compras_produtos where id = p_compra_id and via_bonus) then
    for v_item in select * from jsonb_array_elements(v_bonus) loop
      v_bt  := nullif(v_item->>'tipo','');
      begin
        v_bid := (v_item->>'id')::uuid;
      exception when others then v_bid := null;   -- id malformado no cadastro não derruba a compra
      end;
      if v_bt is not null and v_bid is not null and v_bid <> v_prod
         and not exists (select 1 from compras_produtos
                          where user_id = v_user and produto_id = v_bid and status = 'ativo') then
        insert into compras_produtos
          (user_id, produto_tipo, produto_id, valor, status, gateway, pago_em, via_bonus, origem_compra_id)
        values
          -- valor 0 e via_bonus: isto é ENTREGA, não venda. Faturamento não pode contar.
          (v_user, v_bt, v_bid, 0, 'ativo', 'bonus', now(), true, p_compra_id);
        v_bonus_dados := v_bonus_dados + 1;
      end if;
    end loop;
  end if;

  -- ── AS CONCESSÕES SOMAM ────────────────────────────────────────────────────
  -- Modelo do dono: cada curso concede 3 meses de Investidor Pro no cadastro dele; quem
  -- leva os dois pelo upsell soma 3 + 3 = 6. Junta tudo num mapa {plano: meses}.
  if coalesce(v_concede,'') <> '' and coalesce(v_meses,0) > 0 then
    v_grants := jsonb_set(v_grants, array[v_concede],
                to_jsonb(coalesce((v_grants->>v_concede)::int, 0) + v_meses));
  end if;

  if jsonb_typeof(v_extras) = 'array' then
    for v_item in select * from jsonb_array_elements(v_extras) loop
      v_concede := nullif(v_item->>'concede_plano','');
      begin v_meses := nullif(v_item->>'concede_meses','')::int; exception when others then v_meses := null; end;
      continue when coalesce(v_concede,'') = '' or coalesce(v_meses,0) <= 0;
      v_grants := jsonb_set(v_grants, array[v_concede],
                  to_jsonb(coalesce((v_grants->>v_concede)::int, 0) + v_meses));
    end loop;
  end if;

  -- Vence o plano MAIS ALTO, com os meses somados DELE. Os meses de um degrau menor não
  -- entram na conta do maior: somar entre degraus entregaria meses de Assessoria que
  -- ninguém prometeu como Assessoria.
  for v_k in select jsonb_object_keys(v_grants) loop
    v_rank := case v_k when 'explorador' then 0 when 'top2' then 1
                       when 'assessorado' then 2 when 'clube' then 3 else -1 end;
    continue when v_rank < 0;
    if v_rank > v_melhor_rank then
      v_melhor_rank := v_rank;
      v_plano_final := v_k;
      v_meses_final := (v_grants->>v_k)::int;
    end if;
  end loop;

  if coalesce(v_plano_final,'') <> '' and coalesce(v_meses_final,0) > 0 then
    -- Teto: sem ele, um erro de cadastro (3 digitado como 36, em vários produtos) vira
    -- acesso vitalício de graça — e a escada só sobe, o erro não voltaria sozinho.
    v_meses_final := least(v_meses_final, TETO_MESES);
    v_ate := conceder_plano_usuario(v_user, v_plano_final, v_meses_final);
    if v_ate is not null then
      update compras_produtos
        set plano_concedido = v_plano_final, plano_concedido_ate = v_ate
        where id = p_compra_id;
    end if;
  end if;

  return jsonb_build_object('ok',true,'ativado',true,'user_id',v_user,
                            'plano_concedido', v_plano_final, 'meses', v_meses_final,
                            'ate', v_ate, 'bonus_concedidos', v_bonus_dados,
                            'produto_tipo', v_tipo, 'produto_id', v_prod, 'valor', v_valor,
                            'rede_curso', v_rede);
end; $function$;

-- ── 4. Tabela de percentuais e regra gravada ──────────────────────────────────────────────────
-- Assessoria/Clube sem níveis 2+ também na TABELA, para a tela "Minha Rede" não exibir
-- percentual que deixou de ser pago.
update public.comissao_regras set pct = 0 where tipo = 'venda_direta' and nivel >= 2 and pct <> 0;

insert into public.regra_negocio (chave, valor, descricao, ativo, aplicada_por)
values ('comissao.rede_escopo',
        '{"rede": ["assinatura", "curso"], "so_direta": ["ebook", "venda_direta", "exito"]}'::jsonb,
        'Rede de indicação (níveis 2+ e bônus infinito) só sobre ASSINATURA (mensalidade) e CURSO. E-book, Assessoria/Leilão Club (venda_direta) e êxito de arrematação pagam apenas a indicação direta. Decisão do dono, 16/10. Curso: nível 1 é o comissao_pct do produto (25%) pago a quem vendeu; níveis 2+ seguem comissao_regras tipo produto (4/3/2/2/1) acima de quem vendeu.',
        true, array['distribuir_comissao_rede','distribuir_comissao_rede_curso','confirmar_compra_produto'])
on conflict (chave) do update set valor = excluded.valor, descricao = excluded.descricao,
  ativo = true, aplicada_por = excluded.aplicada_por;
