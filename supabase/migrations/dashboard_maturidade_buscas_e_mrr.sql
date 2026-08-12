-- ─────────────────────────────────────────────────────────────────────────────
-- Correções do DASHBOARD apuradas em 12/08, ao conferir as 11 caixas uma a uma
-- contra o banco. Dez batiam; estas são as que não batiam ou enganavam.
-- Aplicada em produção em 12/08.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. CIDADES MADURAS: o card só podia mostrar ZERO.
-- `cidades_indice_maduras(6,'residencial')` filtrava `tipo='residencial'` nos níveis
-- bairro/grid — e nesse nível o tipo gravado é SEMPRE o concreto (apartamento/casa/terreno).
-- `residencial` só existe no nível cidade. O filtro nunca casava: o card mostrava
-- "0 maduras · 0 em progresso" desde sempre e continuaria mostrando por mais que o Índice
-- crescesse. A realidade eram 3 maduras e 19 em progresso.
-- Pior que o número errado: o card anuncia "libera desconto×índice" — havia regra de negócio
-- pendurada num indicador que não tinha como disparar. E o zero não parecia defeito, parecia
-- "ainda não chegamos lá".
-- CORREÇÃO: p_tipo nulo/vazio = TODOS OS TIPOS (maturidade da cidade é ter granularidade,
-- não ter granularidade de um tipo específico). Tipo explícito continua filtrando como antes.
create or replace function public.cidades_indice_maduras(
  p_min_micros integer default 6,
  p_tipo text default null
) returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  with r as (
    select cidade_norm, uf, count(*) micros, coalesce(sum(n_amostras),0) amostras
    from public.cidade_indicadores
    where fonte = 'relatorio'
      and nivel in ('bairro','grid')
      and (nullif(trim(coalesce(p_tipo,'')), '') is null or tipo = p_tipo)
    group by cidade_norm, uf
  )
  select jsonb_build_object(
    'min_micros', p_min_micros,
    'tipo', coalesce(nullif(trim(coalesce(p_tipo,'')), ''), 'todos'),
    'maduras', count(*) filter (where micros >= p_min_micros),
    'em_progresso', count(*) filter (where micros > 0 and micros < p_min_micros),
    'lista', coalesce(jsonb_agg(jsonb_build_object('cidade',cidade_norm,'uf',uf,'micros',micros,'amostras',amostras)
             order by micros desc) filter (where micros >= p_min_micros), '[]'::jsonb))
  from r;
$$;

revoke execute on function public.cidades_indice_maduras(integer,text) from public, anon;
grant execute on function public.cidades_indice_maduras(integer,text) to authenticated, service_role;

-- 2. MÉTRICAS: buscas por ORIGEM + soma de amostras à prova de NULL + maturidade sem tipo fixo.
-- (a) 54% das 2.206 buscas eram da conta admin, num painel chamado "o que ocorre no sistema".
--     Ler o total como uso de cliente dobrava o número. Mesma classe do "Indicação de TARCISIO"
--     de 11/08. Critério de interno = o MESMO já usado em admin_360/cliente_360.
-- (b) `(nivel1)+(nivel2)` com um lado nulo dá NULL e o sum() descarta a LINHA INTEIRA — uma
--     análise sem nível 2 sumiria da soma junto com o nível 1 dela. coalesce por nível.
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
    'indice', jsonb_build_object(
      'cidades',            (select count(*) from public.cidade_indicadores where nivel='cidade'),
      'com_aluguel',        (select count(*) from public.cidade_indicadores where nivel='cidade' and aluguel_m2 is not null),
      'sub_com_aluguel',    (select count(*) from public.cidade_indicadores where nivel <> 'cidade' and aluguel_m2 is not null)),
    'indice_maturidade', public.cidades_indice_maduras(6, null),
    'gerado_em', now()
  );
end;
$$;

-- 3. CONTADORES: base do MRR já cruzada no servidor.
-- Duas correções de dinheiro:
--  · O ANUAL não custa o preço mensal. A contagem funde `top2_anual` em `top2` (proposital,
--    para o detalhe por plano) e o MRR multiplicava tudo por R$49,90 — mas o anual do top2 é
--    R$449,90, ou R$37,49/mês: 33% a mais por assinante anual. Havia zero anuais quando isto
--    foi escrito, então o número estava certo e erraria na primeira venda.
--  · INADIMPLENTE não paga. O topo somava todo mundo enquanto o detalhe por plano já
--    descontava os inadimplentes — dois números da mesma tela prontos para discordar.
-- Devolvemos a base JÁ CRUZADA (ativos × mensal/anual) em vez de dois totais soltos: cruzar no
-- cliente exigiria supor que o inadimplente é sempre mensal, e suposição em conta de dinheiro
-- erra calada.
create or replace function public.admin_dashboard_contadores(p_inicio timestamptz, p_fim timestamptz)
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
    'contagem', (
      select jsonb_build_object(
        'admin',       count(*) filter (where r = 'admin'),
        'explorador',  count(*) filter (where r = 'explorador'),
        'top2',        count(*) filter (where r = 'top2'),
        'assessorado', count(*) filter (where r = 'assessorado'),
        'clube',       count(*) filter (where r = 'clube'),
        'consultor',   count(*) filter (where r = 'consultor'),
        'analista',    count(*) filter (where r = 'analista'),
        'advogado',    count(*) filter (where r = 'advogado'),
        'outros',      count(*) filter (where r not in
          ('admin','explorador','top2','assessorado','clube','consultor','analista','advogado')))
      from (select regexp_replace(coalesce(role,''), '_anual$', '') as r from public.perfis) s),
    'mrr_base', (
      select jsonb_object_agg(base, jsonb_build_object('mensais', mensais, 'anuais', anuais))
      from (
        select regexp_replace(coalesce(role,''), '_anual$', '') as base,
               count(*) filter (where role not like '%\_anual') as mensais,
               count(*) filter (where role like '%\_anual')     as anuais
          from public.perfis
         where inadimplente_desde is null
           and regexp_replace(coalesce(role,''), '_anual$', '') in ('top2','assessorado','clube')
         group by 1
      ) t),
    'total',                (select count(*) from public.perfis),
    'inadimplentes',        (select count(*) from public.perfis where inadimplente_desde is not null),
    'novos',                (select count(*) from public.perfis where created_at >= p_inicio and created_at <= p_fim),
    'reembolsos_pendentes', (select count(*) from public.reembolsos_garantia where status = 'solicitado'),
    'db_size_mb',           round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2),
    'imoveis_ativos',       (select count(*) from public.imoveis_leilao where ativo),
    'fotos_storage',        (select count(*) from public.imoveis_leilao where ativo and link_foto like '%supabase%'),
    'gerado_em', now());
end;
$$;
