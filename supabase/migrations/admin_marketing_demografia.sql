-- Marketing: AGREGA a demografia de perfis no SERVIDOR (por role, por UF top10, coorte semanal de
-- cadastro, ativos/inativos, total). Antes o MarketingTab puxava a tabela `perfis` INTEIRA pro
-- navegador (mesmo gargalo da Frente C do Dashboard) E selecionava colunas INEXISTENTES
-- ('cidade'/'estado' — a UF real do perfil é `endereco_uf`), então a seção "Perfis demográficos"
-- vinha VAZIA (erro de coluna no PostgREST). Corrigido: agrega por endereco_uf. Admin-gated.
create or replace function public.admin_marketing_demografia()
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    -- Contagem por role (role nulo/vazio conta como 'explorador', igual à tela).
    'por_role', (select coalesce(jsonb_object_agg(role_k, c), '{}'::jsonb)
      from (select coalesce(nullif(role,''),'explorador') as role_k, count(*) c
            from public.perfis group by 1) s),
    -- Top 10 UFs (array de [uf, contagem], já ordenado desc).
    'por_estado', (select coalesce(jsonb_agg(jsonb_build_array(uf, c) order by c desc), '[]'::jsonb)
      from (select endereco_uf as uf, count(*) c from public.perfis where coalesce(endereco_uf,'') <> ''
            group by endereco_uf order by count(*) desc limit 10) s),
    -- Coorte de cadastro por semana (S-0..S-11 = semanas desde o cadastro).
    'semanas', (select coalesce(jsonb_object_agg('S-'||wk, c), '{}'::jsonb)
      from (select floor(extract(epoch from (now()-created_at))/(7*86400))::int as wk, count(*) c
            from public.perfis
            where created_at is not null
              and floor(extract(epoch from (now()-created_at))/(7*86400))::int < 12
            group by 1) s),
    'ativos',   (select count(*) from public.perfis where ativo is distinct from false),
    'inativos', (select count(*) from public.perfis where ativo is false),
    'total',    (select count(*) from public.perfis));
end $fn$;
revoke execute on function public.admin_marketing_demografia() from public, anon;
grant execute on function public.admin_marketing_demografia() to authenticated, service_role;
