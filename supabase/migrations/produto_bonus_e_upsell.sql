-- ─────────────────────────────────────────────────────────────────────────────
-- BÔNUS E UPSELL NO CADASTRO DE PRODUTO  (26/08/2026)
--
-- Pedido do dono: "na tela de cadastro de cursos pode colocar algo como bônus e poder
-- incluir outros produtos ou mensalidade. Assim como poder vincular outros cursos ou
-- ebooks como upsell."
--
-- SÃO DUAS COISAS DIFERENTES, e confundi-las custa dinheiro nos dois sentidos:
--   • BÔNUS  — o cliente RECEBE junto, sem pagar a mais. Vira acesso na hora da compra.
--   • UPSELL — o cliente é CONVIDADO a comprar também. Não vira acesso; vira oferta.
-- Um bônus tratado como upsell é entrega que não acontece (o cliente pagou e não recebeu);
-- um upsell tratado como bônus é receita entregue de graça.
--
-- Com isto, o combo do lançamento ("os dois cursos + 6 meses de Investidor Pro") deixa de
-- precisar de código próprio: é um produto com dois bônus de produto e um bônus de plano.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. O que o produto carrega ───────────────────────────────────────────────
alter table public.cursos_admin
  add column if not exists bonus_produtos  jsonb not null default '[]'::jsonb,
  add column if not exists upsell_produtos jsonb not null default '[]'::jsonb;

alter table public.ebooks_admin
  add column if not exists bonus_produtos  jsonb not null default '[]'::jsonb,
  add column if not exists upsell_produtos jsonb not null default '[]'::jsonb,
  -- Simetria com cursos_admin: um eBook também pode conceder plano. A versão de ontem
  -- só olhava curso (`if v_tipo = 'curso'`), o que tornava a concessão um privilégio do
  -- tipo em vez de uma propriedade do produto.
  add column if not exists concede_plano text,
  add column if not exists concede_meses int;

comment on column public.cursos_admin.bonus_produtos is
  'Produtos entregues JUNTO na compra, sem custo extra: [{"tipo":"curso|ebook","id":"uuid"}]';
comment on column public.cursos_admin.upsell_produtos is
  'Produtos OFERECIDOS ao cliente (ele paga à parte). Não concede acesso.';

-- ── 2. O bônus tem de ser distinguível de uma venda ──────────────────────────
-- Sem isto, um combo com dois cursos vira TRÊS linhas ativas em compras_produtos e
-- qualquer contagem de vendas passa a mentir para cima. É o mesmo erro que fez a despesa
-- da conta virar faturamento em 25/08 — dado sem origem vira número plausível e errado.
alter table public.compras_produtos
  add column if not exists via_bonus boolean not null default false,
  add column if not exists origem_compra_id uuid references public.compras_produtos(id);

create index if not exists idx_compras_produtos_origem on public.compras_produtos(origem_compra_id)
  where origem_compra_id is not null;

comment on column public.compras_produtos.via_bonus is
  'true = veio de bônus de outra compra, NÃO é venda. Sempre valor 0. Excluir de faturamento.';

