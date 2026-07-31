-- Regra (b) do ciclo anual→mensal — APLICADO. E-mail de reautorização perto do vencimento
-- do anual que agendou a virada para mensal. Devolve candidatos (com e-mail de auth.users)
-- na janela de p_dias antes do vencimento. Só top2 anual com ciclo_agendado='mensal' →
-- contas de staff (admin/analista/…) nunca entram. Lido pelo api/renovacao-avisos-cron.js.
create or replace function public.agendados_ciclo_para_aviso(p_dias int default 7)
returns table (user_id uuid, nome text, email text, plano_vencimento timestamptz)
language sql security definer set search_path to 'public' as $function$
  select p.id, p.nome, u.email::text, p.plano_vencimento
  from public.perfis p
  join auth.users u on u.id = p.id
  where p.ciclo_agendado = 'mensal'
    and p.plano_ciclo = 'anual'
    and p.role in ('top2','top2_anual')
    and p.plano_vencimento is not null
    and p.plano_vencimento > now()
    and p.plano_vencimento <= now() + make_interval(days => p_dias)
$function$;
revoke all on function public.agendados_ciclo_para_aviso(int) from public, anon, authenticated;
grant execute on function public.agendados_ciclo_para_aviso(int) to service_role;
