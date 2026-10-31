-- 31/10: `trg_veiculo_teve_lance` lê "price > valor_minimo" na SUPERBID como lance registrado. Na
-- "Tomada de preço" (auction.modalityId = 5) `price` é o PREÇO DE VENDA, não o lance corrente — então
-- todo lote com piso abaixo do preço nascia com teve_lance = true. Medido: 16 ativos marcados, todos com
-- totalBids = 0. Efeito: depois da data, selo "Vendido" na ficha e saída imediata da vitrine (em vez dos
-- 15 dias do sem lance, que é justamente a janela da proposta). A modalidade 5 passa a ser ignorada aqui.
CREATE OR REPLACE FUNCTION public.trg_veiculo_teve_lance()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if not new.teve_lance and new.fonte = 'SUPERBID'
     and coalesce(new.raw->'auction'->>'modalityId', '') <> '5'
     and coalesce(nullif(new.raw->>'price', '')::numeric, 0) > coalesce(new.valor_minimo, 0)
     and coalesce(new.valor_minimo, 0) > 0 then
    new.teve_lance := true;
  end if;
  if not new.teve_lance and new.fonte = 'SODRE' and new.raw->>'bid_has_bid' = 'true' then
    new.teve_lance := true;
  end if;
  return new;
end $function$;

-- Limpa as 16 marcações falsas (só onde a API não registra lance nenhum).
update public.veiculos_leilao
   set teve_lance = false
 where teve_lance
   and raw->'auction'->>'modalityId' = '5'
   and coalesce((raw->>'totalBids')::int, (raw->'offerDetail'->>'totalBids')::int, 0) = 0;
