-- ─────────────────────────────────────────────────────────────────────────────
-- AS CONCESSÕES SOMAM  (27/08/2026) — correção do dono
-- ESTADO FINAL de `comprar_produto_iniciar` e `confirmar_compra_produto`.
-- Substitui a parte de concessão de `lancamento_plano_e_combo.sql`, do mesmo dia.
--
-- Eu tinha implementado "vale a MAIOR, nunca a soma". É o oposto do modelo dele:
--   "ambos os cursos eu colocaria este benefício isoladamente em 3 meses para cada curso"
-- Ou seja: cada curso concede 3 meses de Investidor Pro NO CADASTRO DELE, e quem leva os
-- dois pelo upsell soma 3 + 3 = 6. O benefício é do curso; o combo é a consequência.
--
-- Isso é melhor do que a concessão na oferta que eu tinha feito: o benefício acompanha o
-- produto para onde ele for (vendido sozinho, em outro upsell, numa promoção futura) em
-- vez de precisar ser redeclarado em cada oferta onde ele aparece.
-- A concessão NA OFERTA continua existindo e continua tendo precedência — serve para o
-- caso em que o bônus é da combinação, não dos produtos.
--
-- ── DUAS TRAVAS, PORQUE AGORA SOMA ───────────────────────────────────────────
-- (a) Soma dentro do MESMO plano. Quando os planos diferem, vence o mais alto com os meses
--     dele — os meses do plano menor NÃO entram. Somar entre degraus entregaria meses de
--     Assessoria que ninguém prometeu como Assessoria.
-- (b) Teto de 36 meses no total. Sem teto, um erro de cadastro (3 meses digitados como 36
--     em cinco produtos) vira acesso vitalício de graça, e a escada só sabe subir: não há
--     como o erro voltar sozinho.
--
-- ── E POR QUE O BENEFÍCIO DO EXTRA É GRAVADO NA COMPRA ───────────────────────
-- O extra entra como linha `via_bonus`, que o gatilho de entrega NÃO reprocessa — então o
-- `concede_plano` do cadastro dele nunca seria aplicado. Capturar no início da compra
-- resolve isso e ainda congela o que foi prometido: entre iniciar e o webhook confirmar,
-- alguém pode editar o cadastro, e o cliente recebe o que foi oferecido a ele.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.comprar_produto_iniciar(
  p_user_id uuid, p_produto_tipo text, p_produto_id uuid,
  p_ref text default null, p_extras jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
  -- Regra de negócio aplicada aqui: produto.order_bump, produto.janela_oferta, produto.concede_plano
declare
  v_titulo text; v_preco numeric; v_com numeric; v_ativo boolean; v_gratis text[];
  v_role text; v_ref_cod text; v_compra_id uuid; v_bumps jsonb; v_upsell jsonb; v_ofertas jsonb;
  v_item jsonb; v_et text; v_eid uuid; v_epreco numeric; v_eativo boolean;
  v_desc numeric; v_cobrado numeric; v_extras_ok jsonb := '[]'::jsonb; v_total numeric;
  v_vig jsonb; v_oferta jsonb; v_ep text; v_em int;
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','sem_usuario'); end if;
  if p_produto_tipo not in ('ebook','curso') then return jsonb_build_object('ok',false,'erro','tipo'); end if;

  if p_produto_tipo = 'ebook' then
    select titulo, coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb), coalesce(upsell_produtos,'[]'::jsonb)
      into v_titulo, v_com, v_ativo, v_gratis, v_bumps, v_upsell from ebooks_admin where id = p_produto_id;
  else
    select titulo, coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb), coalesce(upsell_produtos,'[]'::jsonb)
      into v_titulo, v_com, v_ativo, v_gratis, v_bumps, v_upsell from cursos_admin where id = p_produto_id;
  end if;
  v_ofertas := coalesce(v_bumps,'[]'::jsonb) || coalesce(v_upsell,'[]'::jsonb);

  if v_titulo is null or not v_ativo then return jsonb_build_object('ok',false,'erro','indisponivel'); end if;

  -- Preço pelo avaliador único, que resolve a janela. NUNCA pelo que a tela mandou.
  v_vig := produto_preco_vigente(p_produto_tipo, p_produto_id);
  v_preco := coalesce((v_vig->>'preco')::numeric, 0);
  if v_preco <= 0 then return jsonb_build_object('ok',false,'erro','gratuito'); end if;

  select coalesce(role,'explorador') into v_role from perfis where id = p_user_id;
  v_role := coalesce(v_role,'explorador');
  if v_role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual','consultor','analista','advogado','admin')
     or v_role = any(v_gratis)
     or (v_role = 'top2' and 'top2_anual' = any(v_gratis))
     or exists (select 1 from compras_produtos where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id and status='ativo')
  then
    return jsonb_build_object('ok',true,'ja_tem',true);
  end if;

  v_total := v_preco;

  if jsonb_typeof(coalesce(p_extras,'[]'::jsonb)) = 'array' then
    for v_item in select * from jsonb_array_elements(p_extras) loop
      v_et := nullif(v_item->>'tipo','');
      begin v_eid := (v_item->>'id')::uuid; exception when others then v_eid := null; end;
      continue when v_et is null or v_et not in ('curso','ebook') or v_eid is null or v_eid = p_produto_id;

      select b into v_oferta
        from jsonb_array_elements(v_ofertas) b
       where b->>'id' = v_eid::text and b->>'tipo' = v_et
       limit 1;
      continue when not found;
      v_desc := least(greatest(coalesce((v_oferta->>'desconto_pct')::numeric, 0), 0), 90);

      -- Benefício DO PRODUTO extra. Sem isto ele nunca seria aplicado: a linha do extra
      -- nasce `via_bonus`, e o gatilho de entrega não reprocessa esse tipo de linha.
      if v_et = 'ebook' then
        select coalesce(ativo,false), concede_plano, concede_meses
          into v_eativo, v_ep, v_em from ebooks_admin where id = v_eid;
      else
        select coalesce(ativo,false), concede_plano, concede_meses
          into v_eativo, v_ep, v_em from cursos_admin where id = v_eid;
      end if;
      -- A oferta, quando declara, TEM PRECEDÊNCIA: é o caso em que o bônus é da combinação
      -- e não do produto. Sem declaração, vale o benefício que o produto já carrega.
      if coalesce(v_oferta->>'concede_plano','') <> '' then
        v_ep := v_oferta->>'concede_plano';
        begin v_em := nullif(v_oferta->>'concede_meses','')::int; exception when others then v_em := null; end;
      end if;

      -- O extra também vale pelo preço vigente dele: se o bump está em janela própria,
      -- o desconto do bump incide sobre o preço da janela, não sobre o cheio.
      v_epreco := coalesce((produto_preco_vigente(v_et, v_eid)->>'preco')::numeric, 0);
      continue when v_epreco is null or not coalesce(v_eativo,false) or v_epreco <= 0;
      continue when exists (select 1 from compras_produtos
                             where user_id=p_user_id and produto_id=v_eid and status='ativo');
      continue when exists (select 1 from jsonb_array_elements(v_extras_ok) x where x->>'id' = v_eid::text);

      v_cobrado := round(v_epreco * (1 - v_desc/100.0), 2);
      v_total := v_total + v_cobrado;
      v_extras_ok := v_extras_ok || jsonb_build_object(
        'tipo', v_et, 'id', v_eid, 'valor_cobrado', v_cobrado,
        'desconto_pct', v_desc, 'valor_cheio', v_epreco,
        'concede_plano', nullif(v_ep,''),
        'concede_meses', v_em);
    end loop;
  end if;

  if coalesce(p_ref,'') <> '' then
    select codigo_indicacao into v_ref_cod from perfis
      where codigo_indicacao = upper(p_ref) and id <> p_user_id limit 1;
  end if;

  select id into v_compra_id from compras_produtos
    where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id
      and status='pendente' and criado_em > now() - interval '2 hours'
      and coalesce(itens_extras,'[]'::jsonb) = v_extras_ok
      -- Pendente com OUTRO valor não pode ser reaproveitado: a janela pode ter fechado
      -- entre a primeira tentativa e esta, e reusar a linha cobraria o preço velho.
      and valor = v_total
    order by criado_em desc limit 1;
  if v_compra_id is null then
    insert into compras_produtos (user_id, produto_tipo, produto_id, valor, status, ref_codigo, comissao_pct, itens_extras)
      values (p_user_id, p_produto_tipo, p_produto_id, v_total, 'pendente', v_ref_cod, v_com, v_extras_ok)
      returning id into v_compra_id;
  end if;

  return jsonb_build_object('ok',true,'ja_tem',false,'compra_id',v_compra_id,'valor',v_total,
                            'titulo',v_titulo,'comissao_pct',v_com,'extras',v_extras_ok,
                            'em_janela', coalesce((v_vig->>'em_janela')::boolean, false));
