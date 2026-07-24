-- Cliente 360: (1) filtro "acessando × não acessando" via ULTIMA ATIVIDADE composta
-- (login OU busca OU imóvel visto OU relatório — porque last_sign_in_at sozinho
-- subestima quem usa via refresh de token); (2) função p/ RESOLVER os erros de um
-- usuário (limpa a tag "erro" na lista depois que o bug foi tratado).
drop function if exists public.admin_busca_usuarios(text, text, text);

create or replace function public.admin_busca_usuarios(
  termo text, p_cpf_hash text default null, p_perfil text default null,
  p_acesso text default null, p_janela int default 14
)
returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  q    text := nullif(btrim(coalesce(termo, '')), '');
  qdig text := nullif(regexp_replace(coalesce(termo, ''), '\D', '', 'g'), '');
  h    text := nullif(coalesce(p_cpf_hash, ''), '');
  perf text := nullif(btrim(coalesce(p_perfil, '')), '');
  acc  text := nullif(btrim(coalesce(p_acesso, '')), '');
  jan  int  := greatest(1, coalesce(p_janela, 14));
  lista_geral boolean := (q is null and h is null);
begin
  return coalesce((
    select jsonb_agg(x) from (
      select base.* from (
        select p.id, p.nome, p.role, p.plano, u.email, p.telefone, p.perfil_investidor,
          exists(select 1 from public.erros_cliente e where e.user_id = p.id and e.resolvido = false) as tem_erro,
          greatest(
            u.last_sign_in_at,
            (select max(b.criado_em)  from public.busca_historico b    where b.user_id  = p.id),
            (select max(v.visto_em)   from public.imovel_visto v        where v.user_id  = p.id),
            (select max(am.created_at) from public.analises_mercado am   where am.user_id = p.id),
            (select max(ad.created_at) from public.analises_documental ad where ad.user_id = p.id),
            (select max(al.created_at) from public.analises_laudo al      where al.user_id = p.id)
          ) as ultima_atividade,
          case p.role
            when 'top2' then 'Investidor Pro' when 'assessorado' then 'Assessoria'
            when 'clube' then 'Leilão Club' when 'explorador' then 'Explorador'
            when 'admin' then 'Admin' when 'consultor' then 'Consultor'
            when 'analista' then 'Analista' when 'advogado' then 'Advogado'
            else coalesce(p.role, '—') end as plano_label
        from public.perfis p
        join auth.users u on u.id = p.id
        where (perf is null or p.perfil_investidor = perf)
          and (
            lista_geral
            or (q is not null and (
                  p.nome ilike '%' || q || '%' or u.email ilike '%' || q || '%'
                  or (qdig is not null and length(qdig) >= 4
                      and regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g') ilike '%' || qdig || '%')
                  or (case p.role
                        when 'top2' then 'investidor pro top2 pago' when 'assessorado' then 'assessoria assessorado pago'
                        when 'clube' then 'leilao club leilão clube pago' when 'explorador' then 'explorador gratuito free'
                        when 'admin' then 'admin administrador equipe' when 'consultor' then 'consultor equipe'
                        when 'analista' then 'analista equipe' when 'advogado' then 'advogado equipe'
                        else coalesce(p.role, '') end) ilike '%' || q || '%'
               ))
            or (h is not null and p.cpf_hash = h)
          )
        limit 2000
      ) base
      where (
        acc is null
        or (acc = 'acessando'     and base.ultima_atividade >= now() - (jan || ' days')::interval)
        or (acc = 'nao_acessando' and (base.ultima_atividade is null or base.ultima_atividade < now() - (jan || ' days')::interval))
      )
      order by lower(coalesce(nullif(btrim(base.nome), ''), base.email)) nulls last
      limit (case when lista_geral and perf is null and acc is null then 500 else 300 end)
    ) x
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.admin_busca_usuarios(text, text, text, text, int) from public, anon, authenticated;
grant execute on function public.admin_busca_usuarios(text, text, text, text, int) to service_role;

create or replace function public.admin_resolver_erros_usuario(p_user_id uuid)
returns integer
language plpgsql security definer set search_path to ''
as $function$
declare n int;
begin
  update public.erros_cliente set resolvido = true
  where user_id = p_user_id and resolvido = false;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.admin_resolver_erros_usuario(uuid) from public, anon, authenticated;
grant execute on function public.admin_resolver_erros_usuario(uuid) to service_role;
