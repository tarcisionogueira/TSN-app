-- Bug bounty 03/09 (P0, IDOR): atividade_navegacao(p_user_id, p_limite) é SECURITY DEFINER,
-- concedida a `authenticated` (desde atividade_navegacao_pre_login.sql, que reconstruiu a
-- função para incluir pré-login e trocou o grant de service_role-só para authenticated),
-- mas o corpo nunca ganhou o gate de dono/admin — a função irmã atividade_usuario() TEM
-- exatamente esse gate (`if not (is_admin() or auth.uid() = p_user_id) then return; end if`).
-- Qualquer usuário autenticado podia passar o p_user_id de OUTRA pessoa (ex.: um UUID visto
-- na árvore de indicação em MinhaRede.jsx) e ler a navegação/cliques dela, inclusive sessão
-- pré-login vinculada por anon_id. Convertido para plpgsql só para repor o mesmo gate — o
-- corpo SQL original não muda.
create or replace function public.atividade_navegacao(p_user_id uuid, p_limite integer default 200)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_catalog'
as $function$
begin
  if not (public.is_admin() or auth.uid() = p_user_id) then return '[]'::jsonb; end if;
  return (
    with anons as (
      select distinct anon_id from public.eventos_atividade
       where user_id = p_user_id and coalesce(anon_id,'') <> ''
    )
    select coalesce(jsonb_agg(x), '[]'::jsonb) from (
      select e.tipo, e.rota, e.alvo, e.detalhe, e.criado_em,
             (e.user_id is null) as pre_login
        from public.eventos_atividade e
       where e.user_id = p_user_id
          or (e.user_id is null and e.anon_id in (select anon_id from anons))
       order by e.criado_em desc
       limit greatest(1, least(p_limite, 5000))
    ) x
  );
end;
$function$;
