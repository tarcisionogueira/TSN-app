-- ─────────────────────────────────────────────────────────────────────────────
-- Brasil mapeado passa a ter DOMICÍLIO no denominador (12/08, fim do dia).
-- SUBSTITUI o corpo de admin_metricas_negocio de dashboard_brasil_mapeado.sql.
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POR QUE ESTE ARQUIVO EXISTE, E POR QUE ELE NÃO É COSMÉTICO:
--
-- 1) A troca de denominador. O arquivo anterior usava POPULAÇÃO e dizia por escrito
--    "domicílio seria o denominador ideal para mercado imobiliário; quando a ingestão for
--    consertada, troca-se". A ingestão foi consertada nesta mesma tarde (`censo_domicilios`
--    e `censo_domicilios_especie` agora gravam 5.570 linhas com dado real), então a troca
--    é feita aqui. Domicílio mede ESTOQUE DE MORADIA; população mede gente. Um município
--    de veraneio tem pouca gente e muita moradia — quem vende imóvel precisa da segunda
--    leitura. A população continua no card, ao lado, como segunda leitura.
--
-- 2) O motivo real de existir um arquivo em vez de nada: **a função em PRODUÇÃO já estava
--    com `pct_dom_venda`, e NENHUMA migração do repositório tinha.** Foi aplicada direto no
--    banco e nunca voltou para cá. Se alguém recriasse o banco a partir de `supabase/
--    migrations/`, `admin_metricas_negocio()` voltaria à versão por população, a chave
--    `pct_dom_venda` sumiria do JSON e o card do Dashboard leria `br.pct_dom_venda || 0` —
--    imprimindo **"0% venda"** com cara de resposta. É a mesma família que ocupou o dia
--    inteiro (`solicitacoes.reuniao_em` e `onr_protocolos`: migração escrita que nunca
--    chegou ao banco), só que na direção contrária: mudança no banco que nunca chegou ao
--    repositório. As duas direções produzem o mesmo sintoma — um zero silencioso.
--
-- Este corpo é cópia fiel do `pg_get_functiondef()` colhido da produção em 12/08, para que
-- repositório e banco fiquem provadamente iguais. Reaplicar é idempotente e não muda nada.
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
      select jsonb_build_object('imoveis', count(distinct imovel_id),
        'cidades', count(distinct lower(cidade)) filter (where coalesce(cidade,'')<>''),
        'estados', count(distinct upper(estado)) filter (where coalesce(estado,'')<>'')) from todos),
    'relatorios', jsonb_build_object(
      'mercado',(select count(*) from public.analises_mercado where status='concluida'),
      'documental',(select count(*) from public.analises_documental where status='concluida'),
      'laudo',(select count(*) from public.analises_laudo where status='concluida'),
      'mercado_erro',(select count(*) from public.analises_mercado where status='erro')),
    'amostras', (select coalesce(sum(
        coalesce((result->'mercado'->'nivel1'->>'totalAmostras')::int,0)
      + coalesce((result->'mercado'->'nivel2'->>'totalAmostras')::int,0)),0)
      from public.analises_mercado where status='concluida'),
    'buscas', (
      with b as (select bh.resultados_count, bh.criado_em,
               coalesce(p.role,'') in ('admin','analista','advogado','consultor') as interno
          from public.busca_historico bh left join public.perfis p on p.id=bh.user_id)
      select jsonb_build_object('total',count(*),
        'zero_resultado',count(*) filter (where coalesce(resultados_count,0)=0),
        'ult_7d',count(*) filter (where criado_em > now()-interval '7 days'),
        'internas',count(*) filter (where interno),
        'cliente',count(*) filter (where not interno),
        'cliente_zero',count(*) filter (where not interno and coalesce(resultados_count,0)=0),
        'cliente_ult_7d',count(*) filter (where not interno and criado_em > now()-interval '7 days'))
      from b),
    'indice', (select jsonb_build_object(
        'cidades', count(distinct (cidade_norm, uf)),
        'com_aluguel', count(distinct (cidade_norm, uf)) filter (where aluguel_m2 is not null),
        'sub_com_aluguel', (select count(*) from public.cidade_indicadores where nivel<>'cidade' and aluguel_m2 is not null))
      from public.cidade_indicadores where nivel='cidade'),
    'brasil', (
      with br as (select count(*) municipios, sum(populacao) pop, sum(domicilios_ocupados) dom
                    from public.cidade_socio where nivel='cidade'),
      m as (select cidade_norm, uf, bool_or(venda_m2 is not null) tem_venda,
                   bool_or(aluguel_m2 is not null) tem_aluguel
              from public.cidade_indicadores where nivel='cidade' group by 1,2),
      j as (select m.tem_venda, m.tem_aluguel, cs.populacao, cs.domicilios_ocupados dom
              from m left join public.cidade_socio cs on cs.nivel='cidade' and cs.uf=m.uf
               and replace(replace(cs.cidade_norm,' ',''),'-','') = replace(replace(m.cidade_norm,' ',''),'-',''))
      select jsonb_build_object(
        'municipios_br',(select municipios from br),
        'domicilios_br',(select dom from br),
        'cidades_venda',count(*) filter (where tem_venda),
        'cidades_aluguel',count(*) filter (where tem_aluguel),
        'sem_par_ibge',count(*) filter (where populacao is null),
        -- DOMICÍLIO é o denominador do mercado imobiliário: estoque de moradias, não gente.
        'pct_dom_venda',  round(100.0*coalesce(sum(dom) filter (where tem_venda),0)/nullif((select dom from br),0),1),
        'pct_dom_aluguel',round(100.0*coalesce(sum(dom) filter (where tem_aluguel),0)/nullif((select dom from br),0),1),
        'pct_pop_venda',  round(100.0*coalesce(sum(populacao) filter (where tem_venda),0)/nullif((select pop from br),0),1),
        'pct_pop_aluguel',round(100.0*coalesce(sum(populacao) filter (where tem_aluguel),0)/nullif((select pop from br),0),1))
      from j),
    'indice_maturidade', public.cidades_indice_maduras(6, null),
    'gerado_em', now());
end; $$;
