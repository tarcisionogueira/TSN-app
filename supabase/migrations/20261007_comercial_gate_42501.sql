-- "SEM ACESSO COMERCIAL" É RECUSA ESPERADA, NÃO ERRO DO CLIENTE (07/10).
-- A tela Minha Rede SONDA `comercial_meus_leads` para decidir se mostra o card da área comercial;
-- para quem não é admin/consultor a recusa é a resposta normal. Mas `raise exception` sem código
-- sai como P0001 → HTTP 400, e o interceptador de src/utils/supabase.js (que só ignora 401/403/
-- 406/409) gravava isso em `erros_cliente` como falha do cliente: um explorador virando parceiro
-- apareceu no diagnóstico como "Supabase 400 em rpc/comercial_meus_leads". Com errcode 42501
-- (insufficient_privilege) o PostgREST devolve 403. A MENSAGEM fica igual: quem compara o texto
-- continua funcionando. Vale para as 4 RPCs que passam por este gate.
create or replace function public.comercial_gate()
 returns text language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
declare v_papel text;
begin
  if (select auth.uid()) is null then raise exception 'nao autenticado' using errcode = '42501'; end if;
  select case when role = 'admin' then 'admin'
              when vendedor_tipo = 'consultor' then 'consultor' end
    into v_papel from public.perfis where id = (select auth.uid());
  if v_papel is null then raise exception 'sem acesso comercial' using errcode = '42501'; end if;
  return v_papel;
end $function$;
