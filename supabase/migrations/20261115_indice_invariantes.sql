-- 15/11 — INVARIANTES DO ÍNDICE (arena #484, item 4). Medidos em seco antes de fixar a regra.
--
create index if not exists idx_imoveis_leilao_valor_avaliacao on public.imoveis_leilao (valor_avaliacao);

-- `indice_suspeitas()` lista as amostras que não deveriam sustentar número, com o motivo:
--   parece_leilao      — área E valor (não redondo) idênticos a um lote de leilão (avaliação ou mínimo). Achado de 15/11:
--                        o "94.815" da #444 é preço de venda CEF gravado como anúncio do Wimoveis/Imovelweb (11 amostras).
--   mesma_unidade_2cid — mesmo valor (não redondo) E mesma área em cidades diferentes: cópia entre cidades, não anúncio.
--                        Valor "redondo" fica de fora — inclusive o que só PARECE não redondo: R$ 200.000 / 42 m² = 4.762/m²,
--                        × 42 = 200.004 (vale a distância ao milhar ≤ área). Sem isso, 34 de 34 eram esse artefato; com isso, 0.
--   redirecionador     — link vertexaisearch (expira; não é o anúncio). A gravação já resolve o destino desde 15/11.
-- Limpeza das suspeitas fica com o dono (o comando está no HANDOFF de 15/11).
create or replace function public.indice_suspeitas()
returns table(id uuid, motivo text, cidade_norm text, valor_total numeric, area_m2 numeric, url text)
language sql stable set search_path = public as $$
  -- Lateral com LIMIT 1: o planejador usa os índices de valor (hash join varria os 118 mil lotes: 3 s → 0,6 s).
  select a.id, 'parece_leilao', a.cidade_norm, a.valor_total, a.area_m2, a.url
    from indice_amostra a
   cross join lateral (
     (select 1 from imoveis_leilao i where i.valor_minimo >= round(a.valor_total) - 0.5 and i.valor_minimo < round(a.valor_total) + 0.5
         and round(i.area_m2) = round(a.area_m2) limit 1)
     union all
     (select 1 from imoveis_leilao i where i.valor_avaliacao >= round(a.valor_total) - 0.5 and i.valor_avaliacao < round(a.valor_total) + 0.5
         and round(i.area_m2) = round(a.area_m2) limit 1)
     limit 1) m
   where a.especie = 'venda' and a.area_m2 > 0 and a.valor_total >= 50000 and abs(a.valor_total - round(a.valor_total, -3)) > a.area_m2
  union
  select a.id, 'mesma_unidade_2cid', a.cidade_norm, a.valor_total, a.area_m2, a.url
    from indice_amostra a
    join (select round(valor_total) v, round(area_m2) ar from indice_amostra
           where especie = 'venda' and valor_total >= 50000 and area_m2 > 0 and abs(valor_total - round(valor_total, -3)) > area_m2
           group by 1, 2 having count(distinct cidade_norm) >= 2) g
      on g.v = round(a.valor_total) and g.ar = round(a.area_m2)
   where a.especie = 'venda'
  union
  select a.id, 'redirecionador', a.cidade_norm, a.valor_total, a.area_m2, a.url
    from indice_amostra a where a.url ~* 'vertexaisearch|grounding-api-redirect'
$$;
revoke all on function public.indice_suspeitas() from public, anon, authenticated;
grant execute on function public.indice_suspeitas() to service_role;

-- Conferência ao vivo parada: há link de anúncio próprio nunca conferido e a última conferência tem mais de 3 h
-- (o cron roda de hora em hora). 1 = parada, 0 = rodando ou nada a conferir.
create or replace function public.indice_prova_parada()
returns integer language sql stable set search_path = public as $$
  select case when exists (select 1 from indice_amostra_indep v
                            where v.prova = 'link_proprio' and v.url ~ '^https://'
                              and not exists (select 1 from indice_link_prova p where p.url_hash = md5(v.url)))
               and coalesce((select max(verificado_em) from indice_link_prova), '-infinity') < now() - interval '3 hours'
         then 1 else 0 end
$$;
revoke all on function public.indice_prova_parada() from public, anon, authenticated;
grant execute on function public.indice_prova_parada() to service_role;

-- Liga os dois em qa_invariantes() (função de 38 KB: troca textual só no fim da lista, idempotente).
do $mig$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
        ancora text := '(select coalesce(sum(v.valor), 0) from public.leiloeiro_vaza_para_anon() v), 0)';
begin
  if position('indice_amostra_suspeita' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'âncora de qa_invariantes não encontrada — revisar a migração'; end if;
  d := replace(d, ancora, ancora || $add$,
     ('indice_amostra_suspeita','Índice: amostra que não deveria sustentar número — preço de leilão como anúncio, mesmo valor+área em cidades diferentes (#444) ou link redirecionador (detalhe e motivo: select * from indice_suspeitas(); limpeza fica com o dono)','Índice','bug',
       (select count(*) from public.indice_suspeitas()), 0),
     ('indice_prova_parada','Índice: conferência ao vivo dos links parada há 3h+ com link pendente (cron indice-prova-cron)','Índice','gap',
       public.indice_prova_parada()::bigint, 0)$add$);
  execute d;
end $mig$;
