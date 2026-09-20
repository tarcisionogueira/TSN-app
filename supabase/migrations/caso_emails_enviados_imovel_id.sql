-- O botão "Enviar e-mail" agora também vive na tela do LOTE (ImovelDetalhe.jsx), sem um
-- caso_id (a tela do imóvel não é 1:1 com cliente — vários casos podem existir pro mesmo
-- lote). caso_id passa a ser opcional; imovel_id novo guarda o lote quando não há caso.
alter table public.caso_emails_enviados
  alter column caso_id drop not null,
  add column if not exists imovel_id text;
