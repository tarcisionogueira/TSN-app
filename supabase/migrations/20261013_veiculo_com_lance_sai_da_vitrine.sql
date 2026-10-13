-- 13/10 (dono: "se o leilão está encerrado e foi arrematado eu não consigo mandar proposta, não faz
-- sentido ficar vendo o lote"). Veículo com LANCE registrado (`teve_lance`) e resultado
-- 'indeterminado' (lance abaixo da reserva, aguardando o comitente) caía na retenção de 15 dias do
-- SEM LANCE — e a apuração diária renovava `resultado_apurado_em`, então ficava para sempre: 2.036
-- ativos, o mais velho de 16/09. Regra nova: leilão passado + (vendido | cancelado | teve lance) =
-- sai da vitrine na próxima varredura. Sem lance segue 15 dias (é onde cabe a proposta de compra).
-- E os 15 dias do sem lance passam a contar da DATA DO LEILÃO: contavam de `resultado_apurado_em`,
-- que a apuração diária renova — 51 veículos e 27 imóveis passavam dos 15 dias (um imóvel de 09/07).
CREATE OR REPLACE FUNCTION public.desativar_leiloes_encerrados()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_n integer; v_v integer;
begin
  update public.imoveis_leilao
     set ativo = false, suprimido_motivo = 'praca_vencida'
   where ativo
     and public.leilao_ja_encerrado(data_leilao, data_leilao_2, data_fim, modalidade)
     and ( not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                        and resultado_apurado_em > now() - interval '15 days', false)
        or greatest(data_leilao_2::date, data_fim,
                    case when data_leilao ~ '^\d{4}-\d{2}-\d{2}' then left(data_leilao, 10)::date end)
           < current_date - 15 );
  get diagnostics v_n = row_count;

  update public.veiculos_leilao
     set ativo = false
   where ativo
     and data_leilao is not null
     and ( (data_leilao < now() and (resultado_leilao in ('vendido', 'cancelado') or coalesce(teve_lance, false)))
        or data_leilao < now() - interval '15 days'
        or (data_leilao < now() - interval '10 days'
            and not coalesce(resultado_leilao in ('sem_lance', 'indeterminado')
                             and resultado_apurado_em > now() - interval '15 days', false)) );
  get diagnostics v_v = row_count;

  return v_n + v_v;
end;
$function$;
