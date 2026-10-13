-- 13/10 (noite): desativar_leiloes_encerrados() seguia estourando o statement timeout de 8 s mesmo
-- depois de separada das regras de relistado (14:05 UTC). Medido: só a condição já custa 1,9 s para
-- ZERO linhas — leilao_ja_encerrado() tem SET search_path, não é inlinada e roda linha a linha nos
-- 28.751 ativos; com muitos lotes vencendo juntos, os gatilhos do UPDATE somam e passam do teto.
-- (1) PRÉ-FILTRO barato e NECESSÁRIO (nenhuma data do lote no futuro e pelo menos uma data): 1.295
--     candidatos em vez de 28.751. Toda data_leilao é ISO (0 fora do padrão em 13/10), então a
--     comparação de texto do dia é exata. A função continua decidindo — o filtro só poupa chamadas.
-- (2) TETO de 500 imóveis por chamada: o que sobrar sai na próxima hora, em vez de a chamada inteira
--     ser cancelada e não desligar nada.
-- Corpo vivo preservado: retenção sem_lance limitada a 15 dias após a última praça e a regra de
-- veículo com lance (20261013_veiculo_com_lance_sai_da_vitrine.sql).
-- (3) VEÍCULOS: 2,5 s para achar 19 linhas, lendo o heap dos 12 mil ativos. Todo ramo da regra exige
--     data_leilao < now() — índice parcial por data nos ativos.
create index if not exists veiculos_leilao_ativo_data_idx on public.veiculos_leilao (data_leilao) where ativo;

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
       and ( not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                          and resultado_apurado_em > now() - interval '15 days', false)
          or greatest(data_leilao_2::date, data_fim,
                      case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then left(data_leilao, 10)::date end)
             < current_date - 15 )
     limit 500
  )
  update public.imoveis_leilao i
     set ativo = false, suprimido_motivo = 'praca_vencida'
    from alvo where i.id = alvo.id;
  get diagnostics v_n = row_count;

  update public.veiculos_leilao
     set ativo = false
   where ativo
     and data_leilao < now()   -- todo ramo abaixo exige isto: deixa o índice parcial trabalhar
     and ( (data_leilao < now() and (resultado_leilao in ('vendido', 'cancelado') or coalesce(teve_lance, false)))
        or data_leilao < now() - interval '15 days'
        or (data_leilao < now() - interval '10 days'
            and not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                             and resultado_apurado_em > now() - interval '15 days', false)) );
  get diagnostics v_v = row_count;

  return v_n + v_v;
end;
$function$;
