-- #283 (22/10): admin_dashboard_contadores estourou os 8 s do `authenticated` em 16/10 (Sentry TSN-APP-6).
-- Medido em 22/10: a contagem `fotos_storage` (link_foto like '%supabase%' nos ~30 mil ativos) sozinha
-- custa 2,8 s — lê o texto do link de cada lote. Num horário de carga, somada ao resto, passa de 8 s.
-- O número só alimenta o card de fotos do painel admin e não precisa ser do segundo: passa a ser calculado
-- na passada HORÁRIA que já percorre os ativos (live_plataforma_numeros_atualizar, chamada pelo
-- desativar-encerrados-cron) e o painel lê do cache. `imoveis_ativos` continua ao vivo (130 ms).
create or replace function public.live_plataforma_numeros_atualizar()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object(
    'lotes',         count(*),
    'leiloeiros',    count(distinct fonte),
    'cidades',       count(distinct cidade),
    'com_desconto',  count(*) filter (where desconto_percentual between 50 and 95),
    'fotos_storage', count(*) filter (where link_foto like '%supabase%')
  ) into v from public.imoveis_leilao where ativo;

  insert into public.plataforma_numeros_cache (id, dados, atualizado_em)
  values (true, v, now())
  on conflict (id) do update set dados = excluded.dados, atualizado_em = excluded.atualizado_em;

  insert into public.acervo_cidades_cache (id, top, todas, atualizado_em)
  values (true,
          public._acervo_cidades_calcular(300),
          (select coalesce(jsonb_agg(jsonb_build_object('uf', uf, 'cidade_norm', cidade_norm)), '[]'::jsonb)
             from (select distinct upper(estado) as uf, cidade_norm
                     from public.imoveis_leilao
                    where ativo and coalesce(estado,'') <> '' and coalesce(cidade_norm,'') <> '') t),
          now())
  on conflict (id) do update set top = excluded.top, todas = excluded.todas, atualizado_em = excluded.atualizado_em;

  return v || jsonb_build_object('atualizado_em', now());
end;
$function$;

create or replace function public.admin_dashboard_contadores(p_inicio timestamp with time zone, p_fim timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
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

    -- CAIXA no período selecionado (o mesmo seletor que já rege "novos usuários").
    'receita', (
      select jsonb_build_object(
        'recebido',      coalesce(sum(valor) filter (where status = 'approved'), 0),
        'recorrente',    coalesce(sum(valor) filter (where status = 'approved' and origem = 'recorrente'), 0),
        'avulso',        coalesce(sum(valor) filter (where status = 'approved' and origem <> 'recorrente'), 0),
        'pagamentos',    count(*) filter (where status = 'approved'),
        -- Autorizado e NÃO capturado: dinheiro que o cliente aprovou e que ainda não é nosso.
        -- Fica separado para não inflar o caixa nem sumir da vista.
        'autorizado',    coalesce(sum(valor) filter (where status = 'authorized'), 0),
        -- Quanto do recebido NÃO tem dono. Medido em 12/08: 42 avulsos, todos com user_id
        -- nulo — 95% do faturamento invisível para o Cliente 360.
        'sem_usuario',   coalesce(sum(valor) filter (where status = 'approved' and user_id is null), 0))
      from public.mp_pagamentos
     where criado_em >= p_inicio and criado_em <= p_fim),

    'total',                (select count(*) from public.perfis),
    'inadimplentes',        (select count(*) from public.perfis where inadimplente_desde is not null),
    'novos',                (select count(*) from public.perfis where created_at >= p_inicio and created_at <= p_fim),
    'reembolsos_pendentes', (select count(*) from public.reembolsos_garantia where status = 'solicitado'),
    'db_size_mb',           round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2),
    'imoveis_ativos',       (select count(*) from public.imoveis_leilao where ativo),
    -- Do cache horário (#283): a contagem ao vivo custava 2,8 s. Cache ausente = null (o card mostra 0).
    'fotos_storage',        (select (dados->>'fotos_storage')::bigint from public.plataforma_numeros_cache where id),
    'fotos_storage_em',     (select atualizado_em from public.plataforma_numeros_cache where id),
    'gerado_em', now());
end;
$function$;
