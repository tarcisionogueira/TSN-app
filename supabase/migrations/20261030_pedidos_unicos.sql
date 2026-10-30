-- pedidos_unicos — cada comando que a tela manda (POST/PUT/PATCH/DELETE via apiCall) leva um
-- `x-pedido-id` sorteado na hora; as rotas que enviam, cobram ou gastam anotam esse id aqui ANTES
-- de agir. O mesmo id chegando de novo (reenvio da rede/navegador — 30/10: um clique em Enviar
-- virou dois pedidos, 16 s de diferença) bate na chave primária e a rota responde 409 sem refazer.
-- Ver api/_pedido-unico.js. Só a service key escreve (RLS ligada, sem política). Linhas com mais
-- de 2 dias são apagadas pelo próprio helper, de vez em quando — a janela útil é de minutos.
create table if not exists public.pedidos_unicos (
  chave     text primary key,
  rota      text not null,
  criado_em timestamptz not null default now()
);
alter table public.pedidos_unicos enable row level security;
create index if not exists pedidos_unicos_criado_em_idx on public.pedidos_unicos (criado_em);
