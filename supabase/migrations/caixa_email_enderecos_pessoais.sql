-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ENDEREÇO PESSOAL DA EQUIPE × ENDEREÇO DE COMUNICAÇÃO — 23/09/2026 (decisão do dono)
--
-- "O e-mail usado deve ser o tarcisio@bidprobrasil.com.br e ele deve receber as respostas. Os
-- endereços de comunicação (responda/contato/suporte…) devem cair na tela de atendimento."
--
-- O MX de bidprobrasil.com.br aponta para o inbound do Resend: QUALQUER endereço do domínio
-- chega ao webhook. A diferença passa a ser de roteamento:
--   · endereço PESSOAL (tabela `equipe_email`)  → caixa do DONO, não abre chamado. Envio da
--     pessoa sai `De: nome <tarcisio@>` com reply-to `tarcisio+<token>@`: a resposta volta
--     encadeada ao envio original (`email_caixa.resposta_de`).
--   · qualquer outro (suporte@, contato@, privacidade@…) → chamado na fila + caixa da equipe.
--
-- `equipe_email` é tabela à parte, com escrita SÓ do admin, de propósito: se o vínculo morasse
-- em `perfis`, um cliente que editasse o próprio perfil poderia se declarar dono de contato@ e
-- desviar a comunicação da empresa para si.
-- Caixa pessoal é privada: só o dono lê (`email_caixa.dono`).
-- A tentativa anterior do mesmo dia (`resposta+<token>@`, genérico) sai de cena — nada foi
-- enviado com ela; o token por envio continua, agora no endereço pessoal.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.equipe_email (
  endereco  text primary key check (endereco ~ '^[a-z0-9._-]+@bidprobrasil\.com\.br$'
                                    and split_part(endereco, '@', 1) not in ('suporte','contato','privacidade','responda','nao-responda','noreply','no-reply','alertas','juridico','resposta')),
  user_id   uuid not null unique references public.perfis(id) on delete cascade,
  criado_em timestamptz not null default now()
);
alter table public.equipe_email enable row level security;
drop policy if exists equipe_email_le on public.equipe_email;
create policy equipe_email_le on public.equipe_email for select to authenticated using ((select public.pode_caixa_email()));
drop policy if exists equipe_email_admin on public.equipe_email;
create policy equipe_email_admin on public.equipe_email for all to authenticated using ((select public.eh_admin())) with check ((select public.eh_admin()));
revoke all on public.equipe_email from anon, authenticated;
grant select, insert, update, delete on public.equipe_email to authenticated;

alter table public.email_caixa add column if not exists dono uuid references public.perfis(id) on delete set null;
create index if not exists email_caixa_dono_idx on public.email_caixa (dono) where dono is not null;

drop policy if exists email_caixa_equipe_le on public.email_caixa;
create policy email_caixa_equipe_le on public.email_caixa
  for select to authenticated using ((select public.pode_caixa_email()) and (dono is null or dono = (select auth.uid())));
drop policy if exists email_caixa_equipe_move on public.email_caixa;
create policy email_caixa_equipe_move on public.email_caixa
  for update to authenticated
  using ((select public.pode_caixa_email()) and (dono is null or dono = (select auth.uid())))
  with check ((select public.pode_caixa_email()) and (dono is null or dono = (select auth.uid())));

-- O dono (admin) — endereço confirmado por ele em 23/09.
insert into public.equipe_email (endereco, user_id)
select 'tarcisio@bidprobrasil.com.br', id from public.perfis where role = 'admin' and funcao_equipe = 'admin'
on conflict do nothing;

-- O envio de 23/09 14:28 (feito por ele) passa a morar na caixa dele.
update public.email_caixa set dono = enviado_por where direcao = 'saida' and enviado_por is not null and dono is null;

-- (limpeza do teste do mesmo dia: a linha fictícia com token 'teste23setresposta')
delete from public.email_caixa where resposta_token = 'teste23setresposta';
