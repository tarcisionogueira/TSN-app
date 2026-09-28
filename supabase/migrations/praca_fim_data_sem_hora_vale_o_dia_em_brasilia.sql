-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FIM DE PRAÇA SEM HORA = O DIA INTEIRO EM BRASÍLIA — 28/09/2026
--
-- Invariante praca_fim_antes_do_inicio (zuk_37430-234156): o extrator de datas do documento
-- (api/_doc-datas.js → enriquecer-lote.js / gerar-analise.js) lê "encerra em 14/10/2026" como
-- '2026-10-14', e gravado em timestamptz isso vira 14/10 00:00 UTC = 13/10 21h em Brasília —
-- ANTES da praça abrir (14/10 10h30). Meia-noite UTC exata é a assinatura da data sem hora
-- (5 de 27 lotes com fim de praça). Normaliza no banco para valer para os dois caminhos que
-- gravam e para qualquer um futuro: o dia D inteiro, até 23:59:59 de Brasília.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.praca_fim_sem_hora_brt()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.praca1_fim is not null and (new.praca1_fim at time zone 'UTC')::time = '00:00'
     and (tg_op = 'INSERT' or new.praca1_fim is distinct from old.praca1_fim) then
    new.praca1_fim := (((new.praca1_fim at time zone 'UTC')::date + time '23:59:59') at time zone 'America/Sao_Paulo');
  end if;
  if new.praca2_fim is not null and (new.praca2_fim at time zone 'UTC')::time = '00:00'
     and (tg_op = 'INSERT' or new.praca2_fim is distinct from old.praca2_fim) then
    new.praca2_fim := (((new.praca2_fim at time zone 'UTC')::date + time '23:59:59') at time zone 'America/Sao_Paulo');
  end if;
  return new;
end $$;

drop trigger if exists trg_praca_fim_sem_hora_brt on public.imoveis_leilao;
create trigger trg_praca_fim_sem_hora_brt before insert or update of praca1_fim, praca2_fim on public.imoveis_leilao
  for each row execute function public.praca_fim_sem_hora_brt();

update public.imoveis_leilao set
  praca1_fim = case when (praca1_fim at time zone 'UTC')::time = '00:00' then (((praca1_fim at time zone 'UTC')::date + time '23:59:59') at time zone 'America/Sao_Paulo') else praca1_fim end,
  praca2_fim = case when (praca2_fim at time zone 'UTC')::time = '00:00' then (((praca2_fim at time zone 'UTC')::date + time '23:59:59') at time zone 'America/Sao_Paulo') else praca2_fim end
 where ativo and ((praca1_fim at time zone 'UTC')::time = '00:00' or (praca2_fim at time zone 'UTC')::time = '00:00');
