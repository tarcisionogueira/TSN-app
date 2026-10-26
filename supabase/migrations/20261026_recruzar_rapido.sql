-- 26/10: leiloeiro_junta_recruzar levava 11 s e o monitor-fontes-cron a chama pelo PostgREST
-- (authenticator: statement_timeout = 8 s). Estourou em 26/10 18:11 UTC (57014) e o re-cruzamento
-- diário não gravou nada. Mesma lógica e mesma saída; o que muda é ONDE as regex rodam:
--   * a chave de loja Superbid e o padrão '%.dominio' saem do par (junta × nomes/hosts) e vão para o
--     CTE `j` (uma vez por domínio, não ~1,3 milhão de vezes);
--   * a base dos domínios "por código" sai do unnest correlacionado e vai para o CTE `cod`.
create or replace function public.leiloeiro_junta_recruzar(p_aplicar boolean default false, p_dominios_codigo text[] default null::text[])
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  v_cod text[];
  v_res jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'leiloeiro_junta_recruzar: só o servidor';
  end if;

  v_cod := coalesce(p_dominios_codigo, array(
    select distinct dominio from leiloeiro_junta where coletado_via like '%codigo%' and dominio is not null
));

  with
  lotes as materialized (
    select fonte, lower(regexp_replace(url_lote, '^https?://(www\.)?([^/:?#]+).*$', '\2')) host, leiloeiro_chave(leiloeiro) lk
      from imoveis_leilao where ativo and url_lote ~ '^https?://'
    union all
    select fonte, lower(regexp_replace(link_lote, '^https?://(www\.)?([^/:?#]+).*$', '\2')), leiloeiro_chave(leiloeiro)
      from veiculos_leilao where ativo and link_lote ~ '^https?://'
  ),
  hosts as materialized (
    select host, fonte, n, radical, base,
           (base !~ '\.' or base ~ '^(api|api-v2|static|cdn|img|imagens|arquivos|leilao|leiloes|app|painel|adm|portal|site)\.') base_ok
      from (
        select host, fonte, count(*) n,
               regexp_replace(regexp_replace(host, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', ''), '^.*\.', '') radical,
               regexp_replace(host, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', '') base
          from lotes group by 1, 2) h0
  ),
  nomes as materialized (select lk, fonte, count(*) n from lotes where lk is not null and length(lk) >= 8 group by 1, 2
    union all
    select 'sbidloja:' || k, 'SUPERBID', count(*) from (
      select lower(regexp_replace(translate(upper(leiloeiro), 'ÁÀÃÂÉÊÍÓÔÕÚÇ', 'AAAAEEIOOOUC'), '[^A-Z]|LEILOES|LEILOEIRO|LEILAO', '', 'g')) k
        from (select leiloeiro from imoveis_leilao where ativo and fonte = 'SUPERBID'
              union all select leiloeiro from veiculos_leilao where ativo and fonte = 'SUPERBID') x) y
     where length(k) >= 3 group by 1),
  cod as materialized (
    select d, regexp_replace(d, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', '') cbase
      from unnest(v_cod) c(d)
  ),
  j as materialized (
    select id, antes, via_antes, dominio, nk, dbase,
           '%.' || dominio dpat,
           (dbase !~ '\.' and length(dbase) >= 5) radical_ok,
           case when dominio is not null
                then 'sbidloja:' || regexp_replace(regexp_replace(dbase, '^.*\.', ''), '(leiloes|leiloeiro|leilao)$', '') end sbk
      from (
        select id, antes, via_antes, dominio, nk,
               regexp_replace(dominio, '\.(com|net|org|adv|lel|leilao)?\.?br$|\.(com|net|org|io|online|site)$', '') dbase
          from (select id, coletado_status antes, coletado_via via_antes,
                       nullif(regexp_replace(lower(btrim(dominio)), '^www\.', ''), '') dominio,
                       leiloeiro_chave(nome) nk
                  from leiloeiro_junta) j0) j1
  ),
  ev as (
    select j.id,
      (select string_agg(h.fonte || '(' || h.n || ')', ',' order by h.n desc) from hosts h
        where h.fonte not in ('EDITAL_DJEN', 'LJUD') and j.dominio is not null
          and (h.host = j.dominio or h.host like j.dpat
               or (j.radical_ok and h.radical = j.dbase and h.base_ok))) ev_host,
      (select string_agg(h.fonte || '(' || h.n || ')', ',' order by h.n desc) from hosts h
        where h.fonte in ('EDITAL_DJEN', 'LJUD') and j.dominio is not null
          and (h.host = j.dominio or h.host like j.dpat)) ev_host_agr,
      (select string_agg(n.fonte || '(' || n.n || ')', ',' order by n.n desc) from nomes n
        where (n.lk = j.nk or n.lk = j.sbk)
          and n.fonte not in ('EDITAL_DJEN', 'LJUD')) ev_nome,
      (select string_agg(n.fonte || '(' || n.n || ')', ',' order by n.n desc) from nomes n
        where n.lk = j.nk and n.fonte in ('EDITAL_DJEN', 'LJUD')) ev_nome_agr,
      (j.dominio is not null and exists (
         select 1 from cod c
          where c.d = j.dominio or c.d like j.dpat
             or (j.radical_ok and c.cbase = j.dbase))) ev_cod
    from j
  ),
  novo as (
    select j.id, j.antes, j.via_antes, j.dominio,
      case when ev.ev_host is not null or ev.ev_nome is not null then 'coletado'
           when ev.ev_host_agr is not null or ev.ev_nome_agr is not null then 'agregador'
           when ev.ev_cod then 'codigo_sem_lote'
           when j.dominio is null then 'sem_site'
           else 'nao_coletado' end depois,
      nullif(concat_ws(' ; ',
        'host:' || ev.ev_host, 'nome:' || ev.ev_nome,
        'agregador_host:' || ev.ev_host_agr, 'agregador_nome:' || ev.ev_nome_agr,
        case when ev.ev_cod then 'codigo' end), '') via
    from j join ev using (id)
  ),
  mud as (
    update leiloeiro_junta l set coletado_status = n.depois, coletado_via = n.via
      from novo n
     where p_aplicar and l.id = n.id
       and (l.coletado_status is distinct from n.depois or l.coletado_via is distinct from n.via)
    returning l.id
  )
  select jsonb_build_object(
      'aplicado', p_aplicar,
      'linhas_gravadas', (select count(*) from mud),
      'dominios_codigo', coalesce(array_length(v_cod, 1), 0),
      'transicoes', (select jsonb_object_agg(k, c) from (
          select coalesce(antes, '(nulo)') || ' -> ' || depois k, count(*) c from novo
           where antes is distinct from depois group by 1) t),
      'depois', (select jsonb_object_agg(depois, c) from (select depois, count(*) c from novo group by 1) t),
      'amostras', (select jsonb_object_agg(k, a) from (
          select k, jsonb_agg(x) a from (
            select coalesce(antes, '(nulo)') || ' -> ' || depois k, dominio || ' | ' || coalesce(via, '-') x,
                   row_number() over (partition by antes, depois order by dominio) rn
              from (select distinct antes, depois, dominio, via from novo
                     where antes is distinct from depois and dominio is not null) d) z
           where rn <= 12 group by k) t))
    into v_res;
  return v_res;
end
$function$;
