-- Pedido de informação ao leiloeiro (11/09, pedido do dono): na tela de Análise, o cliente
-- pode disparar um e-mail ao leiloeiro pedindo só o que está faltando/em aberto no checklist
-- documental (não uma lista exaustiva "de advogado") — os itens já vêm calculados pela IA em
-- `analises_documental.result` (`faltando` + `lacunas`).
--
-- Bloqueador real (pesquisado antes de escrever isto): NENHUMA fonte tem e-mail de leiloeiro
-- cadastrado hoje. `leiloeiro_contato` é o cadastro manual — o admin/analista vai populando
-- conforme descobre; enquanto a fonte não tiver e-mail, o endpoint devolve `sem_contato` e o
-- front cai para "copiar texto + abrir a página do lote" (sem chamar o Resend).
--
-- Mesmo padrão de `leiloeiro_conhecimento`: nunca exposto ao client, só service_role.
create table if not exists public.leiloeiro_contato (
  fonte         text primary key,
  email         text not null,
  observacao    text,
  criado_em     timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
alter table public.leiloeiro_contato enable row level security;
drop policy if exists "service_only_leiloeiro_contato" on public.leiloeiro_contato;
create policy "service_only_leiloeiro_contato" on public.leiloeiro_contato for all using (false);

-- Auditoria: nenhuma mutação sem rastro (convenção do projeto). Registra TODA tentativa,
-- inclusive quando não há contato cadastrado (`status='sem_contato'`) — é o que permite medir
-- quantas fontes ainda faltam cadastrar.
create table if not exists public.documental_pedidos_leiloeiro (
  id                  uuid primary key default gen_random_uuid(),
  imovel_id           text not null,
  user_id             uuid not null,
  fonte               text,
  destinatario_email  text,
  itens_pedidos       jsonb not null default '[]'::jsonb,
  resend_id           text,
  status              text not null, -- 'enviado' | 'sem_contato' | 'falha' | 'limitado'
  criado_em           timestamptz not null default now()
);
alter table public.documental_pedidos_leiloeiro enable row level security;
drop policy if exists "service_only_documental_pedidos_leiloeiro" on public.documental_pedidos_leiloeiro;
create policy "service_only_documental_pedidos_leiloeiro" on public.documental_pedidos_leiloeiro for all using (false);
create index if not exists idx_documental_pedidos_leiloeiro_imovel on public.documental_pedidos_leiloeiro (imovel_id, criado_em desc);
create index if not exists idx_documental_pedidos_leiloeiro_user  on public.documental_pedidos_leiloeiro (user_id, criado_em desc);
