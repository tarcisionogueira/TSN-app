-- 23/10 (#222): desativar_leiloes_encerrados() estourava o statement_timeout (8 s) em 17 de 24 rodadas horárias
-- de 22/10 (postgres_logs). Lote de 150 × ~28 ms/linha (35 gatilhos em imoveis_leilao) = ~4 s sem carga, acima de
-- 8 s com a coleta rodando; o UPDATE inteiro era desfeito e a fila crescia (196 vencidos esperando em 23/10).
-- Lote de 40 (~1,1 s) — o api/desativar-encerrados-cron.js chama de novo enquanto vier lote cheio (até 6×/hora).
-- O resto do corpo é o vigente (retem_sem_lance_15_dias), sem mudança.
CREATE OR REPLACE FUNCTION public.desativar_leiloes_encerrados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer; v_v integer;
begin
  with alvo as (
    select id from public.imoveis_leilao
     where ativo
       and coalesce(modalidade, '') !~* 'venda[_ -]?(direta|online)'
       and (data_leilao is not null or data_leilao_2 is not null or data_fim is not null)
       and (data_leilao is null or left(data_leilao, 10) <= to_char(now() at time zone 'America/Sao_Paulo', 'YYYY-MM-DD'))
       and (data_leilao_2 is null or data_leilao_2 < now())
       and (data_fim is null or data_fim <= current_date)
       and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
       and ( not coalesce(resultado_leilao = 'sem_lance'
                          and resultado_apurado_em > now() - interval '15 days', false)
          or greatest(data_leilao_2::date, data_fim,
                      case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then left(data_leilao, 10)::date end)
             < current_date - 15 )
     limit 40
  )
  update public.imoveis_leilao i
     set ativo = false, suprimido_motivo = 'praca_vencida'
    from alvo where i.id = alvo.id;
  get diagnostics v_n = row_count;

  update public.veiculos_leilao
     set ativo = false
   where ativo
     and data_leilao < now()
     and ( (data_leilao < now() and (resultado_leilao in ('vendido', 'cancelado') or coalesce(teve_lance, false)))
        or data_leilao < now() - interval '15 days'
        or (data_leilao < now() - interval '10 days'
            and not coalesce(resultado_leilao = 'sem_lance'
                             and resultado_apurado_em > now() - interval '15 days', false)) );
  get diagnostics v_v = row_count;

  return v_n + v_v;
end;
$function$;
