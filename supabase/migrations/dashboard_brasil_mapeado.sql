-- ─────────────────────────────────────────────────────────────────────────────
-- "Quanto do Brasil já está mapeado?" (pedido do dono, 12/08) + correção de um
-- rótulo que contava LINHAS chamando de CIDADES. Aplicada em produção em 12/08.
-- SUBSTITUI o corpo de admin_metricas_negocio definido em
-- dashboard_maturidade_buscas_e_mrr.sql (acrescenta a chave 'brasil' e corrige 'indice').
-- ─────────────────────────────────────────────────────────────────────────────
--
-- A) A CHAVE ENTRE AS DUAS TABELAS NÃO CASA SOZINHA.
-- `cidade_socio` grava a cidade SEM espaços ('saopaulo'); `cidade_indicadores` grava COM
-- ('sao paulo') em 7 das 54 linhas de nível cidade — e sem espaço nas outras 47 e em todos os
-- níveis bairro/grid. Duas convenções, e uma delas inconsistente consigo mesma.
-- Efeito medido: um join ingênuo perdia 6 das 35 cidades, entre elas SÃO PAULO — a maior do
-- país, 11,4 milhões de pessoas. A cobertura sairia 12,8% em vez de 19,3%: o número erraria
-- para MENOS, que é o tipo de erro que ninguém questiona porque parece modéstia.
-- O join normaliza os dois lados. NÃO reescrevo a convenção de `cidade_indicadores` porque
-- ela tem outros consumidores; isso é dívida registrada, não conserto silencioso.
--
-- B) "54 cidades" eram 54 LINHAS (cidade × tipo), não 54 cidades. São 35 distintas, e 9 com
-- locação (não 14). Mesmo defeito de população-no-denominador que já mordeu este card em
-- 11/08, agora do outro lado.
--
-- C) DENOMINADOR = POPULAÇÃO, e o card diz isso. Não é escolha estética — é a única
-- disponível: `cidade_socio.area_km2`, `domicilios` e `densidade_hab_km2` estão VAZIOS nas
-- 5.571 linhas, apesar de `socio_fontes.censo_domicilios` marcar `ultimo_ok = true` em 04/08
-- (ingestão que se declara bem-sucedida sem ter escrito nada — investigar). Domicílio seria o
-- denominador ideal para mercado imobiliário; quando a ingestão for consertada, troca-se.
create or replace function public.admin_metricas_negocio()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'cobertura', (
      with todos as (
        select imovel_id, cidade, estado from public.analises_mercado where status='concluida'
        union all select imovel_id, cidade, estado from public.analises_documental where status='concluida'
        union all select imovel_id, cidade, estado from public.analises_laudo where status='concluida')
      select jsonb_build_object(
        'imoveis', count(distinct imovel_id),
        'cidades', count(distinct lower(cidade)) filter (where coalesce(cidade,'')<>''),
        'estados', count(distinct upper(estado)) filter (where coalesce(estado,'')<>''))
      from todos),
    'relatorios', jsonb_build_object(
      'mercado',      (select count(*) from public.analises_mercado    where status='concluida'),
      'documental',   (select count(*) from public.analises_documental where status='concluida'),
      'laudo',        (select count(*) from public.analises_laudo       where status='concluida'),
      'mercado_erro', (select count(*) from public.analises_mercado     where status='erro')),
    'amostras', (select coalesce(sum(
        coalesce((result->'mercado'->'nivel1'->>'totalAmostras')::int, 0)
      + coalesce((result->'mercado'->'nivel2'->>'totalAmostras')::int, 0)),0)
      from public.analises_mercado where status='concluida'),
    'buscas', (
      with b as (
        select bh.resultados_count, bh.criado_em,
               coalesce(p.role, '') in ('admin','analista','advogado','consultor') as interno
          from public.busca_historico bh
          left join public.perfis p on p.id = bh.user_id)
      select jsonb_build_object(
        'total',              count(*),
        'zero_resultado',     count(*) filter (where coalesce(resultados_count,0)=0),
        'ult_7d',             count(*) filter (where criado_em > now()-interval '7 days'),
        'internas',           count(*) filter (where interno),
        'cliente',            count(*) filter (where not interno),
        'cliente_zero',       count(*) filter (where not interno and coalesce(resultados_count,0)=0),
        'cliente_ult_7d',     count(*) filter (where not interno and criado_em > now()-interval '7 days'))
      from b),
    'indice', (
      select jsonb_build_object(
        'cidades',         count(distinct (cidade_norm, uf)),
        'com_aluguel',     count(distinct (cidade_norm, uf)) filter (where aluguel_m2 is not null),
        'sub_com_aluguel', (select count(*) from public.cidade_indicadores
                             where nivel <> 'cidade' and aluguel_m2 is not null))
      from public.cidade_indicadores where nivel='cidade'),
    'brasil', (
      with br as (
        select count(*) as municipios, sum(populacao) as pop
          from public.cidade_socio where nivel='cidade'),
      m as (
        select cidade_norm, uf,
               bool_or(venda_m2 is not null)   as tem_venda,
               bool_or(aluguel_m2 is not null) as tem_aluguel
          from public.cidade_indicadores where nivel='cidade' group by 1,2),
      j as (
        select m.tem_venda, m.tem_aluguel, cs.populacao
          from m left join public.cidade_socio cs
            on cs.nivel='cidade' and cs.uf = m.uf
           and replace(replace(cs.cidade_norm,' ',''),'-','')
             = replace(replace(m.cidade_norm,' ',''),'-',''))
      select jsonb_build_object(
        'municipios_br',   (select municipios from br),
        'populacao_br',    (select pop from br),
        'cidades_venda',   count(*) filter (where tem_venda),
        'cidades_aluguel', count(*) filter (where tem_aluguel),
        'sem_par_ibge',    count(*) filter (where populacao is null),
        'pct_pop_venda',   round(100.0*coalesce(sum(populacao) filter (where tem_venda),0)/nullif((select pop from br),0), 1),
        'pct_pop_aluguel', round(100.0*coalesce(sum(populacao) filter (where tem_aluguel),0)/nullif((select pop from br),0), 1))
      from j),
    'indice_maturidade', public.cidades_indice_maduras(6, null),
    'gerado_em', now()
  );
end;
$$;
