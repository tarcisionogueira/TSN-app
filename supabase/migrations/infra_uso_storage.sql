-- Uso de armazenamento (Storage + banco) para a SAÚDE vigiar ANTES de bater o teto do
-- plano Supabase. Sem isto, o 1º aviso vinha só no e-mail "urgente" da Supabase (risco de
-- pausa do projeto em 3 dias). O Storage costuma estourar primeiro — hoje o bucket
-- `documentos` (PDFs de edital/matrícula) domina.
--
-- SECURITY DEFINER: a saúde roda com service key, mas o schema `storage` não é exposto
-- pelo PostgREST. search_path='' → tudo qualificado. Só service_role executa (revoke de
-- PUBLIC — o grant default de EXECUTE vai p/ PUBLIC/anon, então revoke de anon/authenticated
-- não basta). Aplicada via MCP; auditoria_seguranca 0/0.
create or replace function public.infra_uso_storage()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'db_bytes', pg_catalog.pg_database_size(pg_catalog.current_database()),
    'storage_bytes', coalesce((select sum((o.metadata->>'size')::bigint) from storage.objects o), 0),
    'por_bucket', coalesce((
      select jsonb_object_agg(t.bucket_id, t.bytes)
      from (select o.bucket_id, sum((o.metadata->>'size')::bigint) as bytes
            from storage.objects o group by o.bucket_id) t
    ), '{}'::jsonb),
    'gerado_em', pg_catalog.now()
  );
$$;

revoke all on function public.infra_uso_storage() from public;
revoke all on function public.infra_uso_storage() from anon, authenticated;
grant execute on function public.infra_uso_storage() to service_role;
