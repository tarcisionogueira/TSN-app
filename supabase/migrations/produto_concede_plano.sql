-- ─────────────────────────────────────────────────────────────────────────────
-- COMPRA DE PRODUTO PASSA A CONCEDER PLANO  (26/08/2026)
--
-- POR QUE ISTO EXISTE
-- A oferta do lançamento é: comprar os dois cursos dá 6 meses de Investidor Pro.
-- Só que a concessão de plano, hoje, é decidida pela FAIXA DE VALOR do pagamento
-- (`roleAposPagamento` + `dentroFaixa` em api/_webhook-core.js). O combo custa
-- R$ 2.395,20 e não cai em faixa nenhuma → "pagamento não mapeado → não mexe".
--
-- Traduzindo: o cliente pagaria R$ 2.395,20 e NÃO receberia os 6 meses prometidos.
-- Sem erro, sem log, sem exceção — a compra seria ativada com sucesso e o plano
-- simplesmente não viria. É a forma de falha nº 1 do CLAUDE.md (o vazio que não
-- sabe que falhou), agora em cima de dinheiro do cliente.
--
-- COMO RESOLVE
-- A concessão vira DADO no cadastro do produto (`concede_plano` + `concede_meses`),
-- não faixa de valor — assim qualquer preço futuro funciona sem tocar em código.
-- `confirmar_compra_produto` é o ponto de entrada ÚNICO dos dois gateways
-- (mp-webhook.js:390 e asaas-webhook.js:137), então a concessão entra num lugar só.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. O que o produto concede (dado, não código) ────────────────────────────
alter table public.cursos_admin
  add column if not exists concede_plano text,
  add column if not exists concede_meses int;

comment on column public.cursos_admin.concede_plano is
  'Plano concedido na compra (ex.: top2). Nulo = não concede. A escada nunca REBAIXA.';
comment on column public.cursos_admin.concede_meses is
  'Por quantos meses. Nulo/0 com concede_plano preenchido = concessão sem prazo, que a
   auditoria acusa: acesso vitalício por engano é furo de receita.';

-- ── 2. A PROVA do que foi concedido ──────────────────────────────────────────
-- Não basta conceder: é preciso poder verificar depois QUE concedeu. Sem estas
-- colunas, "o cliente recebeu os 6 meses?" só se responde por dedução.
alter table public.compras_produtos
  add column if not exists plano_concedido text,
  add column if not exists plano_concedido_ate timestamptz;

-- ── 3. A concessão ───────────────────────────────────────────────────────────
create or replace function public.confirmar_compra_produto(
  p_compra_id uuid, p_gateway text, p_gateway_payment_id text)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_user uuid; v_valor numeric; v_status text; v_ref text; v_pct numeric; v_tipo text;
  v_ref_id uuid; v_com numeric; v_oid text; v_prod uuid;
  v_concede text; v_meses int;
  v_role_atual text; v_venc_atual timestamptz; v_ciclo text;
  v_rank_atual int; v_rank_novo int; v_role_final text; v_venc_novo timestamptz;
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

  -- ── Comissão do parceiro (inalterado) ──────────────────────────────────────
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

  -- ── NOVO: o plano que o produto concede ────────────────────────────────────
  if v_tipo = 'curso' then
    select concede_plano, concede_meses into v_concede, v_meses
      from cursos_admin where id = v_prod;
  end if;

  if coalesce(v_concede,'') <> '' and coalesce(v_meses,0) > 0 then
    select role, plano_vencimento, plano_ciclo
      into v_role_atual, v_venc_atual, v_ciclo
      from perfis where id = v_user;

    -- A ESCADA, espelhando RANK_PLANO de api/_webhook-core.js:37. Só SOBE.
    -- Papel de equipe (admin/analista/consultor/advogado) tem rank nulo e NUNCA é
    -- tocado: comprar um curso não pode rebaixar quem opera o sistema.
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

      -- O vencimento ESTENDE, nunca encurta. Quem já tem acesso pago até uma data
      -- futura não pode perder dias por ter comprado um curso — isso transformaria
      -- uma compra em prejuízo para o cliente.
      v_venc_novo := greatest(
        coalesce(v_venc_atual, now()),
        now()
      ) + (v_meses || ' months')::interval;
      if v_venc_atual is not null and v_venc_atual > v_venc_novo then
        v_venc_novo := v_venc_atual;
      end if;

      update perfis set
        role = coalesce(v_role_final, role),
        role_anterior = case when role_anterior is null and v_role_final is distinct from v_role_atual
                             then v_role_atual else role_anterior end,
        plano_vencimento = v_venc_novo,
        -- 'cortesia' e não 'anual': o rebaixamento no vencimento
        -- (api/reconciliar-assinaturas-cron.js) precisa alcançar este caso, e o aviso de
        -- renovação anual NÃO pode sair para quem não tem mandato — seria e-mail de
        -- cobrança sobre um plano que ninguém contratou.
        plano_ciclo = case when v_ciclo is null or v_ciclo = '' then 'cortesia' else v_ciclo end,
        plano_pago_em = coalesce(plano_pago_em, now())
      where id = v_user;

      update compras_produtos
        set plano_concedido = v_concede, plano_concedido_ate = v_venc_novo
        where id = p_compra_id;
    end if;
  end if;

  return jsonb_build_object('ok',true,'ativado',true,'user_id',v_user,
                            'plano_concedido', v_concede, 'ate', v_venc_novo);
end; $function$;

revoke all on function public.confirmar_compra_produto(uuid, text, text) from public, anon, authenticated;

-- ── 4. A regra vira DADO, senão a auditoria acusa (e é esse o ponto) ─────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values (
  'produto.concede_plano',
  jsonb_build_object(
    'escada_so_sobe', true,
    'vencimento_estende_nunca_encurta', true,
    'papel_de_equipe_intocado', true,
    'ciclo', 'cortesia'
  ),
  'Compra de produto pode conceder plano por N meses, configurado em cursos_admin '
  '(concede_plano/concede_meses) — NÃO por faixa de valor do pagamento. Criada para a oferta '
  'do lançamento (os dois cursos = 6 meses de Investidor Pro): o combo custa R$ 2.395,20, que '
  'não cai em nenhuma faixa de roleAposPagamento, e o cliente pagaria sem receber o plano. '
  'A escada só sobe (nunca rebaixa quem já tem plano maior), o vencimento estende e nunca '
  'encurta, e papel de equipe não é tocado. Ciclo gravado como cortesia para que o '
  'rebaixamento no vencimento alcance o caso e o aviso de renovação anual não saia.',
  array['confirmar_compra_produto'],
  true
)
on conflict (chave) do update set
  valor = excluded.valor, descricao = excluded.descricao,
  aplicada_por = excluded.aplicada_por, ativo = true;
