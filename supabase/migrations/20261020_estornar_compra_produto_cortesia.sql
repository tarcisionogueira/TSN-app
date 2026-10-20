-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #245 (20/10): o estorno de produto (reembolso/chargeback) ainda deixava três coisas para trás.
--   (a) o BÔNUS INFINITO do curso — distribuir_comissao_rede_curso grava `<pay>-prod-inf<N>`; a versão de 19/10
--       só cancelava `<pay>-prod` e `<pay>-prod-n%`. Liderança sacava sobre dinheiro devolvido.
--   (b) os produtos entregues como BÔNUS da compra (via_bonus, origem_compra_id) continuavam ativos.
--   (c) a CORTESIA de plano (concede_plano): o comprador estornava o curso e ficava com os meses de Pro.
-- Cortesia só é desfeita quando o acesso é SÓ cortesia (plano_ciclo = 'cortesia' — conceder_plano_usuario não
-- troca um ciclo pago): quem tem mandato pago não perde nada. Outra compra ativa com cortesia vigente mantém o
-- acesso até a data dela; sem nenhuma, o papel volta ao anterior à concessão (role_anterior ou explorador).
-- Papel de equipe nunca é tocado (mesma escada de conceder_plano_usuario).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.estornar_compra_produto(p_gateway_payment_id text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_n int := 0; v_bonus int := 0; v_lanc int := 0;
  v_like text; v_c record; v_perfil record; v_resta timestamptz; v_cortesia text := null;
begin
  if coalesce(p_gateway_payment_id,'') = '' then return jsonb_build_object('ok',false,'erro','sem_id'); end if;
  v_like := replace(replace(replace(p_gateway_payment_id, '\', '\\'), '%', '\%'), '_', '\_');

  for v_c in
    update public.compras_produtos set status='estornado'
     where gateway_payment_id = p_gateway_payment_id and status='ativo'
    returning id, user_id, plano_concedido
  loop
    v_n := v_n + 1;
    -- (b) bônus entregues junto com esta compra
    with b as (
      update public.compras_produtos set status='estornado'
       where origem_compra_id = v_c.id and via_bonus and status='ativo' returning 1
    ) select v_bonus + count(*) into v_bonus from b;

    -- (c) cortesia de plano
    if coalesce(v_c.plano_concedido,'') <> '' then
      select role, role_anterior, plano_ciclo into v_perfil from public.perfis where id = v_c.user_id for update;
      if v_perfil.plano_ciclo = 'cortesia'
         and v_perfil.role in ('top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual') then
        select max(plano_concedido_ate) into v_resta from public.compras_produtos
         where user_id = v_c.user_id and status = 'ativo' and coalesce(plano_concedido,'') <> ''
           and plano_concedido_ate > now();
        if v_resta is not null then
          update public.perfis set plano_vencimento = v_resta where id = v_c.user_id;
          v_cortesia := 'encurtada';
        else
          update public.perfis set
            role = coalesce(nullif(role_anterior,''), 'explorador'),
            role_anterior = null,
            plano_vencimento = now(),
            plano_ciclo = default  -- o mesmo 'mensal' de todo explorador (DEFAULT da coluna)
           where id = v_c.user_id;
          v_cortesia := 'revogada';
        end if;
      else
        v_cortesia := 'mantida_plano_pago';
      end if;
    end if;
  end loop;

  -- (a) comissão direta, rede e infinito do curso
  with l as (
    update public.saldo_lancamentos set status='cancelado'
     where (origem_id = p_gateway_payment_id || '-prod' or origem_id like v_like || '-prod-%')
       and status <> 'cancelado' returning 1
  ) select count(*) into v_lanc from l;
  update public.comissoes set status='cancelado'
    where gateway_payment_id = p_gateway_payment_id and origem='produto' and status <> 'cancelado';

  return jsonb_build_object('ok',true,'compras_estornadas',v_n,'bonus_estornados',v_bonus,
                            'lancamentos_cancelados',v_lanc,'cortesia',v_cortesia);
end; $function$;

-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CORTESIA QUE NUNCA VENCIA (achado ao provar o #245 em seco, 20/10). `perfis.plano_ciclo` tem DEFAULT 'mensal' —
-- os 182 exploradores têm 'mensal'. A concessão só gravava 'cortesia' com ciclo nulo/vazio, então o explorador que
-- ganhasse 3 meses de Pro ficava com 'mensal' e o reconciliar-assinaturas-cron (rebaixa só 'anual'/'cortesia'
-- vencidos) nunca o rebaixava: os meses de bônus virariam Pro permanente, e o aviso de cortesia vencendo não saía.
-- Explorador (rank 0) não tem ciclo pago: recebe 'cortesia'. Ninguém afetado até hoje (0 compras com concessão).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.conceder_plano_usuario(p_user uuid, p_plano text, p_meses integer)
 returns timestamp with time zone
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
  -- Regra de negócio aplicada aqui: produto.concede_plano
declare
  v_role_atual text; v_venc_atual timestamptz; v_ciclo text;
  v_rank_atual int; v_rank_novo int; v_role_final text; v_venc_novo timestamptz;
begin
  if p_user is null or coalesce(p_plano,'') = '' or coalesce(p_meses,0) <= 0 then
    return null;
  end if;

  select role, plano_vencimento, plano_ciclo
    into v_role_atual, v_venc_atual, v_ciclo
    from perfis where id = p_user;

  -- A ESCADA, espelhando RANK_PLANO de api/_webhook-core.js. Só SOBE.
  -- Papel de equipe (admin/analista/consultor/advogado) tem rank nulo e NUNCA é tocado:
  -- comprar um curso não pode rebaixar quem opera o sistema.
  v_rank_atual := case v_role_atual
    when 'explorador' then 0 when 'top2' then 1 when 'top2_anual' then 1
    when 'assessorado' then 2 when 'assessorado_anual' then 2
    when 'clube' then 3 when 'clube_anual' then 3 else null end;
  v_rank_novo := case p_plano
    when 'explorador' then 0 when 'top2' then 1
    when 'assessorado' then 2 when 'clube' then 3 else null end;

  if v_rank_novo is null then return null; end if;
  if v_role_atual is not null and v_rank_atual is null then return null; end if;  -- papel de equipe

  v_role_final := case
    when coalesce(v_rank_atual,-1) >= v_rank_novo then v_role_atual
    else p_plano end;

  -- O vencimento ESTENDE, nunca encurta. Quem já tem acesso pago até uma data futura não
  -- pode perder dias por ter comprado um curso — isso viraria uma compra em prejuízo.
  v_venc_novo := greatest(coalesce(v_venc_atual, now()), now()) + (p_meses || ' months')::interval;
  if v_venc_atual is not null and v_venc_atual > v_venc_novo then
    v_venc_novo := v_venc_atual;
  end if;

  update perfis set
    role = coalesce(v_role_final, role),
    role_anterior = case when role_anterior is null and v_role_final is distinct from v_role_atual
                         then v_role_atual else role_anterior end,
    plano_vencimento = v_venc_novo,
    -- 'cortesia' e não 'anual': o rebaixamento no vencimento precisa alcançar este caso, e
    -- o aviso de renovação anual NÃO pode sair para quem não tem mandato — seria cobrança
    -- sobre um plano que ninguém contratou. 20/10: explorador entra aqui mesmo com o 'mensal' do DEFAULT.
    plano_ciclo = case when v_ciclo is null or v_ciclo = '' or coalesce(v_rank_atual, 0) = 0
                       then 'cortesia' else v_ciclo end,
    plano_pago_em = coalesce(plano_pago_em, now())
  where id = p_user;

  return v_venc_novo;
end $function$;
