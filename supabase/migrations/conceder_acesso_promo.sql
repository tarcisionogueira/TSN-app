-- Link promocional de CURSO/E-BOOK prometia acesso e não concedia nada (bug bounty 02/08).
--
-- O visitante respondia o questionário, criava a conta e via "🎉 Acesso liberado! ... já está
-- liberado" (src/pages/Promo.jsx:213-224) — mas `api/promo-capturar.js` só criava a conta e o
-- lead: nenhuma linha em `compras_produtos`, que é EXATAMENTE o que libera o conteúdo
-- (`Curso.jsx:98-100` e a RPC `obter_arquivo_ebook` exigem status='ativo'). Resultado: paywall.
--
-- A concessão fica aqui (e não no endpoint público) por dois motivos:
--   1) o produto vem de `links_promo.produto_ref_id` — dado do SERVIDOR; o cliente nunca escolhe
--      o que ganha, só apresenta o CÓDIGO do link;
--   2) roda como o usuário AUTENTICADO (`auth.uid()`), então também cobre quem já tinha conta —
--      o front chama depois do login, que é a prova de posse. O endpoint público não sabia o id
--      desse usuário e por isso nunca poderia conceder com segurança.
-- O link é o credencial: quem tem o link tem o acesso — é o desenho do produto (`links_promo.publico`).
create or replace function public.conceder_acesso_promo(p_codigo text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_link record;
  v_uid  uuid := auth.uid();
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'erro', 'nao_autenticado');
  end if;

  select id, produto_tipo, produto_ref_id, ativo, validade_ate
    into v_link
    from public.links_promo
   where codigo = p_codigo
   limit 1;

  if not found or v_link.ativo is not true then
    return jsonb_build_object('ok', false, 'erro', 'link_invalido');
  end if;
  if v_link.validade_ate is not null and v_link.validade_ate < now() then
    return jsonb_build_object('ok', false, 'erro', 'link_expirado');
  end if;
  -- Link de PLANO não concede nada aqui (vai para o checkout com desconto).
  if v_link.produto_tipo not in ('curso', 'ebook') or v_link.produto_ref_id is null then
    return jsonb_build_object('ok', false, 'erro', 'link_sem_conteudo');
  end if;

  -- Idempotente: reentrar no link não duplica a concessão.
  if exists (
    select 1 from public.compras_produtos
     where user_id = v_uid and produto_tipo = v_link.produto_tipo
       and produto_id = v_link.produto_ref_id and status = 'ativo'
  ) then
    return jsonb_build_object('ok', true, 'ja_tinha', true);
  end if;

  insert into public.compras_produtos (user_id, produto_tipo, produto_id, valor, status, ref_codigo, pago_em)
  values (v_uid, v_link.produto_tipo, v_link.produto_ref_id, 0, 'ativo', p_codigo, now());

  return jsonb_build_object('ok', true, 'concedido', true);
end;
$$;

comment on function public.conceder_acesso_promo(text) is
  'Concede o acesso do link promocional (curso/e-book) ao usuário autenticado. Produto vem de links_promo.produto_ref_id (nunca do cliente); idempotente; respeita ativo/validade_ate. Valor 0 — é cortesia, não venda.';

revoke all on function public.conceder_acesso_promo(text) from public;
revoke all on function public.conceder_acesso_promo(text) from anon;
grant execute on function public.conceder_acesso_promo(text) to authenticated;
