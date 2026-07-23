-- PASSO 2 (fundação) do novo modelo de cobrança — MOTOR DE CRÉDITO.
--
-- Saldo em R$ por usuário + extrato (ledger) + RPCs de débito/crédito. O cliente compra
-- crédito em pacotes; cada funcionalidade (mercadológico/documental/índice/parecer) debita
-- o CUSTO REAL medido × multiplicador (3× por padrão), NUNCA deixando o saldo negativo. O
-- markup (multiplicador/câmbio) fica em credito_config, SEM leitura pelo cliente (não expõe
-- a margem). Esta migração é só a fundação: nada debita ainda — a ligação dos geradores e o
-- checkout (Mercado Pago) vêm nos passos seguintes.

-- 1) Saldo + auto-recarga no perfil.
alter table public.perfis
  add column if not exists credito_saldo numeric(12,2) not null default 0,
  add column if not exists credito_auto_piso  numeric(12,2),   -- null = auto-recarga desligada
  add column if not exists credito_auto_valor numeric(12,2);

-- 2) Config única (o dono ajusta multiplicador/câmbio sem deploy). NÃO é lida pelo cliente.
create table if not exists public.credito_config (
  id boolean primary key default true check (id),
  multiplicador numeric(6,2) not null default 3.0,     -- custo × 3
  taxa_usd_brl  numeric(6,2) not null default 5.50,
  atualizado_em timestamptz  not null default now()
);
insert into public.credito_config (id) values (true) on conflict (id) do nothing;

-- 3) Extrato (fechamento de caixa): cada débito/crédito com justificativa.
create table if not exists public.credito_lancamentos (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.perfis(id) on delete cascade,
  tipo text not null check (tipo in ('debito','credito')),
  funcionalidade text,                      -- mercadologico/documental/indice/parecer (débito) | origem (crédito)
  custo_real_micro bigint default 0,        -- custo medido em micro-USD (só p/ auditoria interna)
  valor numeric(12,2) not null,             -- R$ do lançamento (sempre positivo; o sinal é o `tipo`)
  saldo_apos numeric(12,2) not null,
  justificativa text,                       -- texto do consumido (mostrado ao cliente, SEM markup)
  referencia text,                          -- imóvel/região
  criado_em timestamptz not null default now()
);
create index if not exists credito_lanc_user_idx on public.credito_lancamentos(user_id, criado_em desc);

-- 4) RLS: cliente vê o próprio extrato; admin vê tudo. config só admin. Escrita só via RPC.
alter table public.credito_lancamentos enable row level security;
alter table public.credito_config     enable row level security;
drop policy if exists credito_lanc_self  on public.credito_lancamentos;
drop policy if exists credito_lanc_admin on public.credito_lancamentos;
drop policy if exists credito_config_admin on public.credito_config;
create policy credito_lanc_self  on public.credito_lancamentos for select using (auth.uid() = user_id);
create policy credito_lanc_admin on public.credito_lancamentos for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));
create policy credito_config_admin on public.credito_config for select
  using (exists (select 1 from public.perfis p where p.id = auth.uid() and p.role = 'admin'));

-- 5) Valor cobrado a partir do custo real (micro-USD): custo × câmbio × multiplicador.
create or replace function public.valor_credito(p_custo_micro bigint)
returns numeric language sql stable security definer set search_path to 'public' as $function$
  select round((coalesce(p_custo_micro,0)::numeric / 1e6) * c.taxa_usd_brl * c.multiplicador, 2)
  from public.credito_config c where c.id = true
$function$;

create or replace function public.saldo_credito(p_user_id uuid)
returns numeric language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select credito_saldo from public.perfis where id = p_user_id), 0)
$function$;

-- Pré-cheque: dá pra cobrar o custo ESTIMADO desta funcionalidade? (evita gerar e não poder cobrar)
create or replace function public.pode_debitar(p_user_id uuid, p_custo_micro_estimado bigint)
returns boolean language sql stable security definer set search_path to 'public' as $function$
  select coalesce((select credito_saldo from public.perfis where id = p_user_id),0)
       >= public.valor_credito(p_custo_micro_estimado)
$function$;

-- Débito atômico: NUNCA deixa negativo (checa com FOR UPDATE antes de descontar).
create or replace function public.debitar_credito(
  p_user_id uuid, p_func text, p_custo_micro bigint, p_justificativa text, p_referencia text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_valor numeric; v_saldo numeric;
begin
  if p_user_id is null then return jsonb_build_object('ok',false,'erro','nao_autenticado'); end if;
  v_valor := public.valor_credito(p_custo_micro);
  select credito_saldo into v_saldo from public.perfis where id = p_user_id for update;
  if v_saldo is null then return jsonb_build_object('ok',false,'erro','sem_perfil'); end if;
  if v_saldo < v_valor then
    return jsonb_build_object('ok',false,'erro','sem_saldo','valor',v_valor,'saldo',v_saldo);
  end if;
  update public.perfis set credito_saldo = credito_saldo - v_valor where id = p_user_id;
  insert into public.credito_lancamentos(user_id,tipo,funcionalidade,custo_real_micro,valor,saldo_apos,justificativa,referencia)
    values (p_user_id,'debito',p_func,p_custo_micro,v_valor,v_saldo - v_valor,p_justificativa,p_referencia);
  return jsonb_build_object('ok',true,'valor',v_valor,'saldo',v_saldo - v_valor);
end; $function$;

-- Crédito (recarga): usado pelo webhook de pagamento (Mercado Pago/Asaas) no passo 7.
create or replace function public.creditar_credito(
  p_user_id uuid, p_valor numeric, p_origem text, p_referencia text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_saldo numeric;
begin
  if p_user_id is null or coalesce(p_valor,0) <= 0 then return jsonb_build_object('ok',false,'erro','invalido'); end if;
  update public.perfis set credito_saldo = credito_saldo + p_valor where id = p_user_id
    returning credito_saldo into v_saldo;
  if v_saldo is null then return jsonb_build_object('ok',false,'erro','sem_perfil'); end if;
  insert into public.credito_lancamentos(user_id,tipo,funcionalidade,valor,saldo_apos,justificativa,referencia)
    values (p_user_id,'credito',coalesce(p_origem,'recarga'),p_valor,v_saldo,'Recarga de crédito',p_referencia);
  return jsonb_build_object('ok',true,'saldo',v_saldo);
end; $function$;
