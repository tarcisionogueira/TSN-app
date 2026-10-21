-- 21/10 (bug bounty): saldo_avisos_sincronizar() marcava como AVISADO inclusive quem falhou no envio ou estava
-- sem e-mail — o cliente só voltava a ser avisado quando entrasse dinheiro novo. Variante com lista de exclusão,
-- em NOME PRÓPRIO (sobrecarga com default deixaria a chamada sem argumento ambígua no PostgREST, e apagar a
-- antiga exige DROP, que fica para o dono). A antiga segue existindo e sem uso pelo cron.
create or replace function public.saldo_avisos_sincronizar_exceto(p_excluir uuid[] default '{}')
returns integer
language sql
security definer
set search_path to 'public'
as $function$
  with s as (
    update perfis p set saldo_avisado_valor = su.saldo_disponivel, saldo_avisado_em = now()
      from saldo_usuarios su
     where su.user_id = p.id
       and su.saldo_disponivel is distinct from coalesce(p.saldo_avisado_valor, 0)
       and not (p.id = any(coalesce(p_excluir, '{}')))
    returning p.id
  )
  select count(*)::int from s;
$function$;
revoke all on function public.saldo_avisos_sincronizar_exceto(uuid[]) from public, anon, authenticated;
grant execute on function public.saldo_avisos_sincronizar_exceto(uuid[]) to service_role;
