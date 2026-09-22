-- 22/09, mesmo achado de desativar_leiloes_encerrados_retem_sem_lance_15_dias.sql: existe um
-- SEGUNDO ponto de imposição da mesma regra — este trigger, que roda em TODA escrita da
-- tabela (BEFORE INSERT OR UPDATE), não só na varredura horária. Sem esta MESMA exceção
-- aqui, o trigger desfazia a retenção de 15 dias na hora — inclusive a PRÓPRIA escrita do
-- cron de apuração (que grava resultado_leilao no mesmo UPDATE que este trigger intercepta).
create or replace function public.trg_desativa_leilao_encerrado()
 returns trigger
 language plpgsql
 set search_path to 'public', 'extensions', 'pg_temp'
as $function$
begin
  if new.ativo and public.leilao_ja_encerrado(new.data_leilao, new.data_leilao_2, new.data_fim, new.modalidade)
     and not (new.resultado_leilao in ('sem_lance', 'indeterminado') and new.resultado_apurado_em > now() - interval '15 days')
  then
    new.ativo := false;
  end if;
  return new;
end;
$function$;
