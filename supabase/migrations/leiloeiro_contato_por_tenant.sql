-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CONTATO POR LEILOEIRO (TENANT), NÃO POR FONTE — 28/09/2026 (correção completa do bounce JRF)
--
-- `leiloeiro_contato` é chaveado por FONTE. Em plataforma multi-tenant (SUPERBID, SOLD,
-- HASTAPUBLICA, LJUD…) uma fonte são dezenas de leiloeiros, e o contato de UM virava o de
-- todos — foi assim que 6 pedidos de veículos de leiloeiros diversos foram para a JRF. A
-- limpeza de hoje (leiloeiro_contato_bounce_e_dominio_de_terceiro.sql) tirou os errados; isto
-- impede que voltem, inclusive pela porta manual (e-mail digitado no envio era gravado por
-- fonte e viraria, de novo, o contato da plataforma inteira).
--
--   leiloeiro_contato_tenant   (fonte, leiloeiro) → e-mail. Alimentada pela coleta (o `store`
--                              da rede Superbid publica o e-mail de cada leiloeiro) e pelo
--                              envio manual em lote de plataforma.
--   contato_leiloeiro_resolver 1º o contato do leiloeiro do lote; senão o da fonte — mas em
--                              fonte multi-tenant só o AUTOMÁTICO (que desde hoje só aceita o
--                              domínio do próprio site = a plataforma, nunca um tenant).
--   contato_leiloeiro_salvar_manual  multi-tenant + leiloeiro conhecido → grava no tenant.
--   contato_leiloeiro_tenant_auto    coleta; nunca pisa em manual nem em endereço suprimido.
-- Multi-tenant = mais de 1 leiloeiro distinto no histórico da fonte (imóveis + veículos) — do
-- dado, sem lista fixa: plataforma nova entra sozinha. Medido 28/09: SUPERBID, SOLD, LJUD,
-- HASTAPUBLICA, SBID9 = sim; ZUK, MEGA, SODRE, LEILOFY, WEBLEILOES = não.
-- ─────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.leiloeiro_chave(p text)
returns text language sql immutable set search_path = public as $$
  select nullif(lower(btrim(regexp_replace(translate(coalesce(p, ''),
    'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇáàâãäéèêëíìîïóòôõöúùûüç', 'AAAAAEEEEIIIIOOOOOUUUUCaaaaaeeeeiiiiooooouuuuc'), '\s+', ' ', 'g'))), '')
$$;

create table if not exists public.leiloeiro_contato_tenant (
  fonte           text not null,
  leiloeiro_chave text not null,
  leiloeiro       text not null,
  email           text not null,
  origem          text not null default 'auto' check (origem in ('auto','manual')),
  observacao      text,
  atualizado_em   timestamptz not null default now(),
  primary key (fonte, leiloeiro_chave)
);
alter table public.leiloeiro_contato_tenant enable row level security; -- só service key (e-mail de terceiro)

create or replace function public.fonte_multi_tenant(p_fonte text)
returns boolean language sql stable security definer set search_path = public as $$
  -- Existe um 2º leiloeiro diferente do 1º? Pára no primeiro achado (a contagem distinta com
  -- leiloeiro_chave custava ~450 ms por chamada; esta, ~9 ms). Olha o HISTÓRICO, não só os
  -- ativos: em 28/09 os ativos do SUPERBID diziam todos "Superbid" (o nome do tenant era
  -- descartado na coleta) e a plataforma parecia single-tenant.
  with um as (
    select lower(btrim(k)) k from (
      (select leiloeiro k from public.imoveis_leilao where fonte = p_fonte and leiloeiro is not null limit 1)
      union all
      (select leiloeiro from public.veiculos_leilao where fonte = p_fonte and leiloeiro is not null limit 1)
    ) x limit 1
  )
  select exists (select 1 from public.imoveis_leilao i, um where i.fonte = p_fonte and lower(btrim(i.leiloeiro)) <> um.k)
      or exists (select 1 from public.veiculos_leilao v, um where v.fonte = p_fonte and lower(btrim(v.leiloeiro)) <> um.k)
$$;

create or replace function public.contato_leiloeiro_resolver(p_fonte text, p_leiloeiro text)
returns table(email text, escopo text) language sql stable security definer set search_path = public as $$
  with t as (
    select c.email, 'leiloeiro'::text escopo, 1 ord from public.leiloeiro_contato_tenant c
     where c.fonte = upper(p_fonte) and c.leiloeiro_chave = public.leiloeiro_chave(p_leiloeiro)
    union all
    select c.email, case when m.multi then 'plataforma' else 'fonte' end, 2 from public.leiloeiro_contato c
      cross join lateral (select public.fonte_multi_tenant(upper(p_fonte)) multi) m
     where c.fonte = upper(p_fonte) and (not m.multi or c.origem = 'auto')
  )
  select t.email, t.escopo from t
   where not exists (select 1 from public.emails_supressao s where s.destinatario = lower(btrim(t.email)) and s.suprimido)
   order by t.ord limit 1
