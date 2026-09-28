-- 28/09 (invariante venda_direta_com_praca: 9 → 22). O gatilho preservava a data antiga SEMPRE
-- que o coletor mandava data vazia — proteção contra coleta parcial. Mas quando o lote VIRA venda
-- direta (praças sem licitante → oferta direta, caso dos 7 WEBLEILOES: /oferta/venda-direta/, datas
-- 31/08 e 23/09 da praça que já passou), a data vazia É a informação certa: regra do dono, "venda
-- direta é compra imediata, sem prazo — praça e venda_direta são mutuamente exclusivos".
-- Mínimo de propósito: NÃO força data nula quando o coletor MANDA uma data com venda_direta — esse
-- é o caso de classificação errada, e o invariante precisa continuar enxergando.
create or replace function public.preservar_data_leilao()
 returns trigger language plpgsql set search_path to 'public', 'pg_temp' as $function$
begin
  if new.data_leilao is null or btrim(new.data_leilao) = '' then
    if new.modalidade = 'venda_direta' then
      -- virou venda direta: a praça antiga não vale mais (nem a 2ª)
      new.data_leilao := null;
      new.data_leilao_2 := null;
    else
      new.data_leilao := old.data_leilao;
    end if;
  end if;
  return new;
end;
$function$;
