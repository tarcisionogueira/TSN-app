-- RPCs da base socio-demográfica: gravar (upsert por fonte), derivar (leitura autocalibrada)
-- e ler (cascata bairro > cidade, do jeito que o relatório precisa).

-- ── 1. UPSERT POR FONTE ─────────────────────────────────────────────────────
-- Cada fonte grava SÓ as colunas que ela conhece. O coalesce(excluded.x, atual.x) impede que
-- a fonte de domicílios apague a população que a fonte anterior já tinha gravado — erro
-- clássico de ingestão multi-fonte, aqui impossível por construção.
create or replace function public.socio_upsert(p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare n integer;
begin
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' then return 0; end if;

  with novo as (
    select * from jsonb_populate_recordset(null::public.cidade_socio, p_rows)
  ),
  -- Colunas da CHAVE saneadas explicitamente. (Uma primeira versão fazia
  -- `select coalesce(...) as nivel, ..., *`, que reintroduzia nivel/cidade_norm/uf/bairro_norm
  -- e deixava a referência ambígua — o ensaio de gravação pegou isso antes de o cron rodar.)
  valido as (
    select coalesce(nullif(nivel,''),'cidade')  as nivel,
           cidade_norm,
           upper(uf)                            as uf,
           coalesce(bairro_norm,'')             as bairro_norm,
           ibge_codigo, populacao, populacao_ano, populacao_ant, populacao_ant_ano,
           crescimento_pct, area_km2, densidade_hab_km2,
           domicilios, domicilios_ano, domicilios_ocupados, domicilios_vagos, moradores_por_domicilio,
           pop_estim, pop_estim_ano, pop_estim_ant, pop_estim_ant_ano,
           nascimentos, nascimentos_ano, empregos_saldo, empregos_ref,
           deficit_fjp, deficit_fjp_pct, deficit_fjp_ano, detalhe
      from novo
     where coalesce(cidade_norm,'') <> '' and coalesce(uf,'') <> ''
  ),
  ins as (
    insert into public.cidade_socio as t (
      nivel, cidade_norm, uf, bairro_norm, ibge_codigo,
      populacao, populacao_ano, populacao_ant, populacao_ant_ano, crescimento_pct,
      area_km2, densidade_hab_km2,
      domicilios, domicilios_ano, domicilios_ocupados, domicilios_vagos, moradores_por_domicilio,
      pop_estim, pop_estim_ano, pop_estim_ant, pop_estim_ant_ano,
      nascimentos, nascimentos_ano, empregos_saldo, empregos_ref,
      deficit_fjp, deficit_fjp_pct, deficit_fjp_ano,
      atualizado_em, detalhe
    )
    select v.nivel, v.cidade_norm, v.uf, v.bairro_norm, v.ibge_codigo,
           v.populacao, v.populacao_ano, v.populacao_ant, v.populacao_ant_ano, v.crescimento_pct,
           v.area_km2, v.densidade_hab_km2,
           v.domicilios, v.domicilios_ano, v.domicilios_ocupados, v.domicilios_vagos, v.moradores_por_domicilio,
           v.pop_estim, v.pop_estim_ano, v.pop_estim_ant, v.pop_estim_ant_ano,
           v.nascimentos, v.nascimentos_ano, v.empregos_saldo, v.empregos_ref,
           v.deficit_fjp, v.deficit_fjp_pct, v.deficit_fjp_ano,
           now(), coalesce(v.detalhe, '{}'::jsonb)
      from valido v
    on conflict (nivel, cidade_norm, uf, bairro_norm) do update set
      ibge_codigo             = coalesce(excluded.ibge_codigo, t.ibge_codigo),
      populacao               = coalesce(excluded.populacao, t.populacao),
      populacao_ano           = coalesce(excluded.populacao_ano, t.populacao_ano),
      populacao_ant           = coalesce(excluded.populacao_ant, t.populacao_ant),
      populacao_ant_ano       = coalesce(excluded.populacao_ant_ano, t.populacao_ant_ano),
      crescimento_pct         = coalesce(excluded.crescimento_pct, t.crescimento_pct),
      area_km2                = coalesce(excluded.area_km2, t.area_km2),
      densidade_hab_km2       = coalesce(excluded.densidade_hab_km2, t.densidade_hab_km2),
      domicilios              = coalesce(excluded.domicilios, t.domicilios),
      domicilios_ano          = coalesce(excluded.domicilios_ano, t.domicilios_ano),
      domicilios_ocupados     = coalesce(excluded.domicilios_ocupados, t.domicilios_ocupados),
      domicilios_vagos        = coalesce(excluded.domicilios_vagos, t.domicilios_vagos),
      moradores_por_domicilio = coalesce(excluded.moradores_por_domicilio, t.moradores_por_domicilio),
      pop_estim               = coalesce(excluded.pop_estim, t.pop_estim),
      pop_estim_ano           = coalesce(excluded.pop_estim_ano, t.pop_estim_ano),
      pop_estim_ant           = coalesce(excluded.pop_estim_ant, t.pop_estim_ant),
      pop_estim_ant_ano       = coalesce(excluded.pop_estim_ant_ano, t.pop_estim_ant_ano),
      nascimentos             = coalesce(excluded.nascimentos, t.nascimentos),
      nascimentos_ano         = coalesce(excluded.nascimentos_ano, t.nascimentos_ano),
      empregos_saldo          = coalesce(excluded.empregos_saldo, t.empregos_saldo),
      empregos_ref            = coalesce(excluded.empregos_ref, t.empregos_ref),
      deficit_fjp             = coalesce(excluded.deficit_fjp, t.deficit_fjp),
      deficit_fjp_pct         = coalesce(excluded.deficit_fjp_pct, t.deficit_fjp_pct),
      deficit_fjp_ano         = coalesce(excluded.deficit_fjp_ano, t.deficit_fjp_ano),
      atualizado_em           = now(),
      detalhe                 = coalesce(t.detalhe,'{}'::jsonb) || coalesce(excluded.detalhe,'{}'::jsonb)
    returning 1
  )
  select count(*) into n from ins;
  return coalesce(n, 0);
end;
$$;

revoke all on function public.socio_upsert(jsonb) from public, anon, authenticated;
grant execute on function public.socio_upsert(jsonb) to service_role;


-- ── 2. DERIVAR (autocalibrado, sem número mágico) ───────────────────────────
-- A régua NÃO é chutada: sai dos TERCIS do próprio país, calculados do que foi ingerido.
-- Mesma filosofia do fonte_baseline_aprendida() — o sistema aprende o normal em vez de
-- carregar um limiar hardcoded que envelhece calado.
-- A frase (`pressao_nota`) vai IMPRESSA no parecer do cliente, então sai formatada em pt-BR.
create or replace function public.socio_derivar()
returns integer
language plpgsql
security definer
set search_path = 'public'
as $$
declare n integer; v33 numeric; v66 numeric; c33 numeric; c66 numeric;
        fmt1 text := 'FM990.0'; fmt2 text := 'FM990.00';
begin
  with base as (
    select nivel, cidade_norm, uf, bairro_norm,
      case when coalesce(nullif(domicilios,0), nullif(coalesce(domicilios_ocupados,0)+coalesce(domicilios_vagos,0),0)) > 0
             and domicilios_vagos is not null
        then round(domicilios_vagos::numeric
             / coalesce(nullif(domicilios,0), domicilios_ocupados + domicilios_vagos) * 100, 2) end as vagos_pct,
      case
        when pop_estim > 0 and pop_estim_ant > 0 and pop_estim_ano > pop_estim_ant_ano
          then round((power(pop_estim::numeric / pop_estim_ant, 1.0 / (pop_estim_ano - pop_estim_ant_ano)) - 1) * 100, 2)
        -- sem estimativa anual, cai na variação intercensitária (12 anos entre 2010 e 2022)
        when crescimento_pct is not null and crescimento_pct > -100
          then round((power(1 + crescimento_pct/100.0, 1.0/12.0) - 1) * 100, 2)
      end as cresc_aa
    from public.cidade_socio
  )
  update public.cidade_socio t
     set domicilios_vagos_pct = b.vagos_pct,
         crescimento_recente_aa_pct = b.cresc_aa
    from base b
   where t.nivel = b.nivel and t.cidade_norm = b.cidade_norm and t.uf = b.uf and t.bairro_norm = b.bairro_norm;

  select percentile_cont(0.33) within group (order by domicilios_vagos_pct),
         percentile_cont(0.66) within group (order by domicilios_vagos_pct),
         percentile_cont(0.33) within group (order by crescimento_recente_aa_pct),
         percentile_cont(0.66) within group (order by crescimento_recente_aa_pct)
    into v33, v66, c33, c66
    from public.cidade_socio where nivel = 'cidade';

  with pontuado as (
    select nivel, cidade_norm, uf, bairro_norm, domicilios_vagos_pct v, crescimento_recente_aa_pct c,
           (case when domicilios_vagos_pct is null then 0
                 when domicilios_vagos_pct <= v33 then 1
                 when domicilios_vagos_pct >= v66 then -1 else 0 end)
         + (case when crescimento_recente_aa_pct is null then 0
                 when crescimento_recente_aa_pct >= c66 then 1
                 when crescimento_recente_aa_pct <= c33 then -1 else 0 end) as score
      from public.cidade_socio
  )
  update public.cidade_socio t set
    pressao_classe = case when p.v is null and p.c is null then null
                          when p.score >= 1 then 'demanda_reprimida'
                          when p.score <= -1 then 'estoque_ocioso'
                          else 'equilibrio' end,
    pressao_nota = case when p.v is null and p.c is null then null else
      concat_ws(' · ',
        case when p.v is not null then 'domicílios vagos ' || replace(trim(to_char(p.v, fmt1)),'.',',') || '%'
             || ' (país: até ' || replace(trim(to_char(v33, fmt1)),'.',',') || '% é o terço mais baixo, acima de '
             || replace(trim(to_char(v66, fmt1)),'.',',') || '% o mais alto)' end,
        case when p.c is not null then 'população ' || replace(trim(to_char(p.c, fmt2)),'.',',') || '% a.a.'
             || ' (país: acima de ' || replace(trim(to_char(c66, fmt2)),'.',',') || '% a.a. é o terço que mais cresce, abaixo de '
             || replace(trim(to_char(c33, fmt2)),'.',',') || '% o que menos cresce)' end
      ) end,
    pressao_metodo = case when p.v is null and p.c is null then null else
      'Leitura BidPro derivada do Censo/estimativas do IBGE: cruza o percentual de domicílios vagos com o ritmo de crescimento da população, comparando a cidade aos TERCIS de todos os municípios do país (régua recalculada a cada ingestão). NÃO é o déficit habitacional da FJP.' end
    from pontuado p
   where t.nivel = p.nivel and t.cidade_norm = p.cidade_norm and t.uf = p.uf and t.bairro_norm = p.bairro_norm;

  get diagnostics n = row_count;
  return coalesce(n, 0);
end;
$$;

revoke all on function public.socio_derivar() from public, anon, authenticated;
grant execute on function public.socio_derivar() to service_role;


-- ── 3. LEITURA PARA O RELATÓRIO (bairro > cidade) ───────────────────────────
-- Uma linha, índice direto. É isto que o relatório chama — leitura de milissegundos, sem
-- nenhuma busca na web. Toda a coleta pesada já aconteceu no cron de ingestão.
create or replace function public.socio_regiao(
  p_cidade_norm text, p_uf text, p_bairro text default ''
)
returns jsonb
language sql
stable
security definer
set search_path = 'public'
as $$
  select to_jsonb(x) from (
    select nivel, populacao, populacao_ano, crescimento_pct,
           pop_estim, pop_estim_ano, crescimento_recente_aa_pct,
           domicilios, domicilios_ano, domicilios_vagos, domicilios_vagos_pct,
           moradores_por_domicilio, densidade_hab_km2, area_km2,
           nascimentos, nascimentos_ano, empregos_saldo, empregos_ref,
           deficit_fjp, deficit_fjp_pct, deficit_fjp_ano,
           pressao_classe, pressao_nota, pressao_metodo, atualizado_em
      from public.cidade_socio
     where cidade_norm = p_cidade_norm and uf = upper(p_uf)
       and (bairro_norm = coalesce(nullif(trim(lower(p_bairro)),''),'§') or bairro_norm = '')
     order by (bairro_norm <> '') desc   -- bairro ganha da cidade quando existir
     limit 1
  ) x;
$$;

revoke all on function public.socio_regiao(text,text,text) from public, anon;
grant execute on function public.socio_regiao(text,text,text) to authenticated, service_role;

comment on function public.socio_regiao(text,text,text) is
  'Le demografia/pressao habitacional da regiao (bairro > cidade). Usada pelo relatorio mercadologico como LEITURA de banco — nunca busca na web.';
