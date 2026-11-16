-- #373 (16/11): lote de VENDA ONLINE da Caixa mostrava data vencida (45 lotes, de 20/07 a 11/11).
-- Causa: o CSV da Caixa não traz data; o gatilho preservar_data_leilao devolvia a data antiga a todo
-- upsert. Só venda_direta soltava. A rodada manual do enriquecer-datas-cef (16/11 00:30) visitou 32 dos 45:
-- a página da Caixa NÃO mostra data nenhuma (sem-data 50), então a data guardada é resto de uma rodada
-- anterior, não um fato vigente. Regra: em venda_online, data JÁ VENCIDA (>2 dias) não é preservada:
-- o nulo do CSV passa e a tela diz "venda online", sem uma data passada com cara de vigente.
-- Data futura continua preservada (a página costuma trazê-la e o CSV não).
create or replace function public.preservar_data_leilao()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.data_leilao is null or btrim(new.data_leilao) = '' then
    if new.modalidade = 'venda_direta' then
      new.data_leilao := null;
      new.data_leilao_2 := null;
    elsif new.modalidade = 'venda_online'
          and old.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
          and left(old.data_leilao, 10)::date < current_date - 2
          and old.data_leilao_2 is null then
      new.data_leilao := null;
    else
      new.data_leilao := old.data_leilao;
    end if;
  end if;
  return new;
end;
$$;