-- ── 3. A concessão ───────────────────────────────────────────────────────────
create or replace function public.confirmar_compra_produto(
  p_compra_id uuid, p_gateway text, p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_user uuid; v_valor numeric; v_status text; v_ref text; v_pct numeric; v_tipo text;
  v_ref_id uuid; v_com numeric; v_oid text; v_prod uuid;
  v_concede text; v_meses int; v_bonus jsonb;
  v_role_atual text; v_venc_atual timestamptz; v_ciclo text;
  v_rank_atual int; v_rank_novo int; v_role_final text; v_venc_novo timestamptz;
  v_item jsonb; v_bt text; v_bid uuid; v_bonus_dados int := 0;
begin
  select user_id, valor, status, ref_codigo, coalesce(comissao_pct,0), produto_tipo, produto_id
    into v_user, v_valor, v_status, v_ref, v_pct, v_tipo, v_prod
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

  -- ── O que este produto concede — por PRODUTO, não por tipo ─────────────────
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
  -- Só entra aqui quem NÃO é bônus: `via_bonus` da compra de origem barra o segundo nível.
  if jsonb_typeof(v_bonus) = 'array'
     and not exists (select 1 from compras_produtos where id = p_compra_id and via_bonus) then
    for v_item in select * from jsonb_array_elements(v_bonus) loop
      v_bt  := nullif(v_item->>'tipo','');
      begin
        v_bid := (v_item->>'id')::uuid;
      exception when others then v_bid := null;   -- id malformado no cadastro não derruba a compra
      end;
      -- Não conceder o próprio produto, e não duplicar o que o cliente já tem.
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

  -- ── Bônus de plano (a mensalidade inclusa) ─────────────────────────────────
  if coalesce(v_concede,'') <> '' and coalesce(v_meses,0) > 0 then
    select role, plano_vencimento, plano_ciclo
      into v_role_atual, v_venc_atual, v_ciclo
      from perfis where id = v_user;

    -- A ESCADA, espelhando RANK_PLANO de api/_webhook-core.js:37. Só SOBE.
    -- Papel de equipe (admin/analista/consultor/advogado) tem rank nulo e NUNCA é tocado.
    v_rank_atual := case v_role_atual
      when 'explorador' then 0 when 'top2' then 1 when 'top2_anual' then 1
      when 'assessorado' then 2 when 'assessorado_anual' then 2
      when 'clube' then 3 when 'clube_anual' then 3 else null end;
    v_rank_novo := case v_concede
      when 'explorador' then 0 when 'top2' then 1
      when 'assessorado' then 2 when 'clube' then 3 else null end;

    if v_rank_novo is not null and (v_role_atual is null or v_rank_atual is not null) then
      v_role_final := case
        when coalesce(v_rank_atual,-1) >= v_rank_novo then v_role_atual
        else v_concede end;

      -- O vencimento ESTENDE, nunca encurta.
      v_venc_novo := greatest(coalesce(v_venc_atual, now()), now()) + (v_meses || ' months')::interval;
      if v_venc_atual is not null and v_venc_atual > v_venc_novo then
        v_venc_novo := v_venc_atual;
      end if;

      update perfis set
        role = coalesce(v_role_final, role),
        role_anterior = case when role_anterior is null and v_role_final is distinct from v_role_atual
                             then v_role_atual else role_anterior end,
        plano_vencimento = v_venc_novo,
        -- 'cortesia' e não 'anual': o rebaixamento no vencimento precisa alcançar o caso, e o
        -- aviso de renovação anual não pode sair para quem não tem mandato de cobrança.
        plano_ciclo = case when v_ciclo is null or v_ciclo = '' then 'cortesia' else v_ciclo end,
        plano_pago_em = coalesce(plano_pago_em, now())
      where id = v_user;

      update compras_produtos
        set plano_concedido = v_concede, plano_concedido_ate = v_venc_novo
        where id = p_compra_id;
    end if;
  end if;

  return jsonb_build_object('ok',true,'ativado',true,'user_id',v_user,
                            'plano_concedido', v_concede, 'ate', v_venc_novo,
                            'bonus_concedidos', v_bonus_dados);
end; $function$;

revoke all on function public.confirmar_compra_produto(uuid, text, text) from public, anon, authenticated;

-- ── 4. As regras viram DADO ──────────────────────────────────────────────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'produto.bonus_e_upsell',
  jsonb_build_object(
    'bonus_vira_acesso', true,
    'bonus_valor_zero', true,
    'bonus_um_nivel_so', true,
    'upsell_nao_concede', true
  ),
  'BÔNUS e UPSELL são coisas diferentes e não podem ser confundidos. Bônus (cursos_admin/'
  'ebooks_admin.bonus_produtos + concede_plano/concede_meses) é o que o cliente RECEBE junto '
  'na compra: vira compra ativa com valor 0 e via_bonus=true, que faturamento nunca conta como '
  'venda. Upsell (upsell_produtos) é o que ele é CONVIDADO a comprar à parte e NÃO concede '
  'acesso nenhum. O bônus é de UM NÍVEL SÓ: o bônus não concede os bônus dele, senão dois '
  'produtos que se incluem mutuamente causam recursão e a corrente entrega acesso que ninguém '
  'prevê lendo o cadastro. Bônus já possuído não é duplicado.',
  array['confirmar_compra_produto'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true;
