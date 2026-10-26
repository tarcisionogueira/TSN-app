-- 26/10 (dono): "gráfico de evolução com imóveis e veículos em leilão, quantitativo por mês, para entender o
-- comportamento de mercado". Não há série pública mensal de lotes em leilão no Brasil — a fonte é o nosso acervo.
--
-- A ARMADILHA (forma nº 10 do CLAUDE.md): o total por mês cresce porque CONECTAMOS leiloeiros, não porque o
-- mercado cresceu (em outubro entraram ~200 tenants novos). Por isso cada série sai em DUAS linhas:
--   * total  — tudo o que temos (mede a nossa cobertura);
--   * painel — só os leiloeiros que já estavam no acervo no início da série e continuam hoje (mede o mercado).
--
-- Fontes de dado:
--   * estoque médio do mês: foto diária do acervo ativo. Imóveis desde 21/07 (fonte_metricas_hist, backfill
--     abaixo); veículos só a partir de hoje — antes disso não houve foto, e reconstruir pela criado_em daria um
--     número plausível e errado (o lote encerrado não tem data de saída).
--   * leilões no mês: lotes com a 1ª data de leilão no mês (a base guarda o lote encerrado).

create table if not exists public.acervo_estoque_dia (
  dia    date    not null,
  tipo   text    not null check (tipo in ('imovel', 'veiculo')),
  fonte  text    not null,
  ativos integer not null,
  primary key (dia, tipo, fonte)
);
alter table public.acervo_estoque_dia enable row level security;
comment on table public.acervo_estoque_dia is 'Foto diária do acervo ativo por fonte (imóvel e veículo). Grava: snapshot_acervo_estoque() pelo monitor-fontes-cron. Lê: mercado_evolucao_mensal().';

create or replace function public.snapshot_acervo_estoque()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
 set statement_timeout to '60s'
as $function$
declare n integer;
begin
  insert into public.acervo_estoque_dia as h (dia, tipo, fonte, ativos)
  select (now() at time zone 'utc')::date, 'imovel', fonte, count(*) from public.imoveis_leilao where ativo group by fonte
  union all
  select (now() at time zone 'utc')::date, 'veiculo', fonte, count(*) from public.veiculos_leilao where ativo group by fonte
  on conflict (dia, tipo, fonte) do update set ativos = excluded.ativos;
  get diagnostics n = row_count;
  return n;
end
$function$;

-- Backfill: imóveis desde 21/07 a partir da foto que o monitor já gravava.
insert into public.acervo_estoque_dia (dia, tipo, fonte, ativos)
select dia, 'imovel', fonte, ativos from public.fonte_metricas_hist where ativos is not null
on conflict (dia, tipo, fonte) do nothing;

select public.snapshot_acervo_estoque();

create or replace function public.mercado_evolucao_mensal(p_meses integer default 12)
 returns jsonb
 language plpgsql
 stable
 security definer
 set search_path to 'public'
 set statement_timeout to '30s'
as $function$
declare
  v_ini date := (date_trunc('month', now()) - make_interval(months => greatest(1, least(p_meses, 36)) - 1))::date;
  v_fim date := (date_trunc('month', now()) + interval '3 months')::date;  -- leilões já agendados
  v_res jsonb;
