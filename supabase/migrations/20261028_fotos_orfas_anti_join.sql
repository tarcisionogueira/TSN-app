-- 57014 em limpar-fotos-orfas-cron às 04:20 de 28/10. fotos_orfas_para_limpeza() fazia um NOT EXISTS por
-- arquivo do bucket: com a fila de órfãs já zerada, eram ~39 mil sondas em idx_imoveis_foto_bucket_nome
-- (162 mil buffers) para achar 3 arquivos — 5,9 s com cache quente, acima de 8 s com ele frio.
-- Agora o acervo vivo é lido de UMA vez (index-only no índice abaixo) e cruzado por hash: 152 ms quente,
-- ~27 mil buffers, mesmo resultado. O índice foi criado CONCURRENTLY fora de transação (via SQL avulso);
-- aqui fica idempotente para o registro.
create index concurrently if not exists idx_il_link_foto_bucket
  on public.imoveis_leilao (link_foto) where link_foto like '%/imoveis-fotos/%';

create or replace function public.fotos_orfas_para_limpeza(p_limite integer default 500)
 returns table(name text, tamanho bigint)
 language sql
 security definer
 set search_path to 'public', 'storage'
as $function$
  with snap as (
    -- fotos citadas no snapshot dos relatórios (o imóvel guardado dentro da análise)
    select m[1] as nome from public.analises_mercado a, lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\]+)', 'g') m
    union select m[1] from public.analises_documental a, lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\]+)', 'g') m
    union select m[1] from public.analises_laudo a, lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\]+)', 'g') m
  ), vivos as materialized (
    -- acervo vivo de UMA vez (index-only em idx_il_link_foto_bucket) e anti-join por hash.
    -- Era um NOT EXISTS por arquivo: com a fila zerada, ~39 mil sondas no índice para achar 3
    -- órfãs — 5,9 s quente, 57014 às 04:20 de 28/10 com o cache frio.
    select split_part(split_part(i.link_foto, '/imoveis-fotos/', 2), '?', 1) as nome
      from public.imoveis_leilao i
     where i.link_foto like '%/imoveis-fotos/%'
  )
  select o.name::text, nullif(o.metadata->>'size','')::bigint
    from storage.objects o
    left join vivos v on v.nome = o.name
   where o.bucket_id = 'imoveis-fotos'
     -- margem de segurança: nada recém-criado entra na fila (upload em voo, linha ainda não gravada)
     and o.created_at < now() - interval '7 days'
     and v.nome is null
     and not exists (select 1 from snap s where s.nome = o.name)
   order by o.created_at
   limit greatest(p_limite, 0)
$function$;
