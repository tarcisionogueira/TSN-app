-- Tabela de contratos via link (enviados pelo admin para assinatura externa)
create table if not exists public.contratos_link (
  id              uuid default gen_random_uuid() primary key,
  token           text unique not null default encode(gen_random_bytes(20), 'hex'),
  criado_por      uuid references auth.users(id) on delete cascade,
  titulo          text not null,
  conteudo        text not null,
  tipo_contrato   text default 'servico', -- servico, prestacao, locacao, compra, outro
  status          text default 'aguardando', -- aguardando, assinado, expirado, cancelado
  -- Dados preenchidos pelo signatário
  tipo_pessoa     text,   -- 'pf' ou 'pj'
  dados_signatario jsonb,
  assinatura      text,   -- base64 da assinatura canvas
  assinado_em     timestamptz,
  assinante_ip    text,
  -- Expiração automática (30 dias se não assinar)
  expira_em       timestamptz default (now() + interval '30 days'),
  criado_em       timestamptz default now()
);

alter table public.contratos_link enable row level security;

-- Admin/equipe vê todos
drop policy if exists "Equipe gerencia contratos_link" on public.contratos_link;
create policy "Equipe gerencia contratos_link" on public.contratos_link
  using (public.is_equipe())
  with check (public.is_equipe());

-- Criador vê os próprios
drop policy if exists "Criador vê próprios contratos_link" on public.contratos_link;
create policy "Criador vê próprios contratos_link" on public.contratos_link
  using (auth.uid() = criado_por)
  with check (auth.uid() = criado_por);

-- Público acessa pelo token (para assinar) - apenas leitura de campos específicos
drop policy if exists "Público acessa contrato pelo token" on public.contratos_link;
create policy "Público acessa contrato pelo token" on public.contratos_link
  for select using (status in ('aguardando') and expira_em > now());

-- Limpeza automática: função que expira contratos antigos não assinados
create or replace function public.expirar_contratos_link()
returns void language sql security definer as $$
  update public.contratos_link
    set status = 'expirado'
    where status = 'aguardando'
      and expira_em < now();
$$;

create index if not exists idx_contratos_link_token on public.contratos_link(token);
create index if not exists idx_contratos_link_criado_por on public.contratos_link(criado_por);
create index if not exists idx_contratos_link_status on public.contratos_link(status);