begin
  if not public.is_admin() and current_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'mercado_evolucao_mensal: só admin';
  end if;

  with
  limites as (
    select tipo, min(dia) d0, max(dia) d1 from acervo_estoque_dia group by tipo
  ),
  -- Painel de imóveis: fonte com lote ativo no 1º e no último dia da foto.
  painel_imovel as (
    select a.fonte from acervo_estoque_dia a join limites l on l.tipo = a.tipo and a.dia = l.d0
     where a.tipo = 'imovel' and a.ativos > 0
    intersect
    select a.fonte from acervo_estoque_dia a join limites l on l.tipo = a.tipo and a.dia = l.d1
     where a.tipo = 'imovel' and a.ativos > 0
  ),
  -- Painel de veículos: a foto começou em 26/10, então o início vem da captação — fonte que já trazia
  -- veículo no 1º mês de coleta e ainda tem lote ativo.
  mes0_veic as (select date_trunc('month', min(criado_em)) m from veiculos_leilao),
  painel_veiculo as (
    select fonte from veiculos_leilao, mes0_veic where date_trunc('month', criado_em) = mes0_veic.m
    intersect
    select fonte from veiculos_leilao where ativo
  ),
  estoque as (
    select to_char(date_trunc('month', d.dia), 'YYYY-MM') mes, d.tipo,
           round(avg(d.tot)) estoque, round(avg(d.pan)) estoque_painel, count(*) dias
      from (select a.dia, a.tipo, sum(a.ativos) tot,
                   sum(a.ativos) filter (where (a.tipo = 'imovel' and a.fonte in (select fonte from painel_imovel))
                                            or (a.tipo = 'veiculo' and a.fonte in (select fonte from painel_veiculo))) pan
              from acervo_estoque_dia a where a.dia >= v_ini group by 1, 2) d
     group by 1, 2
  ),
  leiloes as (
    select left(data_leilao, 7) mes, 'imovel' tipo, count(*) leiloes,
           count(*) filter (where fonte in (select fonte from painel_imovel)) leiloes_painel
      from imoveis_leilao
     where data_leilao ~ '^\d{4}-\d{2}' and data_leilao >= to_char(v_ini, 'YYYY-MM') and data_leilao < to_char(v_fim, 'YYYY-MM')
     group by 1
    union all
    select to_char(data_leilao, 'YYYY-MM'), 'veiculo', count(*),
           count(*) filter (where fonte in (select fonte from painel_veiculo))
      from veiculos_leilao where data_leilao >= v_ini and data_leilao < v_fim
     group by 1
  ),
  -- O 1º mês de coleta é parcial (o leilão que aconteceu antes de começarmos não foi visto): a série começa
  -- no mês seguinte, senão o gráfico abre com um "salto" que é só o início da coleta.
  coleta as (
    select 'imovel' tipo, to_char(date_trunc('month', min(criado_em)) + interval '1 month', 'YYYY-MM') m1 from imoveis_leilao
    union all
    select 'veiculo', to_char(date_trunc('month', min(criado_em)) + interval '1 month', 'YYYY-MM') from veiculos_leilao
  ),
  meses as (
    select u.mes, u.tipo from (select mes, tipo from estoque union select mes, tipo from leiloes) u
      join coleta c on c.tipo = u.tipo where u.mes >= c.m1
  )
  select jsonb_build_object(
    'gerado_em', now(),
    'mes_atual', to_char(now(), 'YYYY-MM'),
    'primeiro_mes_completo', (select jsonb_object_agg(tipo, m1) from coleta),
    'inicio_foto', (select jsonb_object_agg(tipo, d0) from limites),
    'painel_fontes', jsonb_build_object('imovel', (select count(*) from painel_imovel), 'veiculo', (select count(*) from painel_veiculo)),
    'serie', coalesce((select jsonb_agg(jsonb_build_object(
        'mes', m.mes, 'tipo', m.tipo,
        'estoque', e.estoque, 'estoque_painel', e.estoque_painel, 'dias_foto', e.dias,
        'leiloes', coalesce(l.leiloes, 0), 'leiloes_painel', coalesce(l.leiloes_painel, 0)) order by m.tipo, m.mes)
      from meses m left join estoque e using (mes, tipo) left join leiloes l using (mes, tipo)), '[]'::jsonb))
  into v_res;
  return v_res;
end
$function$;

-- Só admin lê (o is_admin() acima barra o resto, mas a auditoria exige que anônimo nem execute);
-- a foto é escrita só pelo servidor.
revoke execute on function public.mercado_evolucao_mensal(integer) from public, anon;
revoke execute on function public.snapshot_acervo_estoque() from public, anon, authenticated;
