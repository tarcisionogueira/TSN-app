-- QUEM ESTÁ ESPERANDO O DOCUMENTO DO LOTE (05/11, pedido do dono)
--
-- "Os que não têm matrícula ou edital devem informar ao usuário e enviar um chamado no atendimento
-- para entrar em contato com o leiloeiro. Assim que for fornecida a matrícula e o edital, deve
-- sinalizar o usuário que os anexos já foram fornecidos pelo leiloeiro e já pode gerar o relatório."
--
-- Até aqui o pedido ao leiloeiro guardava UM usuário por lote (o primeiro; o dedup de 7 dias segura
-- os outros), e ninguém era avisado quando o documento chegava — quem parou na pré-checagem não
-- tem análise gravada para "regerar sozinha". Esta tabela guarda TODOS os que pararam esperando:
--   criado_em  → o usuário bateu na falta de documento (api/_pedido-leiloeiro-auto.js)
--   pronto_em  → o lote passou a ter matrícula E (edital ou regras) — gatilhos abaixo, venha o
--                documento por onde vier (resposta do leiloeiro, anexo da equipe, captura do coletor)
--   avisado_em → o aviso saiu (api/avisar-documentos-cron.js, e-mail + faixa verde na Análise)

create table if not exists public.documentos_aguardando (
  imovel_id   uuid not null,
  user_id     uuid not null,
  criado_em   timestamptz not null default now(),
  pronto_em   timestamptz,
  avisado_em  timestamptz,
  aviso_erro  text,
  primary key (imovel_id, user_id)
);
create index if not exists documentos_aguardando_pendente_idx
  on public.documentos_aguardando (pronto_em) where avisado_em is null and pronto_em is not null;

alter table public.documentos_aguardando enable row level security;
-- O usuário lê só as próprias linhas (a tela de Análise mostra "os documentos chegaram").
-- Escrita só pelo servidor (service role).
drop policy if exists documentos_aguardando_le_proprio on public.documentos_aguardando;
create policy documentos_aguardando_le_proprio on public.documentos_aguardando
  for select to authenticated using (user_id = auth.uid());

-- Mesma régua do gatilho que fecha o chamado (20261104b): matrícula E (edital ou regras de venda),
-- pelo anexo OU pelo selo do lote (o selo também conta o documento capturado pelo coletor).
create or replace function public.documentos_lote_completos(p_imovel uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select (coalesce(i.tem_matricula_doc, false)
            or exists (select 1 from imovel_anexos a where a.imovel_id = p_imovel and a.tipo = 'matricula'))
     and (coalesce(i.tem_edital_doc, false)
            or exists (select 1 from imovel_anexos a where a.imovel_id = p_imovel and a.tipo in ('edital', 'regras_venda', 'regras')))
    from imoveis_leilao i where i.id = p_imovel
$$;

create or replace function public.documentos_aguardando_marcar_pronto(p_imovel uuid)
returns integer language plpgsql security definer set search_path to 'public' as $$
declare n integer;
begin
  if not exists (select 1 from documentos_aguardando where imovel_id = p_imovel and pronto_em is null) then return 0; end if;
  if not coalesce(public.documentos_lote_completos(p_imovel), false) then return 0; end if;
  update documentos_aguardando set pronto_em = now() where imovel_id = p_imovel and pronto_em is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- (1) Anexo novo no lote (resposta do leiloeiro, equipe, cliente). `zz_b_` roda depois do selo e do
--     gatilho que fecha o chamado (gatilhos AFTER rodam em ordem alfabética).
create or replace function public.trg_anexo_documentos_aguardando()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.tipo in ('matricula', 'edital', 'regras_venda', 'regras') then
    perform public.documentos_aguardando_marcar_pronto(new.imovel_id);
  end if;
  return null;
end $$;
drop trigger if exists zz_b_anexo_documentos_aguardando on public.imovel_anexos;
create trigger zz_b_anexo_documentos_aguardando after insert on public.imovel_anexos
  for each row execute function public.trg_anexo_documentos_aguardando();

-- (2) Selo do lote virou completo SEM anexo novo (o coletor achou o documento na página). Sem
--     `UPDATE OF coluna` de propósito: o selo é recalculado num BEFORE e a coluna não está no SET.
--     O WHEN é barato e só passa na transição incompleto → completo.
create or replace function public.trg_selo_documentos_aguardando()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  perform public.documentos_aguardando_marcar_pronto(new.id);
  return null;
end $$;
drop trigger if exists zz_selo_documentos_aguardando on public.imoveis_leilao;
create trigger zz_selo_documentos_aguardando after update on public.imoveis_leilao
  for each row
  when (coalesce(new.tem_matricula_doc, false) and coalesce(new.tem_edital_doc, false)
        and not (coalesce(old.tem_matricula_doc, false) and coalesce(old.tem_edital_doc, false)))
  execute function public.trg_selo_documentos_aguardando();

revoke all on function public.documentos_aguardando_marcar_pronto(uuid) from public, anon, authenticated;
revoke all on function public.documentos_lote_completos(uuid) from public, anon, authenticated;
revoke all on function public.trg_anexo_documentos_aguardando() from public, anon, authenticated;
revoke all on function public.trg_selo_documentos_aguardando() from public, anon, authenticated;
