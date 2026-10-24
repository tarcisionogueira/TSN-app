-- 24/10 (bug bounty): o lote de 40 de 23/10 valia só para imóveis; o UPDATE de veiculos_leilao na
-- mesma função não tinha limite. Um lote grande de veículos vencendo junto (216 em 26/10, 410 em 02/11)
-- passa por ~15 gatilhos por linha, estoura os 8 s e desfaz a função INTEIRA (os 40 imóveis juntos) —
-- e se repete toda hora, porque a fila não anda. pg_stat_statements: max 7.998 ms (timeouts de 23/10
-- 21:37 e 22:37). Agora 40 de cada; o laço do cron (n < 40 = fim) segue certo: soma < 40 implica as
-- duas filas abaixo do lote.
create or replace function public.desativar_leiloes_encerrados()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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

  with alvo_v as (
    select id from public.veiculos_leilao
     where ativo
       and data_leilao < now()
       and ( (resultado_leilao in ('vendido', 'cancelado') or coalesce(teve_lance, false))
          or data_leilao < now() - interval '15 days'
          or (data_leilao < now() - interval '10 days'
              and not coalesce(resultado_leilao = 'sem_lance'
                               and resultado_apurado_em > now() - interval '15 days', false)) )
     limit 40
  )
  update public.veiculos_leilao v
     set ativo = false
    from alvo_v where v.id = alvo_v.id;
  get diagnostics v_v = row_count;

  return v_n + v_v;
end;
$function$;
