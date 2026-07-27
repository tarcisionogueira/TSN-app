-- Rastreamento de atividade do usuário (pedido do dono): registra navegação (telas), cliques
-- em elementos interativos e falhas de API — para encontrar possíveis falhas no Cliente 360.
-- Vale para CLIENTES, PARCEIROS e EQUIPE (é por user_id, independente do papel).
-- Economia: escrita só pelo servidor (service_role, user_id do token), teto por sessão no
-- cliente, e retenção de 30 dias (limpar-eventos-cron).
create table if not exists public.eventos_atividade (
  id        bigint generated always as identity primary key,
  user_id   uuid,
  tipo      text not null,          -- 'pageview' | 'click' | 'api_erro'
  rota      text,                   -- rota (hash/path) onde ocorreu
  alvo      text,                   -- rótulo do elemento clicado / endpoint da API
  detalhe   text,                   -- extra (ex.: status HTTP, texto do alvo)
  role      text,                   -- papel no momento (cliente/parceiro/equipe)
  criado_em timestamptz not null default now()
);
create index if not exists idx_eventos_atividade_user   on public.eventos_atividade(user_id, criado_em desc);
create index if not exists idx_eventos_atividade_criado on public.eventos_atividade(criado_em);

-- RLS ligada e SEM policy para authenticated/anon → ninguém acessa direto; só o service_role
-- (que ignora RLS) escreve pelo /api/track e lê pela RPC do Cliente 360.
alter table public.eventos_atividade enable row level security;

-- Leitura para o Cliente 360 (só admin/analista chamam via o endpoint com service_role).
create or replace function public.atividade_navegacao(p_user_id uuid, p_limite int default 80)
returns jsonb language sql security definer set search_path = public as $$
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select tipo, rota, alvo, detalhe, criado_em
    from public.eventos_atividade
    where user_id = p_user_id
    order by criado_em desc
    limit greatest(1, least(p_limite, 300))
  ) x;
$$;
revoke all on function public.atividade_navegacao(uuid,int) from public, anon, authenticated;
grant execute on function public.atividade_navegacao(uuid,int) to service_role;
