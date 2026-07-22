-- Supervisor Gemini → visível no Admin (aba Qualidade). RPCs admin-gated (self-check por
-- role='admin'; mesmo padrão de admin_qa_invariantes). A tabela aprendizado_sugestoes tem
-- RLS sem policy (só service_role), então o Admin lê por estas funções SECURITY DEFINER.
create or replace function public.admin_aprendizado_sugestoes()
 returns setof public.aprendizado_sugestoes
 language sql stable security definer set search_path to 'public'
as $function$
  select * from public.aprendizado_sugestoes
  where exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
  order by criado_em desc limit 30
$function$;

create or replace function public.admin_aprendizado_sugestao_aplicar(p_id uuid, p_aplicado boolean default true)
 returns void language sql security definer set search_path to 'public'
as $function$
  update public.aprendizado_sugestoes set aplicado = coalesce(p_aplicado, true)
  where id = p_id
    and exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin')
$function$;

revoke execute on function public.admin_aprendizado_sugestoes() from public, anon;
revoke execute on function public.admin_aprendizado_sugestao_aplicar(uuid, boolean) from public, anon;
grant  execute on function public.admin_aprendizado_sugestoes() to authenticated;
grant  execute on function public.admin_aprendizado_sugestao_aplicar(uuid, boolean) to authenticated;
