-- #410 (16/11): lacuna de captação medida POR ID quando o coletor sabe medir.
-- A comparação de contagens (enumerados × ativos + inativos explicados nos últimos 10 dias) acusava falta onde não
-- havia: o coletor SOLEON não relê lote inativo, então o vendido/vencido/gêmeo que o site segue listando envelhece no
-- banco, sai da janela de 10 dias e vira "faltando" (GOLD 42%, CASSIANO 34%, WMS 59%). O coletor agora grava em
-- `fora_do_acervo` quantos IDs enumerados HOJE não existem no banco em estado nenhum — essa é a lacuna. Fonte sem a
-- medida segue pela contagem antiga.
alter table public.fonte_saude add column if not exists fora_do_acervo integer;

create or replace function public.fonte_captacao_lacuna(p_min integer default 20, p_pct numeric default 85)
returns table(fonte text, no_site integer, no_acervo bigint, faltam bigint, pct numeric, medido_em timestamptz, status text)
language sql stable set search_path = public as $$
  with ult as (
    select distinct on (s.fonte) s.fonte, coalesce(s.candidatos, s.enumerados) as enumerados, s.fora_do_acervo, s.executado_em, s.status
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
           case when u.fora_do_acervo is not null then greatest(u.enumerados - u.fora_do_acervo, 0)
                else coalesce(case when u.fonte like '%\_VEICULOS' then ve.n else im.n end, 0)
                     + case when u.fonte like '%\_VEICULOS' then 0 else coalesce(rc.n, 0) end
           end as n
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
$$;
