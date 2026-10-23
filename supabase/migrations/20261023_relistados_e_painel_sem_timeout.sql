-- 23/10: reconciliar_relistados() e admin_dashboard_contadores() batendo no statement timeout de 8 s.
--
-- Medido no pg_stat_statements: reconciliar_relistados média 3,4 s, pico 7,7 s (236 chamadas) — e o
-- cron desativar-encerrados falhou 3 horas seguidas em 22/10 (20h37–22h37 UTC) com 57014. Rodada
-- manual: 8,6 s sem alterar NENHUMA linha. Os mesmos três passos escritos como SELECT levam 41 + 67 +
-- 53 ms: o custo estava na forma UPDATE ... FROM grupo, cujo plano varre a tabela inteira. Com 256 MB
-- de cache para 1 GB de banco, varredura inteira com cache frio vira leitura de disco e passa dos 8 s.
--
-- Conserto: cada passo escolhe os ids pelo caminho rápido (o SELECT medido) e só então altera pela
-- chave primária. Regras idênticas às de 20261013_reconciliar_relistados_separado.sql.
-- Índices (criados CONCURRENTLY em 23/10, aqui para quem recriar o banco): os EXISTS por
-- (fonte, foto) passam a ser busca pontual.
create index if not exists idx_imoveis_ativo_fonte_foto0 on public.imoveis_leilao (fonte, (fotos->>0))
  where ativo and (fotos->>0) is not null;
create index if not exists idx_veiculos_ativo_fonte_foto0 on public.veiculos_leilao (fonte, (fotos->>0))
  where ativo and (fotos->>0) is not null;

CREATE OR REPLACE FUNCTION public.reconciliar_relistados()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_r integer; v_p integer; v_ri integer; v_ids uuid[];
        v_a uuid[]; v_b uuid[]; v_d2 timestamptz[]; v_v2 numeric[];
begin
  -- 1) veículo relistado: a cópia mais antiga (leilão já passou) sai, fica a mais nova
  with grupo as (
    select fonte, fotos->>0 as foto
      from public.veiculos_leilao
     where ativo and fotos->>0 is not null
     group by 1, 2
    having count(*) between 2 and 3
  )
  select array_agg(v.id) into v_ids
    from public.veiculos_leilao v
    join grupo g on v.fonte = g.fonte and v.fotos->>0 = g.foto
   where v.ativo and v.data_leilao < now()
     and exists (select 1 from public.veiculos_leilao o
                  where o.ativo and o.id <> v.id and o.fonte = v.fonte and o.fotos->>0 = g.foto
                    and lower(o.titulo) = lower(v.titulo) and o.data_leilao > v.data_leilao);
  update public.veiculos_leilao set ativo = false
   where id = any(coalesce(v_ids, '{}')) and ativo;
  get diagnostics v_r = row_count;

  -- 2) 2ª praça publicada como outro anúncio: funde no da 1ª e suprime o da 2ª
  with cand as (
    select id, fonte, fotos->>0 as foto, lower(titulo) as tit, numero_matricula as mat, valor_minimo, data_leilao_2,
           case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then data_leilao::timestamptz end as d1
      from public.imoveis_leilao
     where ativo and fotos->>0 is not null
       and (fonte, fotos->>0) in (select fonte, fotos->>0 from public.imoveis_leilao
                                   where ativo and fotos->>0 is not null group by 1, 2 having count(*) = 2)
  )
  select array_agg(a.id), array_agg(b.id), array_agg(b.d1), array_agg(b.valor_minimo)
    into v_a, v_b, v_d2, v_v2
    from cand a
    join cand b
      on b.fonte = a.fonte and b.id <> a.id and b.foto = a.foto and b.tit = a.tit
     and b.d1 > a.d1 and b.d1 <= a.d1 + interval '60 days'
     and b.valor_minimo between a.valor_minimo * 0.3 and a.valor_minimo * 0.9
     and not (coalesce(a.mat, '') <> '' and coalesce(b.mat, '') <> '' and a.mat <> b.mat)
   where a.data_leilao_2 is null and b.data_leilao_2 is null and a.valor_minimo > 0;

  update public.imoveis_leilao a
     set data_leilao_2 = p.d2, valor_minimo_2 = p.v2
    from unnest(v_a, v_d2, v_v2) as p(id_a, d2, v2) where a.id = p.id_a;
  update public.imoveis_leilao b
     set ativo = false, suprimido_motivo = 'segunda_praca_em_outro_anuncio'
   where b.id = any(coalesce(v_b, '{}'));
  get diagnostics v_p = row_count;

  -- 3) imóvel relistado: a cópia de leilão encerrado sai quando há outra, viva, do mesmo bem
  v_ids := null;
  with grupo as (
    select fonte, fotos->>0 as foto from public.imoveis_leilao
     where ativo and fotos->>0 is not null group by 1, 2 having count(*) between 2 and 3
  )
  select array_agg(a.id) into v_ids
    from public.imoveis_leilao a
    join grupo g on a.fonte = g.fonte and a.fotos->>0 = g.foto
   where a.ativo
     and public.leilao_ja_encerrado(a.data_leilao, a.data_leilao_2, a.data_fim, a.modalidade)
     and exists (select 1 from public.imoveis_leilao b
                  where b.ativo and b.id <> a.id and b.fonte = a.fonte and b.fotos->>0 = g.foto
                    and lower(b.titulo) = lower(a.titulo)
                    and not public.leilao_ja_encerrado(b.data_leilao, b.data_leilao_2, b.data_fim, b.modalidade)
                    and not (coalesce(a.numero_matricula, '') <> '' and coalesce(b.numero_matricula, '') <> ''
                             and a.numero_matricula <> b.numero_matricula));
  update public.imoveis_leilao set ativo = false, suprimido_motivo = 'relistado'
   where id = any(coalesce(v_ids, '{}')) and ativo;
  get diagnostics v_ri = row_count;

  return jsonb_build_object('veiculo_relistado', v_r, 'imovel_2a_praca_fundida', v_p, 'imovel_relistado', v_ri);
