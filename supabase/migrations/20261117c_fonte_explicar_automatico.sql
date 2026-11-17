-- Auditoria de captura (17/11), item 6: o que NÃO é defeito nosso sai da lista de suspeitas sozinho.
-- Antes cada site fora do ar (LUIZLOBATO 503, LUNELLI com certificado vencido) ou leiloeiro sem lote
-- publicado pedia investigação manual e um insert à mão em fonte_regressao_explicada, todo mês.
--
-- Regra (só com prova nas 3 últimas MEDIÇÕES — `sem_cota` não é medição, ver 18/08):
--   fora_do_ar   → as 3 falharam e o motivo é de ACESSO (HTTP 403/5xx, desafio, timeout, DNS,
--                  certificado, firecrawl-5xx, ou o próprio scraper escreveu "não parser").
--   sem_lote     → as 3 vieram `vazio` com o scraper AFIRMANDO que leu o catálogo e não há lote
--                  ("site sem imóvel/veículo em aberto", "nenhum lote encontrado").
--                  "respondeu 200 e enumerou 0" NÃO entra: pode ser parser quebrado (forma nº 10).
-- Validade de 7 dias, renovada a cada rodada enquanto a prova persistir. Explicação MANUAL ainda
-- vigente nunca é sobrescrita (só linhas '[auto]' ou vencidas). Chamada pelo monitor-fontes-cron.
create or replace function public.fonte_explicar_automatico()
returns table (fonte text, motivo text, tipo text)
language sql
security invoker
set search_path = public
as $$
  with susp as (
    select s.fonte, s.motivo from public.fonte_regressao_suspeita() s where s.motivo in ('zerou','regressao')
  ), ult as (
    select h.fonte, h.status, h.motivo,
           row_number() over (partition by h.fonte order by h.executado_em desc) rn
      from public.fonte_saude h join susp using (fonte)
     where h.status <> 'sem_cota' and h.executado_em > now() - interval '10 days'
  ), prova as (
    select u.fonte, sp.motivo,
      case
        when bool_and(u.status = 'falhou' and u.motivo ~* '(n[aã]o parser|HTTP (403|5[0-9]{2})|challenge|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|CERT|SSL|Timeout of|firecrawl-5[0-9]{2}|dom-(403|5[0-9]{2}))')
          then 'fora_do_ar'
        when bool_and(u.status = 'vazio' and u.motivo ~* '(site sem (im[oó]vel|ve[ií]culo) em aberto|nenhum lote encontrado)')
          then 'sem_lote'
      end as tipo,
      left(max(u.motivo) filter (where u.rn = 1), 160) as ult_motivo
    from ult u join susp sp using (fonte)
    where u.rn <= 3
    group by u.fonte, sp.motivo
    having count(*) = 3
  ), gravou as (
    insert into public.fonte_regressao_explicada as e (fonte, motivo, explicacao, explicado_em, explicado_ate)
    select p.fonte, p.motivo,
           '[auto] ' || case p.tipo when 'fora_do_ar' then 'site fora do ar ou bloqueando o robô nas 3 últimas medições: '
                                    else 'leiloeiro sem lote publicado nas 3 últimas medições: ' end || p.ult_motivo,
           now(), current_date + 7
      from prova p where p.tipo is not null
    on conflict (fonte) do update set motivo = excluded.motivo, explicacao = excluded.explicacao,
           explicado_em = excluded.explicado_em, explicado_ate = excluded.explicado_ate
     where e.explicacao like '[auto]%' or e.explicado_ate < current_date
    returning e.fonte, e.motivo, e.explicacao
  )
  select g.fonte, g.motivo, case when g.explicacao like '[auto] site%' then 'fora_do_ar' else 'sem_lote' end from gravou g;
$$;
