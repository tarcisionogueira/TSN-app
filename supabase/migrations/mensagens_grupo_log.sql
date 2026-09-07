-- Log append-only das mensagens geradas pro grupo de WhatsApp da aula ao vivo (07/09).
--
-- POR QUE ESTA TABELA EXISTE: o gerador de mensagens (api/admin-mensagens-grupo.js) não posta
-- sozinho no grupo — é assistido, igual à fila de WhatsApp (`whatsapp_disparo_log`) e à caixa
-- do Instagram (`ig_rascunho`). Sem um registro do que já foi gerado hoje, o operador não tem
-- como saber se já postou o convite de segunda ou se está gerando de novo — e mensagem
-- repetida no grupo custa mais caro que mensagem nenhuma (mesmo raciocínio já documentado
-- pra fila de WhatsApp individual).
--
-- Não tem UPDATE nem DELETE de propósito: é trilha, não rascunho — o mesmo desenho de
-- `sdr_lead_eventos`.
create table if not exists public.mensagens_grupo_log (
  id bigint generated always as identity primary key,
  evento_id uuid not null references public.eventos_live(id) on delete cascade,
  edicao date not null,
  tipo text not null check (tipo in ('convite','case','educacao','enquete','urgencia','followup')),
  texto text not null,
  gerado_por uuid not null references auth.users(id),
  criado_em timestamptz not null default now()
);

create index if not exists mensagens_grupo_log_evento_edicao_idx
  on public.mensagens_grupo_log (evento_id, edicao, criado_em desc);

alter table public.mensagens_grupo_log enable row level security;

-- Admin-only, como todo o resto do painel de aula ao vivo. Sem policy de escrita para
-- ninguém além de admin: o INSERT sempre passa pela API com a service key (mesmo padrão de
-- whatsapp_disparo_log), então a policy aqui é só para leitura direta do próprio admin.
create policy mensagens_grupo_log_admin_select on public.mensagens_grupo_log
  for select using (exists (select 1 from public.perfis where id = auth.uid() and role = 'admin'));
