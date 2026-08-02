-- Pipeline de casos: dar um FIM ao fluxo e fazer os carimbos de transição existirem de verdade.
--
-- ORIGEM: `supabase/schema_fluxo_analise.sql` criou a tabela `casos` com duas coisas —
-- `status_etapa` (onde o caso ESTÁ) e um bloco "Timestamps das transições de etapa"
-- (`iniciado_em`, `juridico_enviado_em`, `arrematado_em`, `concluido_em`, isto é, QUANDO cada
-- passo aconteceu). Só a primeira metade foi implementada: nenhum código escreve os carimbos
-- (`grep` = 0 escritas para os quatro), e o CHECK de `status_etapa` termina em
-- 'pos_arrematacao' = "acompanhamento em andamento" — ou seja, **a máquina de estados nunca
-- teve um estado final**.
--
-- CONSEQUÊNCIA (medida em 02/08, 6 casos): `etapaDoCaso` (Admin.jsx) decide a coluna
-- "Concluído" APENAS por `concluido_em`, que ninguém preenche → nenhum caso jamais sai do
-- quadro. Todo caso encerrado continua ocupando "Arremate em andamento", o relógio "parado Xd"
-- segue contando sobre trabalho já entregue (a métrica que o dono usa para cobrar prazo perde o
-- sinal no meio do ruído), o WIP real da equipe fica desconhecido e não existe tempo de ciclo
-- (quanto demora da análise à entrega). Com 6 casos isso é cosmético; é o tipo de dívida que
-- só machuca quando o volume chega.
--
-- Junto veio outro achado: `casos.updated_at` NUNCA se move depois do insert (nos 6 casos
-- `updated_at = iniciado_em`) — não há trigger e os `update` do app não tocam a coluna. Como o
-- relógio do Pipeline usa `max(job mais recente, casos.updated_at)`, para caso SEM job o
-- "parado Xd" mede idade desde a CRIAÇÃO, não desde a última atividade.
--
-- CORREÇÃO (na raiz, no banco — vale para o app, para a API e para qualquer fluxo futuro):
--   1. `status_etapa` ganha o estado final 'concluido';
--   2. uma trigger carimba as transições e mantém `updated_at` vivo.
-- Concluir é decisão HUMANA da equipe (não dá para inferir: "pos_arrematacao" é acompanhamento
-- em andamento, não fim) — por isso o app ganha a ação; o banco só garante o carimbo correto.

alter table public.casos drop constraint if exists casos_status_etapa_check;
alter table public.casos add constraint casos_status_etapa_check
  check (status_etapa = any (array[
    'analise_solicitada','analises_prontas','reuniao_agendada','reuniao_realizada',
    'juridico_solicitado','juridico_concluido','segunda_reuniao','arrematado',
    'honorarios_pagos','procuracao_assinada','pos_arrematacao',
    'concluido'  -- NOVO: estado final do caso (equipe declara a entrega)
  ]));

create or replace function public.casos_carimbar_transicoes()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  -- Toda alteração move o relógio: é o que o "parado Xd" do Pipeline lê quando o caso ainda
  -- não tem job. Sem isto, `updated_at` ficava congelado na criação.
  new.updated_at := now();

  if new.status_etapa is distinct from old.status_etapa then
    -- Carimbos de PRIMEIRA passagem (não sobrescreve: interessa quando ACONTECEU).
    if new.status_etapa = 'juridico_solicitado' and new.juridico_enviado_em is null then
      new.juridico_enviado_em := now();
    end if;
    if new.status_etapa in ('arrematado','honorarios_pagos','procuracao_assinada','pos_arrematacao')
       and new.arrematado_em is null then
      new.arrematado_em := now();
    end if;
    -- Conclusão e REABERTURA: sair de 'concluido' limpa o carimbo, senão o caso reaberto
    -- continuaria na coluna "Concluído" (etapaDoCaso testa concluido_em primeiro).
    if new.status_etapa = 'concluido' then
      if new.concluido_em is null then new.concluido_em := now(); end if;
    elsif old.status_etapa = 'concluido' then
      new.concluido_em := null;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_casos_carimbar_transicoes on public.casos;
create trigger trg_casos_carimbar_transicoes
  before update on public.casos
  for each row execute function public.casos_carimbar_transicoes();

comment on function public.casos_carimbar_transicoes() is
  'Mantém casos.updated_at vivo e carimba as transições de etapa (juridico_enviado_em, arrematado_em, concluido_em). concluido_em é limpo na reabertura. Criado em 02/08 — os carimbos existiam no schema desde o início e nenhum código os escrevia.';
