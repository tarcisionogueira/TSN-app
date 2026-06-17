-- ============================================================
-- Fase 3 — Consultor/Afiliado + Comissões
-- Execute no SQL Editor do Supabase
-- ============================================================

-- ─── 1. Colunas no perfil ───────────────────────────────────
-- codigo_indicacao : código único do consultor para o link de afiliado
-- indicado_por     : consultor que captou este cliente (carteira)
-- asaas_wallet_id  : walletId no Asaas para receber repasses/splits
-- comissao_afiliado_pct : % que o consultor recebe sobre produtos/assinaturas (sai da fatia TSN)
alter table public.perfis add column if not exists codigo_indicacao      text unique;
alter table public.perfis add column if not exists indicado_por          uuid references public.perfis(id);
alter table public.perfis add column if not exists asaas_wallet_id       text;
alter table public.perfis add column if not exists comissao_afiliado_pct numeric(5,2) default 20.00;

-- ─── 2. Geração de código de indicação para consultores ─────
create or replace function public.gerar_codigo_indicacao(p_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  novo text;
begin
  -- código curto e legível baseado no id, garantindo unicidade
  loop
    novo := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
    exit when not exists (select 1 from public.perfis where codigo_indicacao = novo);
  end loop;
  update public.perfis set codigo_indicacao = novo where id = p_id and codigo_indicacao is null;
  return novo;
end;
$$;

-- Gera código para quem já é consultor e ainda não tem
do $$
declare r record;
begin
  for r in select id from public.perfis where role = 'consultor' and codigo_indicacao is null loop
    perform public.gerar_codigo_indicacao(r.id);
  end loop;
end $$;

-- ─── 3. Resolve indicação no cadastro (metadata ref_codigo) ─
-- Recria handle_new_user preservando LGPD/CPF e adicionando o vínculo de carteira
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer
set search_path = public as $$
declare
  cpf_limpo text;
  consultor_id uuid;
  ref_cod text;
begin
  cpf_limpo := nullif(regexp_replace(coalesce(new.raw_user_meta_data->>'cpf',''), '\D', '', 'g'), '');
  ref_cod   := nullif(upper(new.raw_user_meta_data->>'ref_codigo'), '');

  if ref_cod is not null then
    select id into consultor_id from public.perfis
      where codigo_indicacao = ref_cod and role = 'consultor' limit 1;
  end if;

  insert into public.perfis (id, nome, cpf, telefone, endereco, role, lgpd_aceito, lgpd_data, indicado_por)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.raw_user_meta_data->>'full_name', ''),
    cpf_limpo,
    new.raw_user_meta_data->>'telefone',
    new.raw_user_meta_data->>'endereco',
    coalesce(new.raw_user_meta_data->>'role', 'explorador'),
    coalesce((new.raw_user_meta_data->>'lgpd_aceito')::boolean, false),
    (new.raw_user_meta_data->>'lgpd_data')::timestamptz,
    consultor_id
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- ─── 3b. RPC para vincular indicação após o cadastro ───────
-- Usada quando o vínculo não pôde ser feito no trigger (ex: login Google,
-- onde não há metadata ref_codigo). Só vincula se ainda não houver carteira.
create or replace function public.vincular_indicacao(p_codigo text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  consultor_id uuid;
begin
  select id into consultor_id from public.perfis
    where codigo_indicacao = upper(p_codigo) and role = 'consultor' limit 1;

  if consultor_id is null or consultor_id = auth.uid() then
    return false;
  end if;

  update public.perfis
    set indicado_por = consultor_id
    where id = auth.uid() and indicado_por is null;

  return found;
end;
$$;

-- ─── 4. Tabela de comissões ─────────────────────────────────
-- tipo:   'afiliado'   (consultor — produtos/assinaturas, recorrente)
--         'honorario'  (advogado/analista — êxito de arrematação)
-- origem: 'produto' | 'assinatura' | 'arrematacao'
-- status: 'pendente' | 'pago' | 'cancelado'
create table if not exists public.comissoes (
  id              uuid default uuid_generate_v4() primary key,
  beneficiario_id uuid references auth.users(id) on delete set null, -- quem recebe (consultor/advogado/analista)
  cliente_id      uuid references auth.users(id) on delete set null, -- cliente que gerou a receita
  tipo            text not null check (tipo in ('afiliado','honorario')),
  origem          text not null check (origem in ('produto','assinatura','arrematacao')),
  referencia      text,                       -- descrição (ex: nome do curso, plano, imóvel)
  valor_base      numeric(15,2) not null,     -- valor que originou a comissão
  percentual      numeric(5,2)  not null,     -- % aplicado
  valor_comissao  numeric(15,2) not null,     -- valor a repassar
  competencia     date,                       -- mês de referência (assinaturas recorrentes)
  status          text default 'pendente' check (status in ('pendente','pago','cancelado')),
  asaas_payment_id text,                       -- pagamento Asaas que originou
  pago_em         timestamptz,
  created_at      timestamptz default now()
);

alter table public.comissoes enable row level security;

create policy "Beneficiário vê próprias comissões" on public.comissoes
  for select using (auth.uid() = beneficiario_id);

create policy "Admin vê todas comissões" on public.comissoes
  for select using (public.is_admin());

create policy "Admin gerencia comissões" on public.comissoes
  for all using (public.is_admin());

-- ─── 5. Política: consultor vê clientes da própria carteira ─
create policy "Consultor vê carteira" on public.perfis
  for select using (indicado_por = auth.uid());

-- ─── ÍNDICES ─────────────────────────────────────────────────
create index if not exists idx_comissoes_beneficiario on public.comissoes(beneficiario_id);
create index if not exists idx_comissoes_status        on public.comissoes(status);
create index if not exists idx_perfis_indicado_por     on public.perfis(indicado_por);
create index if not exists idx_perfis_codigo_indicacao on public.perfis(codigo_indicacao);
