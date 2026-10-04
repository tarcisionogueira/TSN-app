-- Telefone/WhatsApp do leiloeiro (05/10, pedido do dono): o pedido de documento também sai pelo
-- WhatsApp Web DO DONO (link web.whatsapp.com/send com o mesmo texto do e-mail) — sem API oficial.
-- Tabela própria porque `leiloeiro_contato(.email)` é NOT NULL: leiloeiro sem e-mail público
-- (PESTANA, BIASI) é justamente o que mais precisa do telefone.
-- leiloeiro_chave = ''  → telefone da FONTE/plataforma; senão = leiloeiro_chave_tenant(fonte, leiloeiro).
create table if not exists public.leiloeiro_telefone (
  fonte           text not null,
  leiloeiro_chave text not null default '',
  leiloeiro       text,
  telefone        text not null check (telefone ~ '^55[1-9][1-9][0-9]{8,9}$'),
  whatsapp        boolean not null default false,
  origem          text not null default 'auto' check (origem in ('auto','manual')),
  observacao      text,
  atualizado_em   timestamptz not null default now(),
  primary key (fonte, leiloeiro_chave)
);
alter table public.leiloeiro_telefone enable row level security;  -- sem policy: só service role

-- Mesma ordem do contato_leiloeiro_resolver: o do LEILOEIRO do lote primeiro; o da fonte depois.
-- Diferente do e-mail, o 'manual' da fonte vale também em plataforma: a tabela nasce sem o legado
-- errado que motivou a restrição lá (JRF, 28/09), e o capturador já não grava telefone de
-- plataforma white-label (<95% dos lotes no domínio dominante).
-- SECURITY INVOKER de propósito: quem chama é o servidor com service key; anon não lê nada (RLS).
create or replace function public.telefone_leiloeiro_resolver(p_fonte text, p_leiloeiro text)
returns table(telefone text, whatsapp boolean, escopo text)
language sql stable security invoker set search_path to 'public' as $$
  select x.telefone, x.whatsapp, x.escopo from (
    select t.telefone, t.whatsapp, 'leiloeiro'::text escopo, 1 ord from public.leiloeiro_telefone t
     where t.fonte = upper(p_fonte) and t.leiloeiro_chave <> ''
       and t.leiloeiro_chave = public.leiloeiro_chave_tenant(p_fonte, p_leiloeiro)
    union all
    select t.telefone, t.whatsapp, case when m.multi then 'plataforma' else 'fonte' end, 2 from public.leiloeiro_telefone t
      cross join lateral (select public.fonte_multi_tenant(upper(p_fonte)) multi) m
     where t.fonte = upper(p_fonte) and t.leiloeiro_chave = ''
  ) x order by x.ord, x.whatsapp desc limit 1
$$;
