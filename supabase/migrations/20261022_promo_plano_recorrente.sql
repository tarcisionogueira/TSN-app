-- 22/10 (dono): link promocional de PLANO com preço mensal garantido (Investidor Pro a R$ 49,90 para um explorador
-- que vai fazer upgrade). Até aqui o link de plano só MOSTRAVA o desconto no checkout: /api/mp cria o preapproval
-- com o preço de planos_config, então a pessoa pagaria o preço cheio achando que tinha a promoção.
--
-- Regras (dono): a condição vale enquanto a recorrência estiver de pé; falha de pagamento que derruba a assinatura
-- (cancelada/pausada no Mercado Pago) faz perder o benefício — uma nova contratação sai pelo preço cheio.
--   • recorrente_preco: o valor mensal que o servidor cobra (fonte do preço — o desconto_* segue só para a vitrine);
--   • uso_unico: o 1º usuário que contrata com o link fica reservado nele; ninguém mais usa;
--   • benefício perdido: já existe assinatura do mesmo plano DESTE usuário no valor promocional com status cancelled/paused.
alter table public.links_promo add column if not exists recorrente_preco numeric;
alter table public.links_promo add column if not exists uso_unico boolean not null default false;
alter table public.links_promo add column if not exists reservado_para uuid;

create or replace function public.promo_plano_preco(p_codigo text, p_user_id uuid, p_plano text)
 returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v public.links_promo%rowtype; v_role text;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'promo_plano_preco: só o servidor';
  end if;
  select * into v from public.links_promo where codigo = upper(trim(coalesce(p_codigo, ''))) limit 1;
  if not found or not v.ativo then return jsonb_build_object('ok', false, 'motivo', 'link_inativo'); end if;
  if coalesce(v.recorrente_preco, 0) <= 0 or v.produto is distinct from p_plano then
    return jsonb_build_object('ok', false, 'motivo', 'link_nao_e_deste_plano');
  end if;
  if (v.validade_ate is not null and v.validade_ate < now())
     or (v.desconto_validade_ate is not null and v.desconto_validade_ate < now()) then
    return jsonb_build_object('ok', false, 'motivo', 'link_vencido');
  end if;
  if v.uso_unico and v.reservado_para is not null and v.reservado_para <> p_user_id then
    return jsonb_build_object('ok', false, 'motivo', 'link_ja_usado');
  end if;
  select role into v_role from public.perfis where id = p_user_id;
  if v_role is distinct from 'explorador' then
    return jsonb_build_object('ok', false, 'motivo', 'so_para_explorador');
  end if;
  if exists (select 1 from public.mp_assinaturas a
              where a.user_id = p_user_id and a.plano_key like v.produto || '%' and a.status in ('cancelled', 'paused')
                and abs(coalesce(a.valor_contratado, 0) - v.recorrente_preco) < 0.05) then
    return jsonb_build_object('ok', false, 'motivo', 'beneficio_perdido');
  end if;
  if v.uso_unico and v.reservado_para is null then
    update public.links_promo set reservado_para = p_user_id where id = v.id and reservado_para is null;
  end if;
  return jsonb_build_object('ok', true, 'preco', v.recorrente_preco, 'codigo', v.codigo);
end $function$;

revoke execute on function public.promo_plano_preco(text, uuid, text) from public, anon, authenticated;
grant execute on function public.promo_plano_preco(text, uuid, text) to service_role;
