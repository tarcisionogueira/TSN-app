-- ── Fundação da COMPRA AVULSA de produto (ebook/curso) + comissão do parceiro ──────
-- Objetivo do dono: parceiro compartilha um link (?ref=CÓDIGO) e VENDE o produto
-- individualmente — o comprador ganha só o PRODUTO (sem assinar a plataforma) e o
-- parceiro recebe a comissão (comissao_pct do produto). Aqui vai só a FUNDAÇÃO de
-- banco (tabela + RPCs); o endpoint de pagamento + webhook plugam depois.
--
-- Descoberta registrada: a tabela public.comissoes tem CHECK tipo IN ('afiliado',
-- 'honorario') e origem IN ('produto','assinatura','arrematacao'). O motor de rede
-- distribuir_comissao_rede grava tipo='rede_nN'/origem='venda_direta' → VIOLARIA o
-- check (tabelas comissoes/saldo hoje VAZIAS → nunca disparou). Por isso a comissão
-- de produto aqui usa valores VÁLIDOS no check (tipo='afiliado', origem='produto').

-- 1) compras_produtos: permitir 'pendente'/'estornado' + chaves de reconciliação/comissão
alter table public.compras_produtos drop constraint if exists compras_produtos_status_check;
alter table public.compras_produtos add constraint compras_produtos_status_check
  check (status in ('pendente','ativo','cancelado','estornado'));
alter table public.compras_produtos
  add column if not exists gateway            text,
  add column if not exists gateway_payment_id text,
  add column if not exists ref_codigo         text,
  add column if not exists comissao_pct        numeric,
  add column if not exists pago_em             timestamptz;
create unique index if not exists idx_compras_prod_gw
  on public.compras_produtos (gateway_payment_id) where gateway_payment_id is not null;
create index if not exists idx_compras_prod_pend
  on public.compras_produtos (user_id, produto_tipo, produto_id) where status = 'pendente';

-- 2) INICIAR a compra: valida produto ativo+pago, barra quem JÁ tem acesso, guarda o
--    parceiro (ref) e o % de comissão, cria/reaproveita a linha 'pendente'. Chamada só
--    pelo backend (service_role) com o p_user_id já autenticado no endpoint.
create or replace function public.comprar_produto_iniciar(
  p_user_id uuid, p_produto_tipo text, p_produto_id uuid, p_ref text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_titulo text; v_preco numeric; v_com numeric; v_ativo boolean; v_gratis text[];
  v_role text; v_ref_cod text; v_compra_id uuid;
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','sem_usuario'); end if;
  if p_produto_tipo not in ('ebook','curso') then return jsonb_build_object('ok',false,'erro','tipo'); end if;

  if p_produto_tipo = 'ebook' then
    select titulo, coalesce(preco,0), coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}')
      into v_titulo, v_preco, v_com, v_ativo, v_gratis from ebooks_admin where id = p_produto_id;
  else
    select titulo, coalesce(preco,0), coalesce(comissao_pct,0), coalesce(ativo,false), coalesce(planos_gratis,'{}')
      into v_titulo, v_preco, v_com, v_ativo, v_gratis from cursos_admin where id = p_produto_id;
  end if;
  if v_titulo is null or not v_ativo then return jsonb_build_object('ok',false,'erro','indisponivel'); end if;
  if v_preco <= 0 then return jsonb_build_object('ok',false,'erro','gratuito'); end if;

  -- Já tem acesso? (papel pagante/equipe, plano grátis do cadastro, ou compra ativa)
  select coalesce(role,'explorador') into v_role from perfis where id = p_user_id;
  v_role := coalesce(v_role,'explorador');
  if v_role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual','consultor','analista','advogado','admin')
     or v_role = any(v_gratis)
     or (v_role = 'top2' and 'top2_anual' = any(v_gratis))
     or exists (select 1 from compras_produtos where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id and status='ativo')
  then
    return jsonb_build_object('ok',true,'ja_tem',true);
  end if;

  -- Parceiro (referenciador) pelo código — nunca o próprio comprador
  if coalesce(p_ref,'') <> '' then
    select codigo_indicacao into v_ref_cod from perfis
      where codigo_indicacao = upper(p_ref) and id <> p_user_id limit 1;
  end if;

  -- Reaproveita 'pendente' recente (evita duplicar cobrança ao reabrir o checkout)
  select id into v_compra_id from compras_produtos
    where user_id=p_user_id and produto_tipo=p_produto_tipo and produto_id=p_produto_id
      and status='pendente' and criado_em > now() - interval '2 hours'
    order by criado_em desc limit 1;
  if v_compra_id is null then
    insert into compras_produtos (user_id, produto_tipo, produto_id, valor, status, ref_codigo, comissao_pct)
      values (p_user_id, p_produto_tipo, p_produto_id, v_preco, 'pendente', v_ref_cod, v_com)
      returning id into v_compra_id;
  else
    update compras_produtos set ref_codigo = coalesce(v_ref_cod, ref_codigo), comissao_pct = v_com, valor = v_preco
      where id = v_compra_id;
  end if;

  return jsonb_build_object('ok',true,'ja_tem',false,'compra_id',v_compra_id,'valor',v_preco,'titulo',v_titulo,'comissao_pct',v_com);
