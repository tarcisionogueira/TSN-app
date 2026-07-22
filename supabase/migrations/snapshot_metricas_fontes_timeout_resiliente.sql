-- O snapshot diário alimenta fonte_metricas_hist, base do APRENDIZADO do bug bounty
-- dos leiloeiros. Ele chama fonte_cobertura() (~5,8s, jsonb_path_exists por linha em
-- 32k+ imóveis) + fonte_qualidade() (~1,3s). Sob a carga de escrita da coleta (15h UTC)
-- o total passava do statement_timeout padrão da RPC (~8s) e o snapshot era CANCELADO
-- ("canceling statement due to statement timeout"), abrindo buraco no histórico/baseline.
-- Fix resiliente: dá ao snapshot um teto de tempo próprio (60s), suficiente com folga.
-- (Perf de fonte_cobertura fica como follow-up de escala — reescrevê-la mudaria números
--  de vários painéis; aqui só blindamos o job de fundo.)
CREATE OR REPLACE FUNCTION public.snapshot_metricas_fontes()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
 SET statement_timeout TO '60s'
AS $function$
declare n integer;
begin
  insert into public.fonte_metricas_hist as h
    (fonte, dia, ativos, foto, valor, area, data, matricula, edital, avaliacao, imovel_pct, ed_eq_matr, matr_eq_lote)
  select c.fonte, (now() at time zone 'utc')::date, c.ativos, c.foto, c.valor, c.area, c.data,
         c.matricula, c.edital, c.avaliacao, q.imovel_pct, q.ed_eq_matr, q.matr_eq_lote
  from public.fonte_cobertura() c
  left join public.fonte_qualidade() q on q.fonte = c.fonte
  on conflict (fonte, dia) do update set
    ativos=excluded.ativos, foto=excluded.foto, valor=excluded.valor, area=excluded.area,
    data=excluded.data, matricula=excluded.matricula, edital=excluded.edital,
    avaliacao=excluded.avaliacao, imovel_pct=excluded.imovel_pct,
    ed_eq_matr=excluded.ed_eq_matr, matr_eq_lote=excluded.matr_eq_lote;
  get diagnostics n = row_count;
  return n;
end $function$;
