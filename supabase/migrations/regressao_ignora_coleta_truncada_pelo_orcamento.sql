-- COLETA CORTADA PELO ORÇAMENTO NÃO É MEDIÇÃO DA FONTE (27/08).
--
-- `fonte_regressao_suspeita()` já pulava o `sem_cota` — a coleta que NÃO FOI TENTADA. Faltava
-- o caso do meio: a coleta que começou, andou e o teto do Bright Data cortou no lote 9 de 40.
-- Esse run gravava `status = 'ok'` com um total que não mede o acervo do leiloeiro, e sim até
-- onde o dinheiro deu — e era comparado contra o piso aprendido como se fosse regressão.
--
-- Foi o que aconteceu com o CALIL: em 26/08 o site listou 75 lotes, a coleta gravou 9 com
-- TODOS os campos 100% completos (uf, valor, link, foto), e a função acusou "9 contra piso 18".
-- Parser intacto; o que faltava era cota. É a quarta vez nesta base que o instrumento é o
-- errado, e a assinatura é sempre a mesma: algo que NÃO é medição da fonte comparado contra o
-- piso da fonte.
--
-- O scraper passa a gravar `parcial_cota` nesses runs (ver `_saude-fonte.mjs`). Aqui só
-- ensinamos a função a tratá-lo como o irmão que já era tratado. Efeito colateral bem-vindo:
-- `fonte_baseline_aprendida()` filtra por `status = 'ok'`, então esses runs também param de
-- ENSINAR o piso para baixo — a mediana do CALIL caiu de ~40 para 36 alimentada por eles.
create or replace function public.fonte_regressao_suspeita(p_dias_expiracao integer default 7)
returns table(fonte text, total integer, ativos_piso integer, ativos_mediana integer,
              status text, medido_em timestamp with time zone,
              expirados_recentes bigint, faltando integer)
language sql
stable
set search_path to 'public'
as $function$
  with base as (
    select b.fonte, b.ativos_piso, b.ativos_mediana
      from public.fonte_baseline_aprendida() b
     where b.tem_baseline
  ),
  ultima as (
    select b.fonte, b.ativos_piso, b.ativos_mediana, u.total, u.status, u.executado_em
      from base b
      join lateral (
        select s.total, s.status, s.executado_em from public.fonte_saude s
         where s.fonte = b.fonte
           -- Os dois são decisão de ORÇAMENTO, não leitura do acervo: 'sem_cota' não tentou,
           -- 'parcial_cota' tentou e foi interrompido. Nenhum dos dois mede a fonte.
           and s.status not in ('sem_cota', 'parcial_cota')
         order by s.executado_em desc limit 1
      ) u on true
  ),
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
$function$;
