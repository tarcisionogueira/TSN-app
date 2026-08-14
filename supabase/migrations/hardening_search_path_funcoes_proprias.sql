-- ═══════════════════════════════════════════════════════════════════════════════════════
-- HARDENING: search_path FIXO nas 21 funções PRÓPRIAS (13/08)
--
-- Espelha no repositório a migração já APLICADA no banco (regra 7b do CLAUDE.md: mudou
-- função no banco, escreva a migração no mesmo commit — senão recriar o banco a partir de
-- `supabase/migrations/` traria as funções de volta sem o hardening).
--
-- O QUE É E O QUE NÃO É. Sem `search_path` fixo, o Postgres resolve nomes na ordem da sessão
-- e `pg_temp` vem ANTES do public por padrão: quem cria um objeto temporário com o nome de
-- algo que a nossa função usa pode fazê-la chamar o objeto dele.
--
-- RESSALVA HONESTA (medido ANTES de escrever): NENHUMA das 21 é SECURITY DEFINER — todas
-- rodam com o privilégio de QUEM CHAMA. Isso derruba muito a gravidade: não há escalação de
-- privilégio, o atacante já teria os próprios direitos. O que resta é sequestro de RESOLUÇÃO
-- (a função ler o objeto errado) e a recomendação padrão do Supabase Advisor. É hardening
-- correto e barato — não é fechamento de brecha crítica, e o registro precisa dizer isso.
--
-- POR QUE `public, extensions, pg_temp` E NÃO SÓ `public`: neste projeto `cube` e
-- `earthdistance` estão em `public` (distância do Índice) e `pgcrypto`/`uuid-ossp` em
-- `extensions`. Fixar só `public` QUEBRARIA qualquer função que use pgcrypto. `pg_temp` fica
-- por ÚLTIMO de propósito: é a inversão dessa ordem que é o risco.
--
-- O laço EXCLUI funções que pertencem a extensão (`pg_depend.deptype = 'e'`): as ~50 de
-- cube/earthdistance não são nossas e alterá-las brigaria com o dono da extensão.
--
-- ALTER FUNCTION não toca no corpo — só anexa a configuração. Idempotente: rodar de novo
-- não acha nada para alterar.
--
-- Verde: `nossas_sem_search_path = 0`.
--   select count(*) from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
--    where ns.nspname = 'public' and p.prokind = 'f'
--      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
--      and (p.proconfig is null
--           or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'));
-- ═══════════════════════════════════════════════════════════════════════════════════════

do $$
declare r record; n int := 0;
begin
  for r in
    select p.oid::regprocedure as f
      from pg_proc p
      join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.prokind = 'f'
       and not exists (select 1 from pg_depend d
                        where d.objid = p.oid and d.deptype = 'e')
       and (p.proconfig is null
            or not exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%'))
  loop
    execute format('alter function %s set search_path = public, extensions, pg_temp', r.f);
    n := n + 1;
  end loop;
  raise notice 'search_path fixado em % função(ões)', n;
end $$;
