-- Pedido de documento ao leiloeiro disparado pela geração do documental (sem matrícula/edital),
-- em nome da equipe — distingue do pedido manual da equipe (api/pedir-documento-leiloeiro.js).
alter table public.documental_pedidos_leiloeiro
  add column if not exists automatico boolean not null default false;
create index if not exists documental_pedidos_leiloeiro_imovel_criado
  on public.documental_pedidos_leiloeiro (imovel_id, criado_em desc);
