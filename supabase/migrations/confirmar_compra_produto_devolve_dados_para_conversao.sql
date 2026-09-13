-- ═══════════════════════════════════════════════════════════════════════════════
-- confirmar_compra_produto passa a devolver produto_tipo/produto_id/valor (12/09)
-- ═══════════════════════════════════════════════════════════════════════════════
-- POR QUE: api/mp-webhook.js e api/asaas-webhook.js chamam esta RPC para ativar a
-- compra de ebook/curso avulso, mas NUNCA disparavam a conversão de anúncio
-- (Meta CAPI + Google Ads offline) para essa venda — auditoria de rastreamento
-- pedida pelo dono achou que essa compra não gera Purchase em lugar NENHUM (nem
-- client-side nem server-side). Os webhooks já têm o `result` desta RPC em mãos
-- no momento exato da confirmação; só faltava ela devolver o que os webhooks
-- precisam para montar o evento (produto_tipo/produto_id para content_ids/
-- content_type, valor para o value da conversão) sem uma segunda consulta.
-- Nenhuma outra linha do corpo muda — só o jsonb_build_object final ganha 3 campos.
create or replace function public.confirmar_compra_produto(p_compra_id uuid, p_gateway text, p_gateway_payment_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
  -- Regra de negócio aplicada aqui: produto.concede_plano, produto.order_bump, produto.bonus_e_upsell
declare
  v_user uuid; v_valor numeric; v_status text; v_ref text; v_pct numeric; v_tipo text;
  v_ref_id uuid; v_com numeric; v_oid text; v_prod uuid; v_extras jsonb; v_item jsonb;
  v_concede text; v_meses int; v_bonus jsonb; v_bt text; v_bid uuid; v_bonus_dados int := 0;
  v_grants jsonb := '{}'::jsonb;              -- {plano: meses somados}
  v_k text; v_rank int; v_melhor_rank int := -1;
  v_plano_final text; v_meses_final int; v_ate timestamptz;
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
                            'produto_tipo', v_tipo, 'produto_id', v_prod, 'valor', v_valor);
end; $function$;
