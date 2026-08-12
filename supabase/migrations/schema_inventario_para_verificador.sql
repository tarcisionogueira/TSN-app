-- Inventário de tabelas/colunas do schema public, para o verificador de deriva código × banco
-- (scripts/verificar-schema-codigo.mjs) rodar no CI. Aplicada em produção em 12/08.
--
-- POR QUE EXISTE: em 12/08 três defeitos vieram da MESMA causa — código correto cujo banco nunca
-- recebeu a migração (`solicitacoes.reuniao_em`, `onr_protocolos`, `proxy_uso`). Nenhum aparece
-- em revisão de código nem em teste de front; só comparando o que o código referencia com o que
-- existe de verdade. O CI não consegue ler `information_schema` pelo PostgREST, então a leitura
-- vem por aqui.
--
-- A FORMA IMPORTA: devolve UM jsonb {tabela: [colunas]}, não uma linha por coluna. A primeira
-- versão devolvia 2.136 linhas e o PostgREST corta em 1.000 SEM ERRO — o verificador recebia
-- meio schema e acusava `imoveis_leilao` (66 colunas) como inexistente. Uma linha só é imune ao
-- corte. É a mesma armadilha que `api/publico.js` e o cron do espelho já documentam.
--
-- SEGURANÇA: nomes de objeto não são segredo, mas não têm por que vazar para anon — o EXECUTE
-- fica só com service_role (o CI usa a service key).
create or replace function public.schema_inventario()
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  select coalesce(jsonb_object_agg(tabela, colunas), '{}'::jsonb)
    from (
      select c.table_name::text as tabela,
             jsonb_agg(c.column_name::text order by c.column_name) as colunas
        from information_schema.columns c
        join information_schema.tables t
          on t.table_schema = c.table_schema and t.table_name = c.table_name
       where c.table_schema = 'public'
         and t.table_type in ('BASE TABLE', 'VIEW')
       group by c.table_name
    ) x
$$;

revoke all on function public.schema_inventario() from public, anon, authenticated;
grant execute on function public.schema_inventario() to service_role;

comment on function public.schema_inventario() is
  'Inventário {tabela: [colunas]} do schema public, em UM jsonb — uma linha só, imune ao corte de 1.000 linhas do PostgREST. Usada pelo CI (verificar-schema-codigo.mjs). Só service_role.';
