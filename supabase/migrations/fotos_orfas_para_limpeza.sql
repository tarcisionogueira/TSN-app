-- Fotos ÓRFÃS do bucket `imoveis-fotos`: arquivos que nenhum imóvel exibe e que nenhum
-- relatório já emitido guardou no snapshot. Consumida por /api/limpar-fotos-orfas-cron.
--
-- POR QUE EXISTE: a foto fica órfã por dois caminhos normais — o lote sai do acervo (a linha
-- some) ou o backfill re-hospeda com nome novo (a antiga fica para trás). Medido em 02/08:
-- 61.208 arquivos no bucket, 21.760 (1,15 GB) sem NENHUM imóvel apontando. Inalcançáveis
-- pelo app: a linha que as exibia não existe mais. Peso morto que só cresce.
--
-- SEGURANÇA ANTES DE ECONOMIA — exclusão é irreversível, então a lista de "referenciadas"
-- foi levantada por VARREDURA de TODA coluna text/jsonb do schema public à procura de
-- 'imoveis-fotos', não por memória. Só 4 colunas citam o bucket:
--   imoveis_leilao.link_foto  (o acervo vivo, 36.704 linhas)
--   analises_mercado.imovel / analises_documental.imovel / analises_laudo.imovel
--       (snapshots congelados dentro de relatórios JÁ ENTREGUES ao cliente — apagar uma
--        dessas quebraria o PDF de quem pagou)
-- A 5ª ocorrência é `auditoria_sistema.achados`: log de auditoria, não é artefato do cliente.
--
-- Extração por regexp num CTE (conjunto pequeno) e ANTI-JOIN, em vez de um LIKE por candidato
-- contra o jsonb inteiro: mesma garantia, custo previsível.
create or replace function public.fotos_orfas_para_limpeza(p_limite integer default 500)
returns table(name text, tamanho bigint)
language sql
security definer
set search_path = 'public', 'storage'
as $$
  with referenciadas as (
    -- acervo vivo: link_foto guarda a URL pública; o nome do objeto é o que vem depois do bucket
    select distinct split_part(split_part(link_foto, '/imoveis-fotos/', 2), '?', 1) as nome
      from public.imoveis_leilao
     where link_foto like '%/imoveis-fotos/%'
    union
    select distinct m[1]
      from public.analises_mercado a,
           lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\\]+)', 'g') m
    union
    select distinct m[1]
      from public.analises_documental a,
           lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\\]+)', 'g') m
    union
    select distinct m[1]
      from public.analises_laudo a,
           lateral regexp_matches(a.imovel::text, '/imoveis-fotos/([^"?\s\\]+)', 'g') m
  )
  select o.name::text, nullif(o.metadata->>'size','')::bigint
    from storage.objects o
   where o.bucket_id = 'imoveis-fotos'
     -- margem de segurança: nada recém-criado entra na fila (upload em voo, linha ainda não gravada)
     and o.created_at < now() - interval '7 days'
     and not exists (select 1 from referenciadas r where r.nome = o.name)
   order by o.created_at
   limit greatest(p_limite, 0)
$$;

revoke all on function public.fotos_orfas_para_limpeza(integer) from public;
revoke all on function public.fotos_orfas_para_limpeza(integer) from anon, authenticated;
grant execute on function public.fotos_orfas_para_limpeza(integer) to service_role;

comment on function public.fotos_orfas_para_limpeza(integer) is
  'Fotos do bucket imoveis-fotos sem nenhum imóvel apontando E fora de todo snapshot de relatório emitido (mercado/documental/laudo), com 7 dias de carência. Só service_role. Consumida por /api/limpar-fotos-orfas-cron.';
