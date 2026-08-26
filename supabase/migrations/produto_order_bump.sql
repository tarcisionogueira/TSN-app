-- ─────────────────────────────────────────────────────────────────────────────
-- ORDER BUMP — "quer incluir também?" antes do checkout  (26/08/2026)
--
-- Pedido do dono: como Hotmart e Kiwify fazem — na própria tela do produto, ANTES de ir
-- ao checkout, perguntar se quer incluir outro produto com desconto. UM DE CADA VEZ
-- (produto + produto), podendo chegar a dois ou três cursos juntos.
--
-- E uma regra explícita dele: **a assinatura NÃO entra como opção em cima dos cursos.**
-- O bump aceita só 'curso' e 'ebook' — a validação abaixo recusa qualquer outra coisa, e
-- não existe caminho no cadastro para oferecer plano aqui. A mensalidade continua sendo
-- entregue como BÔNUS de um produto que a inclui (regra `produto.bonus_e_upsell`), nunca
-- como item avulso empurrado no fim da compra.
--
-- COMO SE DISTINGUE DO QUE JÁ EXISTE:
--   • BÔNUS      — vem junto, de graça, sem o cliente escolher.
--   • ORDER BUMP — oferta em destaque, UMA POR VEZ, dentro da caixa de compra.
--   • UPSELL     — vitrine com foto e descrição, VÁRIOS ao mesmo tempo, abaixo do conteúdo.
--
-- Bump e upsell são o MESMO mecanismo com apresentações diferentes: os dois entram na
-- MESMA compra, num clique. Correção de 26/08, pedido do dono: "o upsell não pode ir a
-- outra página — ideal ter a foto e uma descrição básica do produto para selecionar e
-- incluir no carrinho". Mandar o cliente para outra página no meio da compra é perder as
-- duas vendas: ele sai da que ia fechar e raramente fecha a nova.
--
-- ⚠️ A TRAVA QUE IMPORTA: o cliente diz QUAIS extras quer; o PREÇO vem sempre do banco.
-- Aceitar valor vindo da tela deixaria comprar um curso de R$ 1.497 por R$ 1,00 — e a
-- compra seria confirmada normalmente, porque o gateway cobra o que mandarmos.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. O que o produto oferece como bump ─────────────────────────────────────
-- Lista, e não um único: a tela mostra UM DE CADA VEZ, e ao aceitar oferece o próximo.
-- É assim que se chega a dois ou três cursos sem nunca despejar tudo de uma vez.
alter table public.cursos_admin
  add column if not exists bump_produtos jsonb not null default '[]'::jsonb;
alter table public.ebooks_admin
  add column if not exists bump_produtos jsonb not null default '[]'::jsonb;

comment on column public.cursos_admin.bump_produtos is
  'Order bump: [{"tipo":"curso|ebook","id":"uuid","desconto_pct":30}]. Oferecidos UM POR VEZ '
  'antes do checkout, entram na MESMA compra com desconto. Nunca aceita plano/assinatura.';

-- ── 2. O que a compra levou além do principal ────────────────────────────────
alter table public.compras_produtos
  add column if not exists itens_extras jsonb not null default '[]'::jsonb;

comment on column public.compras_produtos.itens_extras is
  'Itens aceitos no order bump: [{"tipo","id","valor_cobrado","desconto_pct"}]. O `valor` da '
  'compra JÁ inclui a soma deles — foi um pagamento só. As compras filhas geradas na '
  'confirmação ficam com valor 0 para o faturamento não contar o mesmo dinheiro duas vezes.';

