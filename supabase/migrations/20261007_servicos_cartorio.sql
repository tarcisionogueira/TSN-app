-- SERVIÇOS DE CARTÓRIO (07/10, pedido do dono). A equipe BidPro executa serviços cartorários pós-
-- arrematação (o 1º: REGISTRO SIMPLES, sem averbação, R$ 2.000 = R$ 1.000 na arrematação + R$ 1.000
-- para DAR ENTRADA). Regra do dono: a parcela de entrada é PAGA ANTES do protocolo — o serviço já foi
-- preparado; o cliente paga e só então damos entrada. Por isso o protocolo é TRAVADO no banco enquanto
-- houver parcela não paga (não só na tela).
--
-- Cobrança reaproveita `cobrancas_avulsas` (link público /cobranca/:id, MP Pix/cartão, webhook já
-- existente): cada parcela cobrada vira uma cobrança avulsa, e o gatilho abaixo dá a baixa na parcela
-- quando o webhook marca a cobrança como paga (e desfaz em estorno). Custas/emolumentos/ITBI do
-- cartório NÃO entram aqui: são do cliente, pagos à parte — estes valores são só a remuneração.

create table if not exists public.servicos_cartorio_catalogo (
  id uuid primary key default gen_random_uuid(),
  chave text not null unique,
  nome text not null,
  descricao text,
  -- [{ "rotulo": "...", "valor": 1000, "momento": "contratacao" | "entrada" | "outro" }]
  parcelas jsonb not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.servicos_cartorio (
  id uuid primary key default gen_random_uuid(),
  catalogo_id uuid not null references public.servicos_cartorio_catalogo(id),
  servico_nome text not null,                       -- snapshot do nome contratado
  arrematacao_id uuid references public.arrematacoes(id) on delete set null,
  caso_id uuid,
  cliente_id uuid references auth.users(id),
  cliente_nome text,
  cliente_email text,
  imovel_descricao text,
  cartorio text,
  matricula text,
  status text not null default 'aguardando_pagamento'
    check (status in ('aguardando_pagamento','em_preparo','aguardando_entrada','pronto_para_protocolo','protocolado','exigencia','registrado','cancelado')),
  protocolo_numero text,
  protocolado_em timestamptz,
  registrado_em timestamptz,
  observacoes text,
  criado_por uuid references auth.users(id),
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);
create index if not exists servicos_cartorio_arrematacao_idx on public.servicos_cartorio(arrematacao_id);
create index if not exists servicos_cartorio_status_idx on public.servicos_cartorio(status);

create table if not exists public.servicos_cartorio_parcelas (
  id uuid primary key default gen_random_uuid(),
  servico_id uuid not null references public.servicos_cartorio(id) on delete cascade,
  ordem int not null,
  rotulo text not null,
  momento text not null default 'outro',
  valor numeric(15,2) not null check (valor > 0),
  status text not null default 'pendente' check (status in ('pendente','cobrada','paga','cancelada')),
  cobranca_avulsa_id uuid unique references public.cobrancas_avulsas(id),
  paga_em timestamptz,
  created_at timestamptz not null default now(),
  unique (servico_id, ordem)
);

-- Tudo passa pela API (service key, com checagem de papel/dono). Sem policy = ninguém lê direto.
alter table public.servicos_cartorio_catalogo enable row level security;
alter table public.servicos_cartorio enable row level security;
alter table public.servicos_cartorio_parcelas enable row level security;

-- Baixa da parcela pelo pagamento da cobrança avulsa (e desfaz em estorno).
create or replace function public.servico_cartorio_baixa_parcela()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_servico uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.status = 'paga' then
    update public.servicos_cartorio_parcelas
       set status = 'paga', paga_em = coalesce(new.pago_em, now())
     where cobranca_avulsa_id = new.id and status <> 'paga'
     returning servico_id into v_servico;
  elsif old.status = 'paga' then
    update public.servicos_cartorio_parcelas
       set status = case when new.status = 'cancelada' then 'cancelada' else 'cobrada' end, paga_em = null
     where cobranca_avulsa_id = new.id
     returning servico_id into v_servico;
  end if;
  if v_servico is not null then
    -- avança/recua o status do serviço conforme o que está pago
    update public.servicos_cartorio s set
      status = case
        when s.status in ('protocolado','exigencia','registrado','cancelado') then s.status
        when not exists (select 1 from public.servicos_cartorio_parcelas p where p.servico_id = s.id and p.status not in ('paga','cancelada'))
          then 'pronto_para_protocolo'
        when s.status = 'aguardando_pagamento'
             and exists (select 1 from public.servicos_cartorio_parcelas p where p.servico_id = s.id and p.momento = 'contratacao' and p.status = 'paga')
          then 'em_preparo'
        else s.status end,
      atualizado_em = now()
    where s.id = v_servico;
  end if;
  return new;
end $$;

create or replace trigger trg_servico_cartorio_baixa_parcela
  after update of status on public.cobrancas_avulsas
  for each row execute function public.servico_cartorio_baixa_parcela();

-- TRAVA DO PROTOCOLO: não dá entrada com parcela em aberto (regra do dono: paga antes de dar entrada).
create or replace function public.servico_cartorio_trava_protocolo()
returns trigger language plpgsql as $$
begin
  -- regra_negocio 'cartorio.paga_antes_da_entrada' (dono, 07/10): todas as parcelas pagas antes do protocolo.
  if new.status in ('protocolado','registrado') and old.status is distinct from new.status
     and coalesce((select (valor)::text::boolean from public.regra_negocio where chave = 'cartorio.paga_antes_da_entrada' and ativo), true)
     and exists (select 1 from public.servicos_cartorio_parcelas p where p.servico_id = new.id and p.status not in ('paga','cancelada')) then
    raise exception 'Há parcela não paga: o cliente paga antes de darmos entrada no cartório.' using errcode = 'P0001';
  end if;
  if new.status = 'protocolado' and new.protocolado_em is null then new.protocolado_em := now(); end if;
  if new.status = 'registrado' and new.registrado_em is null then new.registrado_em := now(); end if;
  new.atualizado_em := now();
  return new;
end $$;

create or replace trigger trg_servico_cartorio_trava_protocolo
  before update on public.servicos_cartorio
  for each row execute function public.servico_cartorio_trava_protocolo();

insert into public.servicos_cartorio_catalogo (chave, nome, descricao, parcelas)
values ('registro_simples', 'Registro simples (sem averbação)',
        'Registro da carta de arrematação/escritura na matrícula, sem averbação. Custas, emolumentos e ITBI à parte, pagos pelo cliente.',
        '[{"rotulo":"Na arrematação","valor":1000,"momento":"contratacao"},{"rotulo":"Para dar entrada no registro","valor":1000,"momento":"entrada"}]'::jsonb)
on conflict (chave) do nothing;

-- Função de gatilho SECURITY DEFINER não fica exposta a chamadas diretas (auditoria_seguranca).
revoke execute on function public.servico_cartorio_baixa_parcela() from public, anon, authenticated;

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo, atualizado_em)
values ('cartorio.paga_antes_da_entrada', 'true'::jsonb,
 'Serviço de cartório: o cliente paga TODAS as parcelas (inclusive a "para dar entrada") antes do protocolo. Decisão do dono 07/10.',
 array['servico_cartorio_trava_protocolo'], true, now())
on conflict (chave) do nothing;