$$;

create or replace function public.contato_leiloeiro_salvar_manual(p_fonte text, p_leiloeiro text, p_email text, p_obs text)
returns text language plpgsql security definer set search_path = public as $$
declare f text := upper(btrim(p_fonte)); k text := public.leiloeiro_chave(p_leiloeiro); e text := lower(btrim(p_email));
begin
  if f is null or f = '' or e is null or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  if public.fonte_multi_tenant(f) then
    if k is null then return 'ignorado_sem_leiloeiro'; end if; -- sem saber de quem é, não grava por fonte
    insert into public.leiloeiro_contato_tenant (fonte, leiloeiro_chave, leiloeiro, email, origem, observacao, atualizado_em)
    values (f, k, btrim(p_leiloeiro), e, 'manual', p_obs, now())
    on conflict (fonte, leiloeiro_chave) do update set email = excluded.email, origem = 'manual', observacao = excluded.observacao,
      leiloeiro = excluded.leiloeiro, atualizado_em = now();
    return 'leiloeiro';
  end if;
  insert into public.leiloeiro_contato (fonte, email, origem, observacao, atualizado_em)
  values (f, e, 'manual', p_obs, now())
  on conflict (fonte) do update set email = excluded.email, origem = 'manual', observacao = excluded.observacao, atualizado_em = now();
  return 'fonte';
end $$;

