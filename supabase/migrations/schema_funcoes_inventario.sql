-- schema_funcoes() — inventário das FUNÇÕES do schema public, para a trava de deriva
-- código × banco (gap #4 / classe 9 / formas #7 e #7b do CLAUDE.md).
--
-- POR QUE. `verificar:schema` já confere TABELAS e COLUNAS (via schema_inventario), mas nunca
-- as FUNÇÕES. Duas famílias de bug ficavam de fora:
--   · forma #7 — código chama `rpc/X` que a migração escreveu e o banco nunca recebeu (ou um
--     typo no nome): PostgREST 404/PGRST202, o erro é engolido, a ação some sem tela vermelha.
--     Foi assim que `registrar-compra-produto.js` chamou `vincular_indicacao_compra` (função
--     inexistente) e perdeu a indicação de toda compra de produto em silêncio (achado 21/08).
--   · forma #7b — função que existe SÓ no banco (criada no SQL Editor, nunca backportada para
--     `supabase/migrations/`): recriar o banco a partir do repo a perderia. `is_admin`,
--     `registrar_uso` e dezenas de outras estavam nesse estado.
--
-- Espelha schema_inventario: STABLE SECURITY DEFINER, search_path fixo, devolve UM jsonb (imune
-- ao corte de 1.000 linhas do PostgREST) e é executável só por postgres/service_role — a trava
-- roda com a service key. Exclui funções pertencentes a EXTENSÕES (postgis, pg_trgm, etc.),
-- que não são do app e não devem entrar na conta.
create or replace function public.schema_funcoes()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select coalesce(jsonb_agg(distinct p.proname order by p.proname), '[]'::jsonb)
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and not exists (
       select 1 from pg_depend d
        where d.objid = p.oid and d.deptype = 'e'  -- não é dependente de extensão
     );
$function$;

-- Só a service key (a trava) precisa ler isto. Fecha para anon/authenticated para não abrir
-- superfície nova nem cair no auditoria_seguranca (SECURITY DEFINER exposto a anon).
revoke all on function public.schema_funcoes() from public;
revoke all on function public.schema_funcoes() from anon;
revoke all on function public.schema_funcoes() from authenticated;
grant execute on function public.schema_funcoes() to service_role;