end;
$function$;


-- Painel do admin (erros_cliente: 3× "statement timeout" em /admin, pico 7,6 s no pg_stat_statements).
-- O único pedaço pesado era count(*) de imoveis_leilao ativo: 0,8 s quente, 2,4 s frio. Passa a vir do
-- cache horário (plataforma_numeros_cache.lotes = a mesma contagem, conferida em 23/10: 30.864 × 30.864),
-- como o fotos_storage já vinha desde #283. Cache ausente → conta ao vivo (lento, mas certo; não inventa 0).
CREATE OR REPLACE FUNCTION public.admin_dashboard_contadores(p_inicio timestamp with time zone, p_fim timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare v_role text; v_cache jsonb; v_cache_em timestamptz;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  select dados, atualizado_em into v_cache, v_cache_em from public.plataforma_numeros_cache where id;

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
    'receita', (
      select jsonb_build_object(
        'recebido',      coalesce(sum(valor) filter (where status = 'approved'), 0),
        'recorrente',    coalesce(sum(valor) filter (where status = 'approved' and origem = 'recorrente'), 0),
        'avulso',        coalesce(sum(valor) filter (where status = 'approved' and origem <> 'recorrente'), 0),
        'pagamentos',    count(*) filter (where status = 'approved'),
        'autorizado',    coalesce(sum(valor) filter (where status = 'authorized'), 0),
        'sem_usuario',   coalesce(sum(valor) filter (where status = 'approved' and user_id is null), 0))
      from public.mp_pagamentos
     where criado_em >= p_inicio and criado_em <= p_fim),
    'total',                (select count(*) from public.perfis),
    'inadimplentes',        (select count(*) from public.perfis where inadimplente_desde is not null),
    'novos',                (select count(*) from public.perfis where created_at >= p_inicio and created_at <= p_fim),
    'reembolsos_pendentes', (select count(*) from public.reembolsos_garantia where status = 'solicitado'),
    'db_size_mb',           round(pg_database_size(current_database()) / 1024.0 / 1024.0, 2),
    'imoveis_ativos',       coalesce((v_cache->>'lotes')::bigint,
                                     (select count(*) from public.imoveis_leilao where ativo)),
    'imoveis_ativos_em',    v_cache_em,
    -- Do cache horário (#283): a contagem ao vivo custava 2,8 s. Cache ausente = null (o card mostra 0).
    'fotos_storage',        (v_cache->>'fotos_storage')::bigint,
    'fotos_storage_em',     v_cache_em,
    'gerado_em', now());
end;
$function$;
