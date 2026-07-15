-- Log/rastreio de alterações nos anexos do arremate (inclusão, substituição,
-- exclusão, validação) — quem fez, quando e o quê. Sem FK para imovel_anexos: a
-- linha do log precisa SOBREVIVER à exclusão do anexo (é o que queremos rastrear).
create table if not exists public.anexo_auditoria (
  id uuid primary key default gen_random_uuid(),
  imovel_id uuid,
  anexo_id uuid,
  anexo_nome text,
  anexo_tipo text,
  acao text not null check (acao in ('upload','substituicao','exclusao','validacao')),
  ator_id uuid,
  ator_nome text,
  ator_role text,
  em timestamptz not null default now(),
  detalhe jsonb
);
create index if not exists idx_anexo_auditoria_imovel on public.anexo_auditoria (imovel_id, em desc);
create index if not exists idx_anexo_auditoria_anexo on public.anexo_auditoria (anexo_id);

alter table public.anexo_auditoria enable row level security;

-- Equipe vê tudo (recurso de auditoria administrativa).
drop policy if exists anexo_auditoria_select_staff on public.anexo_auditoria;
create policy anexo_auditoria_select_staff on public.anexo_auditoria
  for select to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid()
                 and p.role = any (array['admin','analista','advogado','consultor'])));

-- O dono do arremate vê o histórico dos anexos do próprio imóvel-âncora.
-- arrematados.imovel_id é TEXT → compara com o uuid convertido para texto.
drop policy if exists anexo_auditoria_select_dono on public.anexo_auditoria;
create policy anexo_auditoria_select_dono on public.anexo_auditoria
  for select to authenticated
  using (exists (select 1 from public.arrematados a
                 where a.imovel_id = anexo_auditoria.imovel_id::text and a.user_id = auth.uid()));

-- Inserções são feitas SEMPRE via service key (endpoints), fora do RLS — sem policy
-- de insert para authenticated/anon de propósito.
