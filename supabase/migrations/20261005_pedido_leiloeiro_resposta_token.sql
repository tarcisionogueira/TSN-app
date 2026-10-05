-- 05/10 (pedido do dono): a resposta do leiloeiro ao pedido de documento ia só para o e-mail de quem
-- pediu — a matrícula que ele mandasse nunca chegava ao lote. O pedido passa a sair com reply-to
-- `documentos+<token>@` (além do e-mail de quem pediu); o inbound casa a resposta pelo token e grava
-- os anexos em imovel_anexos — disponíveis para todos que analisarem o lote.
alter table public.documental_pedidos_leiloeiro
  add column if not exists resposta_token text,
  add column if not exists respondido_em timestamptz,
  add column if not exists anexos_recebidos int not null default 0;
create unique index if not exists documental_pedidos_leiloeiro_resposta_token
  on public.documental_pedidos_leiloeiro (resposta_token) where resposta_token is not null;
