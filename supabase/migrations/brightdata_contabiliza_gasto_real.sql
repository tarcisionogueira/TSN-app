-- Ver migração aplicada em 11/08 (conteúdo idêntico ao aplicado via MCP).
-- O contador contava PERMISSÃO CONCEDIDA, não chamada efetivada.
alter table public.brightdata_uso_proposito
  add column if not exists sucessos int not null default 0,
  add column if not exists falhas_rede int not null default 0;

create or replace function public.registrar_resultado_brightdata(
  p_proposito text, p_ok boolean, p_devolver boolean default false
) returns void language plpgsql security definer set search_path to 'public' as $fn$
declare v_semana date := date_trunc('week', now())::date;
        v_prop text := coalesce(nullif(trim(p_proposito), ''), 'geral');
begin
  update public.brightdata_uso_proposito
     set sucessos = sucessos + (case when p_ok then 1 else 0 end),
         falhas_rede = falhas_rede + (case when p_ok then 0 else 1 end),
         requests = greatest(0, requests - (case when p_devolver then 1 else 0 end)),
         atualizado_em = now()
   where semana = v_semana and proposito = v_prop;
  if p_devolver then
    update public.brightdata_uso set requests = greatest(0, requests - 1), atualizado_em = now()
     where semana = v_semana;
  end if;
end $fn$;
revoke execute on function public.registrar_resultado_brightdata(text, boolean, boolean) from public, anon, authenticated;
grant  execute on function public.registrar_resultado_brightdata(text, boolean, boolean) to service_role;
