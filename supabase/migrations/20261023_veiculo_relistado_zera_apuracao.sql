-- 23/10: invariante `resultado_leilao_atrasado` (crítico) acusava 1 veículo SUPERBID (oferta 4959191, leilão
-- 20/10) com resultado nunca apurado. Causa: resultado_apuracao_tentativas = 6, gastas no leilão ANTERIOR da
-- mesma oferta (última apuração 27/09). O SUPERBID/NORDESTE republicam a oferta com data nova no mesmo id, o
-- coletor atualiza data_leilao, e a fila do apurar-resultado-leilao-cron (tentativas < 3) nunca mais pega o
-- lote. Havia 9 assim (8 com leilão ainda por vir — iam travar um a um).
-- Conserto na raiz: data do leilão muda para DEPOIS da última apuração, com resultado ainda em aberto
-- (null/indeterminado) → é outro leilão, o contador recomeça. Resultado já apurado (vendido/sem_lance) não é
-- tocado.
create or replace function public.veiculo_relistado_zera_apuracao()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.data_leilao is distinct from old.data_leilao
     and new.data_leilao is not null
     and old.resultado_apurado_em is not null
     and new.data_leilao > old.resultado_apurado_em
     and coalesce(new.resultado_leilao, 'indeterminado') = 'indeterminado' then
    new.resultado_apuracao_tentativas := 0;
    new.resultado_apurado_em := null;
    new.resultado_leilao := null;
  end if;
  return new;
end;
$function$;

create or replace trigger trg_veiculo_relistado_zera_apuracao
  before update of data_leilao on public.veiculos_leilao
  for each row execute function public.veiculo_relistado_zera_apuracao();

-- Os que já estavam presos antes do gatilho existir.
do $$
begin
  update public.veiculos_leilao
     set resultado_apuracao_tentativas = 0, resultado_apurado_em = null, resultado_leilao = null
   where ativo and resultado_apuracao_tentativas >= 3
     and coalesce(resultado_leilao, 'indeterminado') = 'indeterminado'
     and resultado_apurado_em < data_leilao;
end $$;