-- ── 3. Iniciar a compra, agora com extras ────────────────────────────────────
create or replace function public.comprar_produto_iniciar(
  p_user_id uuid, p_produto_tipo text, p_produto_id uuid, p_ref text default null,
  p_extras jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_titulo text; v_preco numeric; v_com numeric; v_ativo boolean; v_gratis text[];
  v_role text; v_ref_cod text; v_compra_id uuid; v_bumps jsonb; v_upsell jsonb; v_ofertas jsonb;
  v_item jsonb; v_et text; v_eid uuid; v_epreco numeric; v_eativo boolean;
  v_desc numeric; v_cobrado numeric; v_extras_ok jsonb := '[]'::jsonb; v_total numeric;
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','sem_usuario'); end if;
  if p_produto_tipo not in ('ebook','curso') then return jsonb_build_object('ok',false,'erro','tipo'); end if;

  if p_produto_tipo = 'ebook' then
    select titulo, coalesce(preco,0), coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb)
      into v_titulo, v_preco, v_com, v_ativo, v_gratis, v_bumps from ebooks_admin where id = p_produto_id;
    select coalesce(upsell_produtos,'[]'::jsonb) into v_upsell from ebooks_admin where id = p_produto_id;
  else
    select titulo, coalesce(preco,0), coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}'), coalesce(bump_produtos,'[]'::jsonb)
      into v_titulo, v_preco, v_com, v_ativo, v_gratis, v_bumps from cursos_admin where id = p_produto_id;
    select coalesce(upsell_produtos,'[]'::jsonb) into v_upsell from cursos_admin where id = p_produto_id;
  end if;
  -- As duas listas valem para o carrinho. O que muda é só COMO a tela apresenta cada uma.
  v_ofertas := coalesce(v_bumps,'[]'::jsonb) || coalesce(v_upsell,'[]'::jsonb);
  if v_titulo is null or not v_ativo then return jsonb_build_object('ok',false,'erro','indisponivel'); end if;
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

  -- ── OS EXTRAS ──────────────────────────────────────────────────────────────
  -- Cada extra pedido pela tela é conferido contra o cadastro: precisa estar na lista de
  -- bumps DESTE produto, existir, estar ativo, ter preço, e o cliente não pode já possuí-lo.
  -- O desconto sai do cadastro, não do pedido. Extra que não passa é ignorado em silêncio
  -- (a compra principal continua válida) — mas nunca entra cobrando errado.
  if jsonb_typeof(coalesce(p_extras,'[]'::jsonb)) = 'array' then
    for v_item in select * from jsonb_array_elements(p_extras) loop
      v_et := nullif(v_item->>'tipo','');
      begin v_eid := (v_item->>'id')::uuid; exception when others then v_eid := null; end;
      -- Só curso e eBook. Plano/assinatura não é order bump — regra do dono.
      continue when v_et is null or v_et not in ('curso','ebook') or v_eid is null or v_eid = p_produto_id;

      -- Tem de estar OFERECIDO por este produto. Sem esta checagem, qualquer um montaria
      -- uma requisição pedindo um curso caro com o desconto de outro.
      -- Precisa estar oferecido por este produto, em qualquer das duas listas. `found`
      -- separa "não está na lista" (recusa) de "está, mas sem desconto" (preço cheio) —
      -- desconto nulo é 0%, não é motivo para barrar a venda.
      select coalesce((b->>'desconto_pct')::numeric, 0) into v_desc
        from jsonb_array_elements(v_ofertas) b
       where b->>'id' = v_eid::text and b->>'tipo' = v_et
       limit 1;
      continue when not found;
      v_desc := least(greatest(coalesce(v_desc,0), 0), 90);   -- desconto sensato: 0 a 90%

      if v_et = 'ebook' then
        select coalesce(preco,0), coalesce(ativo,false) into v_epreco, v_eativo from ebooks_admin where id = v_eid;
      else
        select coalesce(preco,0), coalesce(ativo,false) into v_epreco, v_eativo from cursos_admin where id = v_eid;
      end if;
      continue when v_epreco is null or not coalesce(v_eativo,false) or v_epreco <= 0;
      continue when exists (select 1 from compras_produtos
                             where user_id=p_user_id and produto_id=v_eid and status='ativo');
      -- Nem duas vezes o mesmo extra no mesmo pedido.
      continue when exists (select 1 from jsonb_array_elements(v_extras_ok) x where x->>'id' = v_eid::text);

      v_cobrado := round(v_epreco * (1 - v_desc/100.0), 2);
      v_total := v_total + v_cobrado;
      v_extras_ok := v_extras_ok || jsonb_build_object(
        'tipo', v_et, 'id', v_eid, 'valor_cobrado', v_cobrado,
        'desconto_pct', v_desc, 'valor_cheio', v_epreco);
    end loop;
  end if;

  if coalesce(p_ref,'') <> '' then
    select codigo_indicacao into v_ref_cod from perfis
      where codigo_indicacao = upper(p_ref) and id <> p_user_id limit 1;
  end if;

  -- Reaproveita 'pendente' recente, mas SÓ se os extras forem os mesmos: mudar de ideia
  -- sobre o bump tem de gerar outra cobrança, senão o cliente aceita o extra e paga o
  -- valor antigo (ou o contrário, paga por um extra que tirou do carrinho).
  select id into v_compra_id from compras_produtos
    where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id
      and status='pendente' and criado_em > now() - interval '2 hours'
      and coalesce(itens_extras,'[]'::jsonb) = v_extras_ok
    order by criado_em desc limit 1;
  if v_compra_id is null then
    insert into compras_produtos (user_id, produto_tipo, produto_id, valor, status, ref_codigo, comissao_pct, itens_extras)
      values (p_user_id, p_produto_tipo, p_produto_id, v_total, 'pendente', v_ref_cod, v_com, v_extras_ok)
      returning id into v_compra_id;
  end if;

  return jsonb_build_object('ok',true,'compra_id',v_compra_id,'valor',v_total,
                            'titulo',v_titulo,'extras',v_extras_ok);
