-- LINK DE COMPARTILHAMENTO DO VEÍCULO (05/10, pedido do dono)
-- A tela do veículo é exclusiva da equipe; quem recebe o link vê a MESMA tela em modo leitura
-- (/#/v/<token>), sem "Solicitar análise" e sem caminho para o leiloeiro. O token é a única
-- credencial: aleatório (24 bytes), com validade. Só o servidor (service key) lê/escreve —
-- RLS ligada SEM política = fechada para anon/authenticated.
create table if not exists public.veiculo_compartilhamento (
  token text primary key check (length(token) >= 24),
  veiculo_id uuid not null references public.veiculos_leilao(id) on delete cascade,
  criado_por uuid not null,
  criado_em timestamptz not null default now(),
  expira_em timestamptz not null default now() + interval '30 days',
  acessos int not null default 0,
  ultimo_acesso_em timestamptz
);
create index if not exists veiculo_compartilhamento_veiculo_idx on public.veiculo_compartilhamento (veiculo_id, expira_em desc);
alter table public.veiculo_compartilhamento enable row level security;