-- p_itens: [{leiloeiro, email, obs}] da coleta. Devolve quantos gravou/atualizou.
create or replace function public.contato_leiloeiro_tenant_auto(p_fonte text, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.leiloeiro_contato_tenant as c (fonte, leiloeiro_chave, leiloeiro, email, origem, observacao, atualizado_em)
  select distinct on (public.leiloeiro_chave(i->>'leiloeiro'))
         upper(p_fonte), public.leiloeiro_chave(i->>'leiloeiro'), btrim(i->>'leiloeiro'), lower(btrim(i->>'email')), 'auto', left(i->>'obs', 300), now()
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
   where public.leiloeiro_chave(i->>'leiloeiro') is not null
     and lower(btrim(i->>'email')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     and not exists (select 1 from public.emails_supressao s where s.destinatario = lower(btrim(i->>'email')) and s.suprimido)
  on conflict (fonte, leiloeiro_chave) do update
     set email = excluded.email, leiloeiro = excluded.leiloeiro, observacao = excluded.observacao, atualizado_em = now()
   where c.origem = 'auto';
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function public.fonte_multi_tenant(text) from public, anon, authenticated;
revoke all on function public.contato_leiloeiro_resolver(text, text) from public, anon, authenticated;
revoke all on function public.contato_leiloeiro_salvar_manual(text, text, text, text) from public, anon, authenticated;
revoke all on function public.contato_leiloeiro_tenant_auto(text, jsonb) from public, anon, authenticated;
grant execute on function public.fonte_multi_tenant(text), public.contato_leiloeiro_resolver(text, text),
  public.contato_leiloeiro_salvar_manual(text, text, text, text), public.contato_leiloeiro_tenant_auto(text, jsonb) to service_role;

-- Supressão também tira o contato por leiloeiro (mesma contramedida da tabela por fonte).
create or replace function public.leiloeiro_contato_descartar_suprimido()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.suprimido and not coalesce(old.suprimido, false) then
    with fora as (
      delete from public.leiloeiro_contato c where lower(btrim(c.email)) = lower(btrim(new.destinatario))
      returning c.fonte, c.email, c.origem, c.observacao
    ), fora_t as (
      delete from public.leiloeiro_contato_tenant c where lower(btrim(c.email)) = lower(btrim(new.destinatario))
      returning c.fonte || ' / ' || c.leiloeiro as fonte, c.email, c.origem, c.observacao
    )
    insert into public.leiloeiro_contato_descartado (fonte, email, origem, observacao, motivo)
    select fonte, email, origem, observacao, 'suprimido: ' || coalesce(new.motivo, '?') from fora
    union all
    select fonte, email, origem, observacao, 'suprimido: ' || coalesce(new.motivo, '?') from fora_t;
  end if;
  return new;
end $$;

-- RÓTULO GENÉRICO ≠ LEILOEIRO. Quando a coleta não sabe o tenant, grava o nome da PLATAFORMA
-- ("Superbid", "Sold Leilões", "Rede Superbid" — scraper-puppeteer.mjs). Tratar isso como um
-- leiloeiro faria o e-mail digitado num desses lotes virar o contato de TODOS os lotes sem
-- tenant — o mesmo defeito, em miniatura. Genérico = mesmo nome da fonte ou um desses rótulos.
create or replace function public.leiloeiro_chave_tenant(p_fonte text, p_leiloeiro text)
returns text language sql immutable set search_path = public as $$
  select case when k is null or k = lower(btrim(p_fonte)) or k in ('superbid', 'sold leiloes', 'rede superbid', 'sold')
              then null else k end
    from (select public.leiloeiro_chave(p_leiloeiro) k) x
$$;

create or replace function public.contato_leiloeiro_resolver(p_fonte text, p_leiloeiro text)
returns table(email text, escopo text) language sql stable security definer set search_path = public as $$
  with t as (
    select c.email, 'leiloeiro'::text escopo, 1 ord from public.leiloeiro_contato_tenant c
     where c.fonte = upper(p_fonte) and c.leiloeiro_chave = public.leiloeiro_chave_tenant(p_fonte, p_leiloeiro)
    union all
    select c.email, case when m.multi then 'plataforma' else 'fonte' end, 2 from public.leiloeiro_contato c
      cross join lateral (select public.fonte_multi_tenant(upper(p_fonte)) multi) m
     where c.fonte = upper(p_fonte) and (not m.multi or c.origem = 'auto')
  )
  select t.email, t.escopo from t
   where not exists (select 1 from public.emails_supressao s where s.destinatario = lower(btrim(t.email)) and s.suprimido)
   order by t.ord limit 1
$$;

create or replace function public.contato_leiloeiro_salvar_manual(p_fonte text, p_leiloeiro text, p_email text, p_obs text)
returns text language plpgsql security definer set search_path = public as $$
declare f text := upper(btrim(p_fonte)); k text := public.leiloeiro_chave_tenant(p_fonte, p_leiloeiro); e text := lower(btrim(p_email));
begin
  if f is null or f = '' or e is null or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then return null; end if;
  if public.fonte_multi_tenant(f) then
    if k is null then return 'ignorado_sem_leiloeiro'; end if; -- sem saber de quem é, não grava
    insert into public.leiloeiro_contato_tenant (fonte, leiloeiro_chave, leiloeiro, email, origem, observacao, atualizado_em)
    values (f, k, btrim(p_leiloeiro), e, 'manual', p_obs, now())
    on conflict (fonte, leiloeiro_chave) do update set email = excluded.email, origem = 'manual', observacao = excluded.observacao,
      leiloeiro = excluded.leiloeiro, atualizado_em = now();
    return 'leiloeiro';
  end if;
  insert into public.leiloeiro_contato (fonte, email, origem, observacao, atualizado_em)
  values (f, e, 'manual', p_obs, now())
  on conflict (fonte) do update set email = excluded.email, origem = 'manual', observacao = excluded.observacao, atualizado_em = now();
  return 'fonte';
end $$;

create or replace function public.contato_leiloeiro_tenant_auto(p_fonte text, p_itens jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into public.leiloeiro_contato_tenant as c (fonte, leiloeiro_chave, leiloeiro, email, origem, observacao, atualizado_em)
  select distinct on (public.leiloeiro_chave_tenant(p_fonte, i->>'leiloeiro'))
         upper(p_fonte), public.leiloeiro_chave_tenant(p_fonte, i->>'leiloeiro'), btrim(i->>'leiloeiro'), lower(btrim(i->>'email')), 'auto', left(i->>'obs', 300), now()
    from jsonb_array_elements(coalesce(p_itens, '[]'::jsonb)) i
   where public.leiloeiro_chave_tenant(p_fonte, i->>'leiloeiro') is not null
     and lower(btrim(i->>'email')) ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     and not exists (select 1 from public.emails_supressao s where s.destinatario = lower(btrim(i->>'email')) and s.suprimido)
  on conflict (fonte, leiloeiro_chave) do update
     set email = excluded.email, leiloeiro = excluded.leiloeiro, observacao = excluded.observacao, atualizado_em = now()
   where c.origem = 'auto';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.contato_leiloeiro_resolver(text, text) from public, anon, authenticated;
revoke all on function public.contato_leiloeiro_salvar_manual(text, text, text, text) from public, anon, authenticated;
revoke all on function public.contato_leiloeiro_tenant_auto(text, jsonb) from public, anon, authenticated;
grant execute on function public.contato_leiloeiro_resolver(text, text), public.contato_leiloeiro_salvar_manual(text, text, text, text),
  public.contato_leiloeiro_tenant_auto(text, jsonb) to service_role;
