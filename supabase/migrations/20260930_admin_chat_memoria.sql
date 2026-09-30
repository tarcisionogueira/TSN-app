-- 30/09 — MEMÓRIA DO CHAT OPERACIONAL (Admin → Operacional → CNJ). Pedido do dono: "um agente que
-- aprenda com as perguntas, pois em operações de leilão elas são similares".
-- Até hoje a conversa vivia só no estado da tela (sumia ao recarregar) — nem o dono nem a IA podiam
-- reaproveitar o caminho que já tinha dado certo. Agora cada troca fica aqui com o RASTRO de
-- ferramentas (qual consulta respondeu, com qual entrada), e a próxima pergunta parecida recebe esses
-- casos no prompt (recuperação por texto em português — sem treinar modelo, custo ~zero).
-- 👍/👎 do admin: 👍 vira exemplo prioritário; 👎 nunca é reaproveitado.
-- Só o servidor lê/escreve (RLS ligada, sem política; funções só para service_role).
create table if not exists public.admin_chat_memoria (
  id          uuid primary key default gen_random_uuid(),
  criado_em   timestamptz not null default now(),
  user_id     uuid,
  sessao      text,
  pergunta    text not null,
  resposta    text,
  ferramentas jsonb not null default '[]'::jsonb,
  util        boolean,
  busca       tsvector generated always as (to_tsvector('portuguese', coalesce(pergunta, ''))) stored
);
create index if not exists admin_chat_memoria_busca_idx on public.admin_chat_memoria using gin (busca);
create index if not exists admin_chat_memoria_criado_idx on public.admin_chat_memoria (criado_em desc);
alter table public.admin_chat_memoria enable row level security;
revoke all on public.admin_chat_memoria from anon, authenticated;

-- Casos parecidos: casa por QUALQUER termo relevante (OR), ranqueia por semelhança, 👍 primeiro,
-- nunca 👎, só os que tiveram resposta.
create or replace function public.admin_chat_casos_parecidos(p_texto text, p_limite int default 4)
returns table (id uuid, pergunta text, resposta text, ferramentas jsonb, util boolean, criado_em timestamptz)
language sql stable security definer set search_path to 'public' as $$
  with q as (
    select to_tsquery('portuguese', string_agg(lexeme, ' | ')) tq
      from unnest(to_tsvector('portuguese', coalesce(p_texto, ''))) u
  )
  select m.id, m.pergunta, left(m.resposta, 600), m.ferramentas, m.util, m.criado_em
    from admin_chat_memoria m, q
   where q.tq is not null and m.busca @@ q.tq
     and coalesce(m.util, true) and m.resposta is not null
   order by (m.util is true) desc, ts_rank(m.busca, q.tq) desc, m.criado_em desc
   limit greatest(1, least(coalesce(p_limite, 4), 8));
$$;
revoke all on function public.admin_chat_casos_parecidos(text, int) from public, anon, authenticated;
grant execute on function public.admin_chat_casos_parecidos(text, int) to service_role;
