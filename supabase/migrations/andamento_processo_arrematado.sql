-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ANDAMENTO DO PROCESSO NO ARREMATADO — 24/09/2026, pedido do dono
--
-- Na tela "Arremate atribuído" (Arrematados.jsx) o dono quer, para leilão judicial: botão para
-- ele e a EQUIPE consultarem a situação do processo no CNJ, e um diário de ETAPAS com
-- comentários que o ASSESSORADO também acompanha. Reaproveita `caso_andamentos` (mesmo diário
-- e mesma consulta CNJ/DJEN feitos de manhã para os casos) — agora a linha pertence a UM caso
-- OU a UM arrematado.
--   • equipe (admin/analista/consultor/advogado — a mesma lista que já vê `arrematados`) lê e
--     escreve tudo;
--   • o DONO do arrematado/caso só LÊ, e só o que tem `visivel_cliente` (padrão: sim — o pedido
--     é que o assessorado acompanhe). As linhas antigas dos casos nasceram como "só você vê"
--     e ficam ocultas ao cliente.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.eh_equipe()
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (select 1 from public.perfis p
                  where p.id = auth.uid() and p.role in ('admin', 'analista', 'consultor', 'advogado'))
$$;
revoke all on function public.eh_equipe() from public, anon;
grant execute on function public.eh_equipe() to authenticated;

alter table public.caso_andamentos alter column caso_id drop not null;
alter table public.caso_andamentos add column if not exists arrematado_id uuid references public.arrematados(id) on delete cascade;
alter table public.caso_andamentos add column if not exists visivel_cliente boolean not null default true;
alter table public.caso_andamentos drop constraint if exists caso_andamentos_um_dono;
alter table public.caso_andamentos add constraint caso_andamentos_um_dono
  check ((caso_id is not null)::int + (arrematado_id is not null)::int = 1);
create index if not exists caso_andamentos_arrematado_idx on public.caso_andamentos (arrematado_id, criado_em desc);

-- linhas criadas antes desta migração prometiam "só você vê"
update public.caso_andamentos set visivel_cliente = false where criado_em < now() and arrematado_id is null;

drop policy if exists caso_andamentos_admin on public.caso_andamentos;
drop policy if exists caso_andamentos_equipe on public.caso_andamentos;
create policy caso_andamentos_equipe on public.caso_andamentos
  for all to authenticated
  using (public.eh_equipe())
  with check (public.eh_equipe());

drop policy if exists caso_andamentos_cliente_le on public.caso_andamentos;
create policy caso_andamentos_cliente_le on public.caso_andamentos
  for select to authenticated
  using (visivel_cliente and (
    exists (select 1 from public.arrematados a where a.id = caso_andamentos.arrematado_id and a.user_id = auth.uid())
    or exists (select 1 from public.casos c where c.id = caso_andamentos.caso_id and c.cliente_id = auth.uid())
  ));

comment on table public.caso_andamentos is
  'Diario do processo pos-arremate, de um caso OU de um arrematado. Equipe le/escreve; o dono le as linhas visivel_cliente. Origem manual ou CNJ/DJEN consultado sob demanda.';