end; $function$;

revoke all on function public.comprar_produto_iniciar(uuid, text, uuid, text, jsonb) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- ⚠️ LIÇÃO CARA DESTE DIA, que vale para quem for mexer aqui: ao reescrever esta função eu
-- parti do .sql que a criou, e não da função VIVA — que já tinha ganhado depois o bloco de
-- entrega de BÔNUS. O resultado teria sido bônus deixando de ser entregue, sem erro nenhum:
-- cliente paga o curso e simplesmente não recebe o material prometido junto. Nada no build,
-- lint ou teste de front pegaria. Quem pegou foi `auditoria_regras_negocio()`.
-- Ao recriar função de dinheiro, a base é `pg_get_functiondef` do banco, NUNCA o arquivo
-- que a criou: o arquivo é o começo da história dela, não o estado dela.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.confirmar_compra_produto(
  p_compra_id uuid, p_gateway text, p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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
  if v_status = 'ativo' then return jsonb_build_object('ok',true,'ja_ativo',true); end if;
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
                            'ate', v_ate, 'bonus_concedidos', v_bonus_dados);
end; $function$;

revoke all on function public.confirmar_compra_produto(uuid, text, text) from public, anon, authenticated;

update public.regra_negocio set
  valor = jsonb_build_object(
    'escada_so_sobe', true,
    'vencimento_estende_nunca_encurta', true,
    'papel_de_equipe_intocado', true,
    'ciclo', 'cortesia',
    'origem_produto_ou_oferta', true,
    'meses_somam_no_mesmo_plano', true,
    'planos_diferentes_vence_o_maior_sem_somar', true,
    'teto_meses', 36
  ),
  descricao = 'Compra de produto pode conceder plano por N meses, configurado no cadastro do '
    'produto (concede_plano/concede_meses) e opcionalmente na OFERTA (bump/upsell), que tem '
    'precedência. AS CONCESSÕES SOMAM dentro do mesmo plano: cada curso concede 3 meses de '
    'Investidor Pro, e quem leva os dois pelo upsell recebe 6. Planos DIFERENTES não somam — '
    'vence o mais alto com os meses dele, porque somar entre degraus entregaria meses de um '
    'plano superior que ninguém prometeu naquele degrau. Teto de 36 meses no total: sem ele um '
    'erro de cadastro vira acesso vitalício, e a escada só sobe. A escada (só sobe, vencimento '
    'estende e nunca encurta, papel de equipe intocado) mora em conceder_plano_usuario. O '
    'benefício do item extra é capturado em itens_extras no INÍCIO da compra: a linha do extra '
    'nasce via_bonus e o gatilho de entrega não a reprocessa, então o cadastro dele nunca seria '
    'lido — e congelar o prometido protege o cliente de edição feita entre iniciar e confirmar.',
  aplicada_por = array['confirmar_compra_produto','conceder_plano_usuario','comprar_produto_iniciar']
where chave = 'produto.concede_plano';
