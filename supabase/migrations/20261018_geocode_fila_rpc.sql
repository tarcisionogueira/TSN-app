-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FILA DO GEOCODIFICADOR VIA RPC (stress test de 18/10)
--
-- pg_stat_statements: a leitura da fila do api/geocodificar.js era a consulta que MAIS consumia o banco
-- (3.691 chamadas · média 3,5 s · máx. 7,99 s, encostando no teto de 8 s · 213 min no total). A mesma
-- consulta com os valores escritos leva 4 ms. Pelo PostgREST ela chega PARAMETRIZADA
-- (`latitude = $1 … geocod_nivel = $2`) e o plano genérico não consegue provar o predicado do índice
-- parcial `imoveis_leilao_geocode_fila_idx` — cai na varredura ordenada por atualizado_em.
-- Aqui o predicado é LITERAL, igual ao do índice, e o planner usa o índice sempre.
-- SECURITY INVOKER: o geocodificador chama com a service key; anon/authenticated só veem o que a RLS deixa.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.geocode_fila(p_lote integer default 50, p_estados text[] default null)
returns table (id uuid, titulo text, cidade text, estado text, endereco text, bairro text, cep text, condominio text)
language sql stable security invoker set search_path to 'public' as $$
  select i.id, i.titulo, i.cidade, i.estado, i.endereco, i.bairro, i.cep::text, i.nomecondominio
    from public.imoveis_leilao i
   where i.ativo = true
     and (i.latitude is null or (i.latitude = 0 and i.geocod_nivel is null) or i.geocod_nivel = 'refazer')
     and (p_estados is null or i.estado = any(p_estados))
   order by i.atualizado_em desc
   limit greatest(1, least(p_lote, 500))
$$;

-- acervo_busca_cidade (autocomplete público da busca; 2.513 chamadas · média 746 ms · máx. 7,97 s): rodava o
-- unaccent em CADA um dos ~30 mil lotes ativos a cada tecla. Agora agrega as ~2.700 cidades distintas primeiro
-- (CTE materializada, para o planner não empurrar o filtro de volta para a varredura) e filtra só elas:
-- 703 → 99 ms medido ("campinas"). Mesmo contrato de saída; `uf` passa a vir em maiúscula (como em acervo_cidades_*).
create or replace function public.acervo_busca_cidade(p_q text)
 returns table(cidade text, cidade_norm text, uf text, total bigint)
 language sql stable security definer set search_path to 'public'
as $function$
  with q as (
    select lower(public.unaccent_simples(btrim(coalesce(p_q, '')))) as t
  ),
  cid as materialized (
    select i.cidade_norm, upper(i.estado) as uf, i.cidade, count(*) as n
      from public.imoveis_leilao i
     where i.ativo
     group by 1, 2, 3
  ),
  achados as (
    select c.* from cid c, q
     where length(q.t) >= 2
       and (c.cidade_norm like '%' || replace(q.t, ' ', '') || '%'
            or lower(public.unaccent_simples(c.cidade)) like '%' || q.t || '%')
  )
  select (array_agg(a.cidade order by a.n desc))[1] as cidade,
         a.cidade_norm, a.uf, sum(a.n) as total
    from achados a
   group by a.cidade_norm, a.uf
   order by sum(a.n) desc
   limit 40
$function$;

-- qa_invariante_rls_escreve_sem_ler: falso positivo em email_cobranca (18/10). A leitura é
-- `user_id = auth.uid() OR is_admin()`, e o detector tratava QUALQUER política que cita is_admin como
-- "só admin". Política que também cita auth.uid() é do usuário — conta como leitura/escrita dele.
create or replace function public.qa_invariante_rls_escreve_sem_ler()
 returns bigint language sql stable set search_path to 'public'
as $function$
  with pol as (
    select c.oid, c.relname,
      bool_or(p.polcmd in ('a','*') and (
              coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') not ilike '%is_admin%'
           or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), pg_get_expr(p.polqual, p.polrelid), '') ilike '%auth.uid()%')) as escreve,
      bool_or(p.polcmd in ('r','*') and (
              coalesce(pg_get_expr(p.polqual, p.polrelid), '') not ilike '%is_admin%'
           or coalesce(pg_get_expr(p.polqual, p.polrelid), '') ilike '%auth.uid()%')) as le
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_policy p on p.polrelid = c.oid
     where c.relrowsecurity
     group by c.oid, c.relname)
  select count(*)::bigint from pol where escreve and not le;
$function$;