end; $function$;

-- 3) CONFIRMAR a compra (chamada pelo webhook de pagamento): ativa a linha (idempotente)
--    e credita a comissão do PARCEIRO (% do produto) — valores válidos no check da
--    comissoes. Idempotência dupla: guarda status='pendente' + origem_id único no ledger.
create or replace function public.confirmar_compra_produto(
  p_compra_id uuid, p_gateway text, p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_user uuid; v_valor numeric; v_status text; v_ref text; v_pct numeric; v_tipo text;
  v_ref_id uuid; v_com numeric; v_oid text;
begin
  select user_id, valor, status, ref_codigo, coalesce(comissao_pct,0), produto_tipo
    into v_user, v_valor, v_status, v_ref, v_pct, v_tipo
    from compras_produtos where id = p_compra_id;
  if v_user is null then return jsonb_build_object('ok',false,'erro','compra_inexistente'); end if;
  if v_status = 'ativo' then return jsonb_build_object('ok',true,'ja_ativo',true); end if;      -- idempotente
  if v_status <> 'pendente' then return jsonb_build_object('ok',false,'erro','status_'||v_status); end if;

  update compras_produtos
    set status='ativo', gateway=p_gateway, gateway_payment_id=p_gateway_payment_id, pago_em=now()
    where id = p_compra_id and status='pendente';

  -- Comissão do parceiro (referenciador direto), pelo % do produto.
  if coalesce(v_ref,'') <> '' and v_pct > 0 and coalesce(p_gateway_payment_id,'') <> '' then
    select id into v_ref_id from perfis where codigo_indicacao = v_ref and id <> v_user limit 1;
    if v_ref_id is not null then
      v_com := round(v_valor * v_pct / 100.0, 2);
      v_oid := p_gateway_payment_id || '-prod';
      if v_com > 0 and not exists (select 1 from saldo_lancamentos where origem_id = v_oid) then
        insert into comissoes (beneficiario_id, cliente_id, tipo, origem, referencia, valor_base, percentual, valor_comissao, competencia, status, gateway_payment_id, gateway)
          values (v_ref_id, v_user, 'afiliado', 'produto', 'Venda de '||v_tipo, v_valor, v_pct, v_com, current_date, 'pendente', p_gateway_payment_id, p_gateway);
        insert into saldo_lancamentos (user_id, tipo, valor, origem_tipo, origem_id, descricao, status)
          values (v_ref_id, 'comissao_venda', v_com, 'produto', v_oid, 'Comissão de venda de '||v_tipo, 'disponivel');
      end if;
    end if;
  end if;

  return jsonb_build_object('ok',true,'ativado',true,'user_id',v_user);
end; $function$;

-- 4) ESTORNAR (chargeback/reembolso do produto): cancela a compra e a comissão.
create or replace function public.estornar_compra_produto(p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_n int := 0;
begin
  if coalesce(p_gateway_payment_id,'') = '' then return jsonb_build_object('ok',false,'erro','sem_id'); end if;
  update public.compras_produtos set status='estornado'
    where gateway_payment_id = p_gateway_payment_id and status='ativo';
  get diagnostics v_n = row_count;
  update public.saldo_lancamentos set status='cancelado'
    where origem_id = p_gateway_payment_id || '-prod' and status <> 'cancelado';
  update public.comissoes set status='cancelado'
    where gateway_payment_id = p_gateway_payment_id and origem='produto' and status <> 'cancelado';
  return jsonb_build_object('ok',true,'compras_estornadas',v_n);
end; $function$;

-- Segurança: SÓ o backend (service_role) chama — nunca anon/authenticated direto.
revoke all on function public.comprar_produto_iniciar(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.confirmar_compra_produto(uuid, text, text) from public, anon, authenticated;
revoke all on function public.estornar_compra_produto(text) from public, anon, authenticated;
