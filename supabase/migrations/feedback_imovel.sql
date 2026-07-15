-- Feedback de interesse do usuário sobre imóveis sugeridos (widget in-app + tela do
-- imóvel). Vira sinal de aprendizado: o e-mail das oportunidades EXCLUI o que a pessoa
-- marcou "sem interesse" e pode priorizar o padrão do que ela clicou ("interesse").
create table if not exists public.feedback_imovel (
  id        bigint generated always as identity primary key,
  user_id   uuid not null,
  imovel_id uuid not null,
  sinal     text not null check (sinal in ('interesse','sem_interesse','visto')),
  contexto  text,               -- 'sugestao_widget' | 'imovel_detalhe' | ...
  criado_em timestamptz default now(),
  unique (user_id, imovel_id, sinal)
);
create index if not exists idx_feedback_user on public.feedback_imovel (user_id, criado_em desc);
create index if not exists idx_feedback_imovel on public.feedback_imovel (imovel_id);

alter table public.feedback_imovel enable row level security;
-- Cada usuário só insere/lê o SEU feedback; o service role (crons) lê tudo.
drop policy if exists "feedback_own_ins" on public.feedback_imovel;
drop policy if exists "feedback_own_sel" on public.feedback_imovel;
create policy "feedback_own_ins" on public.feedback_imovel for insert with check (auth.uid() = user_id);
create policy "feedback_own_sel" on public.feedback_imovel for select using (auth.uid() = user_id);
