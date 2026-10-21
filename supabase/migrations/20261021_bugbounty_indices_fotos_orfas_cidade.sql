-- 21/10 (bug bounty): três consultas que estouravam o teto de 8 s (57014) nos logs.
-- 1) fotos_orfas_para_limpeza: montava `distinct split_part(link_foto…)` varrendo a tabela inteira (84 mil
--    linhas, 4 s quente). Índice de expressão + anti-join por NOT EXISTS (mesma lista: conferido em seco, 14 = 14).
-- 2) Página pública de cidade (api/publico paginaCidade: estado=eq & cidade_norm=eq & order desconto desc) e o
--    sitemap: o índice existente era sobre upper(estado) e não casava com `estado=eq.` — ordenava a cidade toda.
-- Aplicado pelo conector (create index sem concurrently: build de segundos na tabela de 84 mil linhas).
create index if not exists idx_imoveis_foto_bucket_nome
  on public.imoveis_leilao ((split_part(split_part(link_foto, '/imoveis-fotos/', 2), '?', 1)))
  where link_foto like '%/imoveis-fotos/%';
create index if not exists idx_imoveis_ativo_estado_cidade_desc
  on public.imoveis_leilao (estado, cidade_norm, desconto_percentual desc nulls last) where ativo;

create or replace function public.fotos_orfas_para_limpeza(p_limite integer default 500)
 returns table(name text, tamanho bigint)
 language sql
 security definer
 set search_path to 'public', 'storage'
as $function$
  with snap as (
    -- fotos citadas no snapshot dos relatórios (o imóvel guardado dentro da análise)
    select m[1] as nome from public.analises_mercado a, lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\\]+)', 'g') m
    union select m[1] from public.analises_documental a, lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\\]+)', 'g') m
    union select m[1] from public.analises_laudo a, lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\\]+)', 'g') m
  )
  select o.name::text, nullif(o.metadata->>'size','')::bigint
    from storage.objects o
   where o.bucket_id = 'imoveis-fotos'
     -- margem de segurança: nada recém-criado entra na fila (upload em voo, linha ainda não gravada)
     and o.created_at < now() - interval '7 days'
     -- acervo vivo: link_foto guarda a URL pública; casa pelo índice de expressão (não varre a tabela)
     and not exists (select 1 from public.imoveis_leilao i
                      where i.link_foto like '%/imoveis-fotos/%'
                        and split_part(split_part(i.link_foto, '/imoveis-fotos/', 2), '?', 1) = o.name)
     and not exists (select 1 from snap s where s.nome = o.name)
   order by o.created_at
   limit greatest(p_limite, 0)
$function$;
