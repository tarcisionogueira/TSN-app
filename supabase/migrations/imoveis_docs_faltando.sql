-- Recuperação pós-catástrofe (scripts/repopular-documentos.mjs): imóveis ATIVOS cujos anexos
-- apontam p/ objetos que sumiram do storage (arquivo perdido). Em perda TOTAL devolve todos
-- os imóveis ativos com anexos. SECURITY DEFINER — storage.objects não é exposto pelo PostgREST.
create or replace function public.imoveis_docs_faltando()
returns table(imovel_id uuid, anexos_quebrados bigint)
language sql
security definer
set search_path = ''
as $$
  select ia.imovel_id, count(*) as anexos_quebrados
  from public.imovel_anexos ia
  join public.imoveis_leilao i on i.id = ia.imovel_id and i.ativo = true
  where ia.storage_path like 'casos/%'
    and not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'documentos' and o.name = ia.storage_path
    )
  group by ia.imovel_id;
$$;

revoke all on function public.imoveis_docs_faltando() from public;
revoke all on function public.imoveis_docs_faltando() from anon, authenticated;
grant execute on function public.imoveis_docs_faltando() to service_role;
