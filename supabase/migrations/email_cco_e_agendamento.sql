-- CCO E AGENDAR ENVIO NA CAIXA DE E-MAIL (23/11, pedido do dono — ideias do Gmail que tinham ficado de fora).
--
-- Cco: o envio passa `bcc` ao Resend (api/_email.js) e o registro em Enviados guarda quem foi em cópia
-- oculta (`email_caixa.cco`) — só a equipe vê; o destinatário não.
--
-- Agendar: o e-mail agendado é um RASCUNHO com hora marcada (`email_rascunhos.agendado_para`). O cron
-- api/email-agendados-cron.js (a cada 5 min) pega os vencidos e envia pela MESMA função do botão Enviar
-- (api/_caixa-envio.js → enviarDaCaixa): orçamento diário, supressão, fio do chamado e registro em Enviados
-- valem na hora do ENVIO, não na hora de agendar. Enviou → o rascunho é apagado (como no envio na hora).
-- Falhou → `agendamento_status = 'falhou'` com o motivo, à vista na pasta Agendados.
--
-- Estados: 'agendado' (esperando) → 'enviando' (o cron reivindicou, atômico por linha) → apagado (saiu)
-- ou 'falhou'. 'enviando' parado há mais de 15 min vira 'falhou' com aviso para conferir Enviados
-- antes de reenviar (o cron pode ter caído DEPOIS de o e-mail sair).

alter table public.email_caixa add column if not exists cco text[];
comment on column public.email_caixa.cco is 'Cópia oculta (Cco) do e-mail ENVIADO pela equipe — o destinatário não vê.';

alter table public.email_rascunhos
  add column if not exists cco text,
  add column if not exists citar boolean not null default false,
  add column if not exists caso_id uuid,
  add column if not exists chave_envio text,
  add column if not exists agendado_para timestamptz,
  add column if not exists agendamento_status text,
  add column if not exists agendamento_erro text,
  add column if not exists agendamento_tentativas integer not null default 0;

do $$ begin
  alter table public.email_rascunhos add constraint email_rascunhos_agendamento_status_ck
    check (agendamento_status is null or agendamento_status in ('agendado', 'enviando', 'falhou'));
exception when duplicate_object then null; end $$;

create index if not exists email_rascunhos_agendado_idx
  on public.email_rascunhos (agendado_para) where agendamento_status = 'agendado';

comment on column public.email_rascunhos.agendado_para is
  'Hora marcada para o envio (UTC). Nulo = rascunho comum. Quem envia é api/email-agendados-cron.js.';
