-- FIPE DO LEILOEIRO NÃO CARIMBA "CONSULTADO" (24/10, dono: "sempre devemos verificar a FIPE, ela corrige mês a mês").
--
-- O trigger copiava `valor_fipe_leiloeiro` para `valor_fipe` e gravava `fipe_atualizado_em = now()`. Esse
-- carimbo é o que a tela (api/_fipe-garantir.js → fipeEstaVelho) e o lote (scripts/enriquecer-fipe.mjs) usam
-- para saber quando NÓS consultamos a tabela: com ele, o valor da ficha do lote passava por FIPE conferida e
-- ninguém consultava por 25 dias. Caso do dono: Porsche Macan S (Superbid), FIPE R$ 350.295 só do leiloeiro.
-- Agora o carimbo fica com quem consulta de verdade; o valor da ficha segue como reserva (fipe_status
-- 'leiloeiro', que a tela já sinaliza) até a nossa consulta achar.
create or replace function public.veiculo_desconto_fipe()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
declare d integer;
begin
  if new.valor_fipe_leiloeiro > 0
     and (new.valor_fipe is null or coalesce(new.fipe_status, '') in ('', 'sem_match', 'sem_dados', 'leiloeiro')) then
    new.valor_fipe := new.valor_fipe_leiloeiro;
    new.fipe_status := 'leiloeiro';
  end if;
  d := null;
  if new.valor_fipe > 0 and new.valor_minimo > 0 and new.valor_minimo < new.valor_fipe then
    d := round((1 - new.valor_minimo::numeric / new.valor_fipe) * 100);
    if d <= 0 or d > 95 then d := null; end if;
  end if;
  new.desconto_fipe_percentual := d;
  return new;
end $function$;
