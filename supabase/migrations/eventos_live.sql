-- ─────────────────────────────────────────────────────────────────────────────
-- AULA AO VIVO: evento + inscrição  (26/08/2026)
--
-- A landing de captação do lançamento. O inscrito vira USUÁRIO da plataforma no mesmo
-- ato — foi por isso que não usamos a página da Hotmart: lead que fica só na lista de
-- e-mail do fornecedor nunca vira cliente daqui, e o nosso rastreio de origem não o
-- alcança.
--
-- ATRITO: pede nome, e-mail e WhatsApp. NÃO pede senha. Cada campo a mais numa página de
-- inscrição derruba conversão, e senha é o pior deles — a conta nasce com senha aleatória
-- e a pessoa recebe o link para defini-la junto com a confirmação.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.eventos_live (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,          -- /live/{slug}
  titulo       text not null,
  subtitulo    text,
  descricao    text,
  -- Quando acontece. `data_hora` é timestamptz: a contagem regressiva na tela é calculada
  -- no fuso de quem olha, e evento marcado em horário "solto" erra por 3h para quem está
  -- em outro estado.
  data_hora    timestamptz not null,
  duracao_min  int default 90,
  link_sala    text,                          -- Google Meet; só vai para quem se inscreveu
  link_grupo   text,                          -- grupo de WhatsApp, mostrado na confirmação
  capa_url     text,
  cor          text default '#0D63DB',
  vagas_max    int,                           -- nulo = sem limite
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

create table if not exists public.live_inscricoes (
  id         uuid primary key default gen_random_uuid(),
  evento_id  uuid not null references public.eventos_live(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  nome       text not null,
  email      text not null,
  whatsapp   text,
  -- De onde veio. Sem isto o lançamento inteiro vira "não sei o que funcionou": é este
  -- campo que separa o que o Instagram trouxe do que o anúncio trouxe.
  origem     text,
  utm        jsonb not null default '{}'::jsonb,
  compareceu boolean,                          -- preenchido depois da aula
  criado_em  timestamptz not null default now(),
  -- Um e-mail se inscreve UMA vez por evento. Sem isto, quem clica duas vezes no botão
  -- aparece como dois inscritos e a taxa de comparecimento sai menor do que foi.
  unique (evento_id, email)
);

create index if not exists idx_live_inscricoes_evento on public.live_inscricoes(evento_id);
create index if not exists idx_eventos_live_slug on public.eventos_live(slug) where ativo;

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table public.eventos_live   enable row level security;
alter table public.live_inscricoes enable row level security;

-- O evento é público POR DEFINIÇÃO (é uma landing aberta), mas só o que está ativo, e
-- `link_sala` sai desta leitura pela view abaixo: quem não se inscreveu não recebe o
-- endereço da sala.
drop policy if exists eventos_live_publico on public.eventos_live;
create policy eventos_live_publico on public.eventos_live
  for select to anon, authenticated using (ativo);

-- Inscrição NÃO é legível pelo público: é lista de gente com telefone e e-mail. Só o
-- servidor (service key, que ignora RLS) escreve, e o dono lê pelo painel.
drop policy if exists live_inscricoes_dono on public.live_inscricoes;
create policy live_inscricoes_dono on public.live_inscricoes
  for select to authenticated using (user_id = auth.uid());

-- ── A sala só para quem se inscreveu ─────────────────────────────────────────
-- Publicar `link_sala` na tela aberta é entregar a aula a quem não deixou contato — e
-- perder exatamente o que a landing existe para capturar.
create or replace function public.live_sala(p_slug text)
returns text language sql stable security definer set search_path to 'public' as $$
  select e.link_sala from eventos_live e
   where e.slug = p_slug and e.ativo
     and exists (select 1 from live_inscricoes i
                  where i.evento_id = e.id and i.user_id = auth.uid());
$$;

revoke all on function public.live_sala(text) from public, anon;
grant execute on function public.live_sala(text) to authenticated;

-- ── Contagem de inscritos, sem expor a lista ─────────────────────────────────
create or replace function public.live_inscritos(p_slug text)
returns int language sql stable security definer set search_path to 'public' as $$
  select count(*)::int from live_inscricoes i
    join eventos_live e on e.id = i.evento_id
   where e.slug = p_slug and e.ativo;
$$;

grant execute on function public.live_inscritos(text) to anon, authenticated;
