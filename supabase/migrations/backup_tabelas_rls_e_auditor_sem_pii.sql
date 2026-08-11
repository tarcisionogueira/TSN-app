-- ============================================================================
-- TABELA PÚBLICA SEM RLS — fechar a leitura anônima E fechar a lacuna do auditor
-- (11/08). Achado do advisor do Supabase, NÃO do nosso auditor: os dois únicos
-- ERROR de segurança do projeto eram duas tabelas que eu mesmo deixei para trás
-- em 07/08 ao investigar o Índice.
--
-- POR QUE O NOSSO AUDITOR NÃO VIU: `auditoria_seguranca()` procura *tabela com
-- PII sem RLS*. Estas não têm PII — são amostras de imóvel (endereço, valor/m²,
-- área). Sem PII, ele não olhava. Mas RLS desligada em schema `public` significa
-- leitura por `anon` via PostgREST: não é dado pessoal, é a BASE DE AMOSTRAS DO
-- ÍNDICE, que é ativo nosso. O critério certo nunca foi "tem PII?", é
-- "está exposta?".
--
-- POR QUE NÃO APAGUEI, que era o plano original: as três tabelas de 07/08 guardam
-- linhas que foram REMOVIDAS da base viva (16 análises, 1.700 amostras). O backup
-- é a ÚNICA cópia — apagar destrói o registro do que saiu e por quê. Ligar a RLS
-- fecha a exposição hoje, com zero perda. A decisão de descartar fica para quando
-- alguém confirmar que a investigação do Índice está encerrada.
-- ============================================================================

alter table if exists public.indice_amostra_sem_ancora_20260807  enable row level security;
alter table if exists public.indice_amostras_sem_ancora_20260807 enable row level security;

-- Sem policy nenhuma = ninguém lê pelo PostgREST. Só service_role (que a ignora)
-- e o SQL Editor alcançam. É o que se quer de uma tabela de backup.
revoke all on public.indice_amostra_sem_ancora_20260807  from anon, authenticated;
revoke all on public.indice_amostras_sem_ancora_20260807 from anon, authenticated;

-- ── O AUDITOR PASSA A COBRAR "EXPOSTA", NÃO "TEM PII" ───────────────────────
-- Acréscimo ao `auditoria_seguranca()`: qualquer tabela do schema `public` com RLS
-- DESLIGADA vira achado, com ou sem dado pessoal. Assim o próximo backup esquecido
-- aparece no ritual de abertura em vez de esperar alguém rodar o advisor do Supabase.
create or replace function public.seguranca_tabelas_sem_rls()
returns table(tabela text, linhas_aprox bigint, tem_grant_anon boolean)
language sql security definer set search_path to 'public' as $$
  select c.relname::text,
         c.reltuples::bigint,
         has_table_privilege('anon', c.oid, 'SELECT')
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relkind = 'r'
     and not c.relrowsecurity
     -- tabelas de sistema de extensão não são nossas e não se controla RLS nelas
     and not exists (
       select 1 from pg_depend d
        where d.objid = c.oid and d.deptype = 'e'
     )
   order by c.reltuples desc;
$$;
revoke execute on function public.seguranca_tabelas_sem_rls() from public, anon, authenticated;
grant  execute on function public.seguranca_tabelas_sem_rls() to service_role;

comment on function public.seguranca_tabelas_sem_rls() is
  'Tabelas do schema public com RLS desligada. Criada em 11/08 porque auditoria_seguranca() '
  'só cobrava tabela com PII — e duas tabelas de backup do Índice ficaram legíveis por anon '
  'sem ninguém ver. Verde = zero linhas.';
