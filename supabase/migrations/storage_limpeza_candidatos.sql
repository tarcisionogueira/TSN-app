-- Candidatos a limpeza SEGURA do bucket 'documentos' (legado do bug do Date.now no path,
-- corrigido em scripts/captura-documentos.mjs). Consumida por scripts/limpar-storage-duplicados.mjs.
--  1) ÓRFÃOS: objeto sem referência em imovel_anexos.storage_path, usuario_docs.url nem
--     arrematacoes.documento_url → lixo (upload que não persistiu a linha, ou linha apagada).
--  2) DUP_EXTRA: cópias idênticas (mesmo eTag) no MESMO imóvel — mantém 1 (preferindo a que
--     TEM linha em imovel_anexos), devolve as demais + o id da linha p/ apagar junto.
-- SECURITY DEFINER: storage.objects não é exposto pelo PostgREST. Só service_role executa.
create or replace function public.storage_limpeza_candidatos()
returns table(path text, motivo text, anexo_id uuid, bytes bigint)
language sql
security definer
set search_path = ''
as $$
  with obj as (
    select o.name, o.metadata->>'eTag' as etag,
           split_part(o.name,'/',2) as folder, (o.metadata->>'size')::bigint as sz
    from storage.objects o
    where o.bucket_id='documentos' and o.name like 'casos/%'
  ),
  ref as (select storage_path, id from public.imovel_anexos where storage_path is not null),
  orfaos as (
    select o.name as path, 'orfao'::text as motivo, null::uuid as anexo_id, o.sz as bytes
    from obj o
    left join ref ra on ra.storage_path = o.name
    where ra.storage_path is null
      and not exists (select 1 from public.usuario_docs ud where ud.url like '%'||o.name)
      and not exists (select 1 from public.arrematacoes ar where ar.documento_url like '%'||o.name)
  ),
  ranked as (
    select o.name, o.sz,
           row_number() over (partition by o.folder, o.etag
                              order by (ra.id is not null) desc, o.name) as rn
    from obj o
    left join ref ra on ra.storage_path = o.name
    where o.etag is not null
  ),
  dups as (
    select r.name as path, 'dup_extra'::text as motivo, ra.id as anexo_id, r.sz as bytes
    from ranked r
    left join ref ra on ra.storage_path = r.name
    where r.rn > 1
      and not exists (select 1 from orfaos o where o.path = r.name)
  )
  select * from orfaos
  union all
  select * from dups;
$$;

revoke all on function public.storage_limpeza_candidatos() from public;
revoke all on function public.storage_limpeza_candidatos() from anon, authenticated;
grant execute on function public.storage_limpeza_candidatos() to service_role;
