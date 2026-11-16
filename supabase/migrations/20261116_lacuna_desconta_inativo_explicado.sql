-- 16/11 (#410) — fonte_captacao_lacuna contava como "faltando" o lote que está NO BANCO, inativo por motivo legítimo e
-- ainda listado no site: praça vencida (leilão encerrado que o site segue mostrando), gêmeo de outra fonte, duplicata,
-- vaga de garagem, fração ideal, não-imóvel. Caso real: HASTA "183 faltando" eram 182 lotes no banco (veículos/sucata do
-- leilão SAEB-BA e praças encerradas) — forma nº 10: media "listado no site" e reportava "deixamos de capturar".
-- Agora desconta esses inativos, só quando TOCADOS nos últimos 10 dias (o coletor os viu na lista; inativo antigo não
-- esconde lacuna nova). `sumiu_da_fonte` NÃO desconta: listado no site e marcado como sumido é lacuna de verdade.
-- Medido em seco: HASTA sai da lista; COMPREI 111→41; GOLDLEILOES 201→148; BAYIT 57→29.
CREATE OR REPLACE FUNCTION public.fonte_captacao_lacuna(p_min integer DEFAULT 20, p_pct numeric DEFAULT 85)
 RETURNS TABLE(fonte text, no_site integer, no_acervo bigint, faltam bigint, pct numeric, medido_em timestamp with time zone, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ult as (
    select distinct on (s.fonte) s.fonte, s.enumerados, s.executado_em, s.status
      from fonte_saude s
     where s.enumerados is not null and s.status <> 'sem_cota' and s.executado_em > now() - interval '10 days'
     order by s.fonte, s.executado_em desc),
  im as (select i.fonte, count(*) n from imoveis_leilao i
          where i.ativo
             or (i.atualizado_em > now() - interval '10 days'
                 and (i.suprimido_motivo in ('praca_vencida', 'duplicata_comprei', 'vaga_garagem', 'fracao_ideal', 'nao_imovel')
                      or i.suprimido_motivo like 'gemeo%'))
          group by 1),
  ve as (select v.fonte, count(*) n from veiculos_leilao v where v.ativo or v.suprimido_motivo is not null group by 1),
  rc as (select r.fonte, count(*) n from coleta_lote_recusado r where r.motivo not like 'descartado: valor%' group by 1),
  acv as (
    select u.fonte, u.enumerados, u.executado_em, u.status,
           coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0)
             + case when u.fonte like '%\_VEICULOS' then 0 else coalesce(rc.n, 0) end as n
      from ult u
      left join im on im.fonte = u.fonte
      left join ve on ve.fonte = replace(u.fonte, '_VEICULOS', '')
      left join rc on rc.fonte = u.fonte)
  select a.fonte, a.enumerados, least(a.n, a.enumerados)::bigint as no_acervo,
         greatest(a.enumerados - a.n, 0)::bigint as faltam,
         round(100.0 * least(a.n, a.enumerados) / nullif(a.enumerados, 0)) as pct,
         a.executado_em, a.status
    from acv a
   where a.enumerados >= p_min
     and a.status <> 'vazio'
     and a.n < a.enumerados * p_pct / 100.0
   order by 4 desc;
$function$;

-- Parte 2 (mesmo dia): `enumerados` conta TUDO o que o site lista — é o que a regressão compara e precisa continuar assim.
-- Mas a NORDESTE lista 144 e 139 são veículos/sucata que o motor já descarta pela URL: a lacuna acusava 137 "faltando".
-- `candidatos` = os que passaram pelo filtro de imóvel por URL (scripts/lib/motor/runner.mjs → _saude-fonte.mjs);
-- a lacuna usa coalesce(candidatos, enumerados) — fonte de coletor antigo (sem o campo) segue como antes.
alter table public.fonte_saude add column if not exists candidatos integer;
CREATE OR REPLACE FUNCTION public.fonte_captacao_lacuna(p_min integer DEFAULT 20, p_pct numeric DEFAULT 85)
 RETURNS TABLE(fonte text, no_site integer, no_acervo bigint, faltam bigint, pct numeric, medido_em timestamp with time zone, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with ult as (
    select distinct on (s.fonte) s.fonte, coalesce(s.candidatos, s.enumerados) as enumerados, s.executado_em, s.status
      from fonte_saude s
     where s.enumerados is not null and s.status <> 'sem_cota' and s.executado_em > now() - interval '10 days'
     order by s.fonte, s.executado_em desc),
  im as (select i.fonte, count(*) n from imoveis_leilao i
          where i.ativo
             or (i.atualizado_em > now() - interval '10 days'
                 and (i.suprimido_motivo in ('praca_vencida', 'duplicata_comprei', 'vaga_garagem', 'fracao_ideal', 'nao_imovel')
                      or i.suprimido_motivo like 'gemeo%'))
          group by 1),
  ve as (select v.fonte, count(*) n from veiculos_leilao v where v.ativo or v.suprimido_motivo is not null group by 1),
  rc as (select r.fonte, count(*) n from coleta_lote_recusado r where r.motivo not like 'descartado: valor%' group by 1),
  acv as (
    select u.fonte, u.enumerados, u.executado_em, u.status,
           coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0)
             + case when u.fonte like '%\_VEICULOS' then 0 else coalesce(rc.n, 0) end as n
      from ult u
      left join im on im.fonte = u.fonte
      left join ve on ve.fonte = replace(u.fonte, '_VEICULOS', '')
      left join rc on rc.fonte = u.fonte)
  select a.fonte, a.enumerados, least(a.n, a.enumerados)::bigint as no_acervo,
         greatest(a.enumerados - a.n, 0)::bigint as faltam,
         round(100.0 * least(a.n, a.enumerados) / nullif(a.enumerados, 0)) as pct,
         a.executado_em, a.status
    from acv a
   where a.enumerados >= p_min
     and a.status <> 'vazio'
     and a.n < a.enumerados * p_pct / 100.0
   order by 4 desc;
$function$;
