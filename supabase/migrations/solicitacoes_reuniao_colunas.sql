-- Agendamento de reunião: as colunas que o código de 10/08 (commit e41fc0c) já escrevia e que
-- nunca existiram. Sem elas o UPDATE do Admin dava 400 e, como o `error` não era checado, NADA
-- era gravado — nem checklist, nem notas, nem o link, nem o status — enquanto a sala Daily.co
-- era criada e o e-mail "sua reunião está marcada" saía para o cliente.
-- Aplicada em produção em 12/08.
alter table public.solicitacoes
  add column if not exists reuniao_em           timestamptz,
  add column if not exists reuniao_duracao_min  integer default 30;

comment on column public.solicitacoes.reuniao_em is
  'Início da reunião agendada com o analista. Lido pelo card "Próximas Reuniões" do Painel do cliente.';
comment on column public.solicitacoes.reuniao_duracao_min is
  'Duração em minutos; usada para montar o fim do evento no Google Agenda e a sala Daily.co.';

-- O Painel do cliente filtra por (user_id, reuniao_em >= now()) com google_meet_link não nulo.
create index if not exists idx_solicitacoes_reuniao_em
  on public.solicitacoes (user_id, reuniao_em)
  where reuniao_em is not null;
