-- SODRÉ: "COM LANCE" PELA PRÓPRIA API (24/09, print do dono: filtro de veículos vazio).
-- Os únicos carros com tipo de monta informado são da Sodré, e a Sodré fica fora da apuração por
-- página (HTML sem o resultado). Resultado: nenhum carro "sem sinistro/pequena monta" jamais tinha
-- resultado. Mas o JSON que a coleta já grava (`raw`) traz `bid_has_bid`: dos 511 lotes vencidos em
-- 15 dias, 467 já tinham lance antes do encerramento — "com lance" é certo para eles (mesma régua
-- do SUPERBID: teve_lance). Sem lance NÃO é deduzido daqui (lance de última hora existe); esse lado
-- continua com o leitor de encerrados da coleta (apurarEncerradosSodre, "não vendido").
create or replace function public.trg_veiculo_teve_lance()
returns trigger language plpgsql set search_path to 'public' as $function$
begin
  if not new.teve_lance and new.fonte = 'SUPERBID'
     and coalesce(nullif(new.raw->>'price', '')::numeric, 0) > coalesce(new.valor_minimo, 0)
     and coalesce(new.valor_minimo, 0) > 0 then
    new.teve_lance := true;
  end if;
  if not new.teve_lance and new.fonte = 'SODRE' and new.raw->>'bid_has_bid' = 'true' then
    new.teve_lance := true;
  end if;
  return new;
end $function$;

-- Backfill: marca teve_lance e, nos que JÁ encerraram sem resultado, carimba 'indeterminado'
-- (resultado apurado sem o valor final) — a busca mostra "Com lance" (teve_lance + resultado).
update public.veiculos_leilao
   set teve_lance = true,
       resultado_leilao = case when resultado_leilao is null and data_leilao < now() - interval '3 hours' then 'indeterminado' else resultado_leilao end,
       resultado_apurado_em = case when resultado_leilao is null and data_leilao < now() - interval '3 hours' then now() else resultado_apurado_em end
 where fonte = 'SODRE' and raw->>'bid_has_bid' = 'true' and not teve_lance;
