-- Perfil de PUBLICAÇÃO de cada fonte (17/11, pedido do dono: "deve haver um padrão entre abertura e fechamento dos
-- leilões que pode ser mapeado e otimizar nosso fluxo"). Custo zero: lê só o rastro do banco.
--
-- Por fonte, na janela p_dias:
--   antecedência  = data da 1ª praça − dia em que VIMOS o lote (criado_em). É "quanto tempo o cliente tem".
--                   Ressalva (forma nº 10): criado_em é quando NÓS vimos, não quando o leiloeiro publicou — em fonte
--                   coletada 1×/semana a antecedência real é até 7 dias MAIOR. Por isso a função também devolve a
--                   cadência de coleta (dias_coleta), para quem ler saber o tamanho dessa distorção.
--   intervalo 2ª  = 2ª praça − 1ª praça (moda) e % de lotes com 2ª praça.
--   ritmo         = em quantos dias de coleta apareceu lote novo, e quanto o maior dia concentra do total.
-- Exclui os 10 primeiros dias de cada fonte (a integração conta o estoque inteiro como "novo" num dia só).
--
-- Classes (régua inicial, ajuste aqui e no comentário):
--   antecedencia: curta (p10 ≤ 3 dias) · media (p10 ≤ 10) · longa (p10 > 10)
--   ritmo:        continuo (lote novo em ≥ 70% dos dias de coleta) · em_lote (maior dia ≥ 40% dos novos) · irregular
--   coleta_sugerida_h: curta → 12 · media → 24 · longa → 72 (em_lote longa: 72 + sentinela do catálogo, pendência 501)
create or replace function public.fonte_perfil_publicacao(p_dias integer default 90)
returns table (
  fonte text, lotes bigint, antec_mediana numeric, antec_p10 numeric, intervalo_2a_moda integer, pct_com_2a integer,
  dias_coleta bigint, dias_com_novo bigint, pct_dias_com_novo integer, pct_maior_dia integer,
  classe_antecedencia text, ritmo text, coleta_sugerida_h integer
)
language sql
stable
set search_path = public
as $$
  with ini as (
    select i.fonte, min(i.criado_em) ini from public.imoveis_leilao i group by 1
  ), b as (
    select i.fonte, i.criado_em::date pub, left(i.data_leilao, 10)::date d1, i.data_leilao_2::date d2
      from public.imoveis_leilao i join ini using (fonte)
     where i.criado_em > now() - make_interval(days => p_dias)
       and i.criado_em > ini.ini + interval '10 days'
       and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
  ), antec as (
    select b.fonte, count(*) lotes,
      percentile_cont(0.5) within group (order by d1 - pub) filter (where d1 >= pub) med,
      percentile_cont(0.1) within group (order by d1 - pub) filter (where d1 >= pub) p10,
      mode() within group (order by d2 - d1) filter (where d2 > d1) moda2,
      round(100.0 * count(*) filter (where d2 > d1) / count(*))::int pct2
    from b group by 1
  ), novos as (
    select b.fonte, b.pub, count(*) n from b group by 1, 2
  ), ritmo as (
    select n.fonte, count(*) dias_novo, round(100.0 * max(n.n) / sum(n.n))::int pct_maior from novos n group by 1
  ), col as (
    select s.fonte, count(distinct s.executado_em::date) dias
      from public.fonte_saude s
     where s.executado_em > now() - make_interval(days => p_dias) and s.status <> 'sem_cota'
     group by 1
  )
  select a.fonte, a.lotes, round(a.med::numeric, 1), round(a.p10::numeric, 1), a.moda2, a.pct2,
         coalesce(c.dias, 0), r.dias_novo,
         case when c.dias > 0 then least(100, round(100.0 * r.dias_novo / c.dias))::int end,
         r.pct_maior,
         case when a.p10 is null then null when a.p10 <= 3 then 'curta' when a.p10 <= 10 then 'media' else 'longa' end,
         case when c.dias > 0 and r.dias_novo >= 0.7 * c.dias then 'continuo'
              when r.pct_maior >= 40 then 'em_lote' else 'irregular' end,
         case when a.p10 is null then 24 when a.p10 <= 3 then 12 when a.p10 <= 10 then 24 else 72 end
    from antec a join ritmo r using (fonte) left join col c using (fonte)
   where a.lotes >= 20
   order by a.lotes desc;
$$;
