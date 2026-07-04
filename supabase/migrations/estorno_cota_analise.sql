-- Estorno de cota de IA em falha (auditoria 2026-07-04):
-- gerar-analise/gerar-documental consomem a cota ANTES de chamar a IA e não
-- estornam quando a geração falha; como o "isNovo" só olha status=concluida,
-- uma nova tentativa após erro cobrava de novo (cobrança dupla/tripla).
-- Estas funções devolvem à pool correta (mensal ou bônus), conforme o tipo
-- retornado pelo consumo. Só o servidor (service_role) pode chamar.

create or replace function public.estornar_analise_por(p_user_id uuid, p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  if p_tipo = 'bonus' then
    update perfis set bonus_mercado = coalesce(bonus_mercado,0) + 1 where id = p_user_id;
  elsif p_tipo = 'mensal' then
    update perfis set analises_count = greatest(coalesce(analises_count,0) - 1, 0)
      where id = p_user_id and analises_mes = to_char(now(),'YYYY-MM');
  end if;
end; $$;

create or replace function public.estornar_documental_por(p_user_id uuid, p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user_id is null then return; end if;
  if p_tipo = 'bonus' then
    update perfis set bonus_documental = coalesce(bonus_documental,0) + 1 where id = p_user_id;
  elsif p_tipo = 'mensal' then
    update perfis set documental_count = greatest(coalesce(documental_count,0) - 1, 0)
      where id = p_user_id and documental_mes = to_char(now(),'YYYY-MM');
  end if;
end; $$;

revoke all on function public.estornar_analise_por(uuid, text)    from public, anon, authenticated;
revoke all on function public.estornar_documental_por(uuid, text) from public, anon, authenticated;
grant execute on function public.estornar_analise_por(uuid, text)    to service_role;
grant execute on function public.estornar_documental_por(uuid, text) to service_role;