end; $function$;

revoke all on function public.comprar_produto_iniciar(uuid, text, uuid, text, jsonb) from public, anon;

-- ── 4. Confirmar: entregar também o que veio no bump ─────────────────────────
create or replace function public.entregar_itens_compra(p_compra_id uuid)
returns int language plpgsql security definer set search_path to 'public' as $function$
declare
  v_user uuid; v_prod uuid; v_extras jsonb; v_item jsonb;
  v_t text; v_id uuid; v_n int := 0;
begin
  select user_id, produto_id, coalesce(itens_extras,'[]'::jsonb)
    into v_user, v_prod, v_extras from compras_produtos where id = p_compra_id;
  if v_user is null or jsonb_typeof(v_extras) <> 'array' then return 0; end if;

  for v_item in select * from jsonb_array_elements(v_extras) loop
    v_t := nullif(v_item->>'tipo','');
    begin v_id := (v_item->>'id')::uuid; exception when others then v_id := null; end;
    continue when v_t is null or v_id is null or v_id = v_prod;
    continue when exists (select 1 from compras_produtos
                           where user_id=v_user and produto_id=v_id and status='ativo');
    -- valor 0 na filha: o dinheiro do extra JÁ está no `valor` da compra principal, que é o
    -- que o gateway cobrou. Repetir aqui dobraria o faturamento do mesmo pagamento.
    insert into compras_produtos
      (user_id, produto_tipo, produto_id, valor, status, gateway, pago_em, via_bonus, origem_compra_id)
    values
      (v_user, v_t, v_id, 0, 'ativo', 'order_bump', now(), true, p_compra_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end; $function$;

revoke all on function public.entregar_itens_compra(uuid) from public, anon, authenticated;

-- ── 5. A regra vira dado ─────────────────────────────────────────────────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'produto.order_bump',
  jsonb_build_object(
    'tipos_aceitos', array['curso','ebook'],
    'assinatura_nunca', true,
    'um_por_vez_na_tela', true,
    'preco_sempre_do_banco', true,
    'desconto_max_pct', 90
  ),
  'Order bump: antes do checkout o cliente pode incluir OUTRO produto com desconto, na mesma '
  'compra, oferecido UM POR VEZ. Aceita apenas curso e eBook — ASSINATURA NUNCA entra como '
  'opção em cima dos cursos (regra do dono, 26/08); a mensalidade só é entregue como bônus de '
  'um produto que a inclua. O extra precisa estar na lista bump_produtos DO produto principal, '
  'estar ativo, ter preço e não ser algo que o cliente já tenha. O desconto e o preço saem '
  'SEMPRE do banco, nunca do que a tela enviar — aceitar valor do cliente permitiria comprar '
  'um curso de R$ 1.497 por R$ 1,00, com a compra confirmando normalmente.',
  array['comprar_produto_iniciar','entregar_itens_compra'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true;

-- ── 6. A entrega dispara sozinha quando a compra é ativada ───────────────────
-- Gatilho em vez de mais uma linha dentro de `confirmar_compra_produto` por dois motivos:
-- não duplica cem linhas de função só para acrescentar uma chamada, e cobre QUALQUER
-- caminho que ative a compra — inclusive uma ativação manual no painel, que existe e não
-- passaria pela função do webhook.
create or replace function public.trg_entregar_itens_compra()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  -- A compra FILHA (via_bonus) não entrega nada: sem esta guarda o insert da filha
  -- dispararia o gatilho de novo, e uma corrente de bônus de bônus voltaria pela porta
  -- dos fundos — exatamente o que a regra de "um nível só" existe para impedir.
  if new.via_bonus then return new; end if;
  if new.status = 'ativo' and coalesce(old.status,'') <> 'ativo' then
    perform public.entregar_itens_compra(new.id);
  end if;
  return new;
end; $function$;

drop trigger if exists compras_produtos_entregar_itens on public.compras_produtos;
create trigger compras_produtos_entregar_itens
  after update of status on public.compras_produtos
  for each row execute function public.trg_entregar_itens_compra();
