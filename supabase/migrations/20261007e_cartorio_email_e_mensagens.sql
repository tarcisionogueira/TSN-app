-- FALAR COM O CARTÓRIO PELO SISTEMA (07/10, pedido do dono: "solicitar um oficial para ir a um
-- imóvel, etc."). Hoje a conversa com o cartório acontece no e-mail pessoal da equipe e não deixa
-- rastro no serviço: quem pega o caso depois não sabe o que já foi pedido, nem quando.
--
-- Guardar a mensagem é o ponto. Um "enviei" que não grava nada é a mesma classe de defeito que
-- este projeto já pagou caro (a reunião marcada por e-mail com o banco sem registro, 12/08): a
-- tela afirma um fato que ninguém consegue conferir depois. Aqui a linha é gravada SEMPRE —
-- inclusive quando o envio falha, com o motivo —, então "mandei e não responderam" e "achei que
-- tinha mandado" param de ser a mesma coisa.
alter table public.servicos_cartorio add column if not exists cartorio_email text;

create table if not exists public.servicos_cartorio_mensagens (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos_cartorio(id) on delete cascade,
  para text not null,
  assunto text not null,
  corpo text not null,
  enviado boolean not null default false,
  erro text,
  autor_id uuid references auth.users(id),
  criado_em timestamptz not null default now()
);
create index if not exists servicos_cartorio_mensagens_servico_idx
  on public.servicos_cartorio_mensagens(servico_id, criado_em desc);

-- Mesma postura das outras três tabelas do módulo: tudo passa pela API (service key, com
-- checagem de papel). Sem policy = ninguém lê direto do cliente.
alter table public.servicos_cartorio_mensagens enable row level security;
