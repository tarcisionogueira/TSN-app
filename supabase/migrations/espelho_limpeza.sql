-- 24/09 — ARMAZENAMENTO: o espelho de documentos nunca era limpo (pedido do dono: "confirme se
-- estamos com arquivos desnecessários ou duplicados"; autorizado a apagar em seguida).
--
-- MEDIDO: bucket `documentos` com 64 GB, 59 GB em `espelho/`. Dos 43.474 arquivos do espelho,
-- 26.499 (33 GB) eram de imóvel que JÁ SAIU do acervo sem nenhum cliente ligado, e entre os
-- restantes havia 9.870 cópias idênticas (15 GB) — o mesmo edital de leilão salvo uma vez por
-- lote. Causa: a retenção (`anexos_expirados` → limpar-documentos-cron) só enxerga o que está em
-- `imovel_anexos`, e ~41 mil arquivos do espelho nunca entraram lá. Nada os apagava.
--
-- 1) `espelho_limpeza_candidatos` diz O QUE sai e POR QUÊ:
--    · 'expirado' — arquivo do espelho cujo(s) registro(s) em `documento_espelho` são todos de
--      imóvel fora do acervo (ou apagado) E sem vínculo de cliente (análise de qualquer tipo,
--      caso, arremate, relatório) E que ninguém mais referencia (imovel_anexos, usuario_docs,
--      arrematacoes). Mais conservador que `anexos_expirados`, que exige os 3 relatórios.
--    · 'dup' — (só de imóvel SEM cliente) conteúdo idêntico (eTag + tamanho) a outro arquivo que FICA. `canonico` diz qual.
--      Fica, nesta ordem: o referenciado em imovel_anexos, o de `casos/`, o de nome menor.
--      Quem chama REAPONTA as linhas para o canônico ANTES de apagar (forma nº 3: com prova).
-- 2) `storage_paths_em_uso` — trava da retenção: com arquivo COMPARTILHADO entre lotes, apagar
--    porque o lote A venceu deixaria o lote B apontando para o nada.
-- 3) `storage_limpeza_candidatos` (casos/) passa a respeitar `documento_espelho` como referência
--    — o canônico de um dup pode ser um arquivo de `casos/` que só o espelho aponta.

create or replace function public.espelho_limpeza_candidatos(p_limite integer default 1000)
returns table(path text, motivo text, canonico text, bytes bigint)
language sql stable security definer
set search_path = public, pg_temp
set statement_timeout = '120s'
as $$
  with obj as materialized (
    select o.name, o.metadata->>'eTag' as etag, (o.metadata->>'size')::bigint as sz
      from storage.objects o
     where o.bucket_id = 'documentos' and (o.name like 'espelho/%' or o.name like 'casos/%')
  ),
  ref_anexo as materialized (select distinct storage_path from imovel_anexos where storage_path is not null),
  protegido as materialized (
    select imovel_id::text as iid from analises_mercado
    union select imovel_id::text from analises_documental
    union select imovel_id::text from analises_laudo
    union select imovel_id::text from casos where imovel_id is not null
    union select imovel_id::text from arrematacoes where imovel_id is not null
    union select imovel_id::text from arrematados where imovel_id is not null
    union select imovel_id::text from relatorios where imovel_id is not null
  ),
  esp as materialized (
    select e.storage_path,
           bool_and(coalesce(i.ativo, false) = false and pr.iid is null) as todos_expirados
      from documento_espelho e
      left join imoveis_leilao i on i.id = e.imovel_id
      left join protegido pr on pr.iid = e.imovel_id::text
     where e.status = 'copiado' and e.storage_path is not null
     group by e.storage_path
  ),
  expirado as materialized (
    select o.name, o.sz
      from obj o
      join esp on esp.storage_path = o.name and esp.todos_expirados
     where o.name like 'espelho/%'
       and not exists (select 1 from ref_anexo r where r.storage_path = o.name)
       and not exists (select 1 from usuario_docs ud where ud.url like '%' || o.name)
       and not exists (select 1 from arrematacoes ar where ar.documento_url like '%' || o.name)
  ),
  vivo as (
    select o.* from obj o where not exists (select 1 from expirado x where x.name = o.name)
  ),
  ranked as (
    select v.name, v.sz,
           first_value(v.name) over w as canonico,
           row_number() over w as rn
      from vivo v
     where v.etag is not null
    window w as (partition by v.etag, v.sz
                 order by (exists (select 1 from ref_anexo r where r.storage_path = v.name)) desc,
                          (v.name like 'casos/%') desc, length(v.name), v.name)
  )
  select * from (
    select name, 'expirado'::text, null::text, sz from expirado
    union all
    -- Cópia de imóvel COM cliente fica: 19 relatórios guardam o caminho do arquivo no próprio
    -- JSON, e reapontar imovel_anexos não alcança ali.
    select name, 'dup'::text, canonico, sz from ranked
     where rn > 1
       and not exists (select 1 from protegido pr where pr.iid =
             case when name like 'casos/%' then split_part(name, '/', 2) else split_part(name, '/', 3) end)
  ) t
  limit greatest(1, least(coalesce(p_limite, 1000), 5000));
$$;
revoke all on function public.espelho_limpeza_candidatos(integer) from public, anon, authenticated;

create or replace function public.storage_paths_em_uso(p_paths text[], p_ids_saindo uuid[])
returns text[] language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(array_agg(distinct p), '{}')
    from unnest(p_paths) p
   where exists (select 1 from imovel_anexos a
                  where a.storage_path = p and not (a.id = any(coalesce(p_ids_saindo, '{}'))))
      or exists (select 1 from documento_espelho e
                   join imoveis_leilao i on i.id = e.imovel_id
                  where e.storage_path = p and e.status = 'copiado' and i.ativo);
$$;
revoke all on function public.storage_paths_em_uso(text[], uuid[]) from public, anon, authenticated;

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
      -- 24/09: o canônico de uma cópia do espelho pode ser um arquivo de casos/ que só o
      -- espelho aponta — sem esta linha ele viraria "órfão" e o espelho apontaria para o nada.
      and not exists (select 1 from public.documento_espelho de where de.storage_path = o.name)
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
      and not exists (select 1 from public.documento_espelho de where de.storage_path = r.name)
  )
  select * from orfaos
  union all
  select * from dups;
$$;

revoke all on function public.storage_limpeza_candidatos() from public;
revoke all on function public.storage_limpeza_candidatos() from anon, authenticated;
grant execute on function public.storage_limpeza_candidatos() to service_role;
