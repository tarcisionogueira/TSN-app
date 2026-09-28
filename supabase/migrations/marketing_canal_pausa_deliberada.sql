-- ─────────────────────────────────────────────────────────────────────────────────────────
-- PAUSA DELIBERADA DE ANÚNCIO NÃO É FALHA DE INGESTÃO — 28/09/2026
--
-- O dono PAUSOU Google Ads e Meta Ads em 14/09/2026 (confirmado por ele em 28/09). Com o vigia
-- mkt_ingestao_atrasada corrigido hoje (não se apaga mais após 10 dias), ele acusaria essa pausa
-- todo dia — e alarme permanente ensina a ignorar o painel. A pausa vira DADO: o canal com pausa
-- aberta sai da conta; ao religar, fecha-se a pausa (`retomado_em`) e o vigia volta a valer.
-- Os canais têm o mesmo nome de marketing_metricas_dia.canal.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.marketing_canal_pausa (
  id           bigint generated always as identity primary key,
  canal        text not null,
  pausado_em   date not null,
  retomado_em  date,
  motivo       text not null,
  registrado_em timestamptz not null default now()
);
alter table public.marketing_canal_pausa enable row level security;
create policy marketing_canal_pausa_admin on public.marketing_canal_pausa for all to authenticated
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));

insert into public.marketing_canal_pausa (canal, pausado_em, motivo)
select c, date '2026-09-14', 'Pausa deliberada do dono (anúncios parados em 14/09/2026; confirmado em 28/09)'
  from unnest(array['Google Ads', 'Meta Ads']) c
 where not exists (select 1 from public.marketing_canal_pausa p where p.canal = c and p.retomado_em is null);

do $$
declare d text; antes text := 'c.ult < current_date - 2 and c.ult >= current_date - 60), 0)';
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p where p.proname = 'qa_invariantes' and p.pronargs = 0 and p.pronamespace = 'public'::regnamespace;
  if position('marketing_canal_pausa' in d) > 0 then return; end if;
  if position(antes in d) = 0 then raise exception 'qa_invariantes: âncora de mkt_ingestao_atrasada não encontrada'; end if;
  d := replace(d, antes, 'c.ult < current_date - 2 and c.ult >= current_date - 60 and not exists (select 1 from marketing_canal_pausa p where p.canal = c.canal and p.retomado_em is null and p.pausado_em <= c.ult + 1)), 0)');
  execute d;
end $$;
