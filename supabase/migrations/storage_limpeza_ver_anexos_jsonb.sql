-- ─────────────────────────────────────────────────────────────────────────────
-- LIMPEZA DO BUCKET CEGA AO JSONB — a matrícula "NoSuchKey" do dono (05/08/2026)
--
-- Cadeia do dano: a recaptura de documentos (captura-documentos.mjs) troca o
-- storage_path canônico em `imovel_anexos` (path por hash de conteúdo), mas o
-- JSONB `imoveis_leilao.anexos` continua apontando para o objeto ANTIGO. A
-- storage_limpeza_candidatos() só considerava referência o que está em
-- imovel_anexos/usuario_docs/arrematacoes → o objeto antigo virou "órfão" e foi
-- APAGADO com o app ainda linkando para ele (14 matrículas GRUPOLANCE mortas;
-- o clique abria {"code":"NoSuchKey"}).
--
-- Correção em 2 partes (a 3ª é código: o escritor passa a sincronizar o JSONB):
--   1. A função de limpeza passa a ENXERGAR o JSONB: objeto referenciado por
--      imoveis_leilao.anexos[].url (qualquer lote, ativo ou não — lote inativo
--      reativa e relatório antigo continua linkando) NUNCA é candidato.
--   2. Reparo dos links mortos: matrícula do JSONB apontando para objeto que não
--      existe → troca pela URL viva de imovel_anexos (mesmo imóvel/tipo); sem
--      URL viva, remove a entrada (a UI cai para a página do leiloeiro, e o
--      pipeline de matrícula recaptura, pois imovel_anexos não tem a linha).
-- Idempotente: o reparo só toca entradas cujo objeto não existe HOJE.
-- ─────────────────────────────────────────────────────────────────────────────

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
  -- Referências do JSONB dos lotes (scraper/captura): o app linka essas URLs
  -- direto (ImovelDetalhe/Analise) — apagar o objeto quebra o clique do cliente.
  refj as (
    select distinct substring(a->>'url' from '/documentos/([^?]+)') as path
    from public.imoveis_leilao i, jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) a
    where a->>'url' like '%/storage/v1/object%'
      and substring(a->>'url' from '/documentos/([^?]+)') is not null
  ),
  orfaos as (
    select o.name as path, 'orfao'::text as motivo, null::uuid as anexo_id, o.sz as bytes
    from obj o
    left join ref ra on ra.storage_path = o.name
    where ra.storage_path is null
      and not exists (select 1 from refj rj where rj.path = o.name)
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
      -- Cópia extra ainda linkada pelo JSONB não pode sumir antes de o reparo/
      -- sincronismo trocar o link — fica para um ciclo futuro.
      and not exists (select 1 from refj rj where rj.path = r.name)
  )
  select * from orfaos
  union all
  select * from dups;
$$;

revoke all on function public.storage_limpeza_candidatos() from public;
revoke all on function public.storage_limpeza_candidatos() from anon, authenticated;
grant execute on function public.storage_limpeza_candidatos() to service_role;

-- 2) Reparo dos links mortos no JSONB (matrícula apontando p/ objeto apagado).
with mortos as (
  select i.id,
         (select x.url from public.imovel_anexos x
           where x.imovel_id = i.id and x.tipo = 'matricula' and x.storage_path is not null
           order by x.criado_em desc limit 1) as url_viva
  from public.imoveis_leilao i
  where exists (
    select 1 from jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) a
    where a->>'tipo' = 'matricula'
      and a->>'url' like '%/storage/v1/object%'
      and substring(a->>'url' from '/documentos/([^?]+)') is not null
      and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'documentos'
                        and o.name = substring(a->>'url' from '/documentos/([^?]+)'))
  )
)
update public.imoveis_leilao i
set anexos = (
  select coalesce(
    jsonb_agg(
      case when (e.a->>'tipo' = 'matricula'
                 and e.a->>'url' like '%/storage/v1/object%'
                 and substring(e.a->>'url' from '/documentos/([^?]+)') is not null
                 and not exists (select 1 from storage.objects o
                                 where o.bucket_id = 'documentos'
                                   and o.name = substring(e.a->>'url' from '/documentos/([^?]+)')))
           then jsonb_set(e.a, '{url}', to_jsonb(m.url_viva))
           else e.a end
      order by e.ord)
    filter (where not (
      e.a->>'tipo' = 'matricula'
      and e.a->>'url' like '%/storage/v1/object%'
      and substring(e.a->>'url' from '/documentos/([^?]+)') is not null
      and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'documentos'
                        and o.name = substring(e.a->>'url' from '/documentos/([^?]+)'))
      and m.url_viva is null)),
    '[]'::jsonb)
  from jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) with ordinality e(a, ord)
)
from mortos m
where m.id = i.id;
