-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O ALARME DE CAPTURA ACUSAVA A FONTE SÃ E POUPAVA A DOENTE — 27/08/2026
--
-- O ritual de abertura (Seção 2 do CLAUDE.md) tinha uma CONSULTA solta comparando o último
-- `fonte_saude.total` contra o piso aprendido. Hoje ela acusou LEILOFY: 12 lotes contra piso
-- de 37, depois de 25 dias estável em ~74.
--
-- NÃO ERA REGRESSÃO. Os 51 lotes que saíram em 25/08 tinham TODOS `data_leilao = 25/08`:
-- o leilão aconteceu, `desativar-encerrados-cron` fez o trabalho dele, e o acervo esvaziou
-- como devia. Os 8 que sobraram têm praça futura (01/09 a 28/09). O parser está intacto —
-- e "consertar" um parser são é o pior desfecho possível de um alarme.
--
-- É a terceira vez que o INSTRUMENTO é o errado nesta base: 17/08 (três alarmes, os três
-- instrumentos), 18/08 (`sem_cota` entregue como acervo zerado) e agora. A assinatura é
-- sempre a mesma — algo que NÃO é medição da fonte sendo comparado contra o piso da fonte.
--
-- ⚠️ E A CONSULTA ANTIGA ERRAVA NOS DOIS SENTIDOS. Ao trocá-la por esta função apareceu o
-- defeito espelhado: o CALIL, com 9 lotes contra piso 18, estava INVISÍVEL — porque a
-- última LINHA dele era `sem_cota` e a consulta olhava a última linha. Uma fonte podia se
-- esconder atrás do freio de orçamento indefinidamente. Falso positivo numa ponta, falso
-- negativo na outra, pelo mesmo motivo de fundo: ler a linha errada.
--
-- AS DUAS CORREÇÕES, portanto:
--   1. desconta a EXPIRAÇÃO LEGÍTIMA recente — lote que venceu não é lote que sumiu;
--   2. avalia a última MEDIÇÃO (status <> 'sem_cota'), não a última linha.
--
-- Verificado ao aplicar: LEILOFY sai (12 + 52 expirados ≥ 37) e CALIL entra (faltando 9).
-- Com `p_dias_expiracao => 0` o LEILOFY reaparece, o que prova que é o desconto que o
-- inocenta e não uma função que ficou cega.
-- ─────────────────────────────────────────────────────────────────────────────────────────

drop function if exists public.fonte_regressao_suspeita(integer);

create or replace function public.fonte_regressao_suspeita(p_dias_expiracao integer default 7)
returns table(
  fonte text, total integer, ativos_piso integer, ativos_mediana integer,
  status text, medido_em timestamptz, expirados_recentes bigint, faltando integer
)
language sql stable set search_path to 'public' as $$
  with base as (
    select b.fonte, b.ativos_piso, b.ativos_mediana
      from public.fonte_baseline_aprendida() b
     where b.tem_baseline
  ),
  ultima as (
    select b.fonte, b.ativos_piso, b.ativos_mediana, u.total, u.status, u.executado_em
      from base b
      join lateral (
        -- A última MEDIÇÃO, não a última LINHA. `sem_cota` é o freio de custo dizendo que
        -- nem tentou: pular essas linhas mantém a fonte sob vigia em vez de deixá-la sumir
        -- do painel enquanto a cota recusar.
        select s.total, s.status, s.executado_em from public.fonte_saude s
         where s.fonte = b.fonte
           and s.status <> 'sem_cota'
         order by s.executado_em desc limit 1
      ) u on true
  ),
  -- Lote que saiu por ENCERRAMENTO não é lote que sumiu do site. Sem este desconto, todo
  -- leiloeiro pequeno vira "regressão" no dia seguinte ao próprio leilão.
  expirados as (
    select i.fonte, count(*) as n
      from public.imoveis_leilao i
     where not i.ativo
       and i.atualizado_em > now() - (p_dias_expiracao || ' days')::interval
       and public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2)
     group by i.fonte
  )
  select u.fonte, u.total, u.ativos_piso, u.ativos_mediana, u.status, u.executado_em,
         coalesce(e.n, 0) as expirados_recentes,
         (u.ativos_piso - u.total - coalesce(e.n, 0)::int) as faltando
    from ultima u
    left join expirados e on e.fonte = u.fonte
   where u.total + coalesce(e.n, 0) < u.ativos_piso;
$$;

revoke all on function public.fonte_regressao_suspeita(integer) from public, anon;
grant execute on function public.fonte_regressao_suspeita(integer) to service_role, authenticated;
