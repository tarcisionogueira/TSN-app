-- O CLIENTE 360 PASSA A ENXERGAR O PRÉ-LOGIN (pedido do dono, 12/08).
-- Aplicada em produção em 12/08.
--
-- O QUE FALTAVA — e a resposta é que NÃO faltava coleta, faltava LEITURA:
--   · `eventos_atividade` já grava o pré-login: 1.162 eventos, TODOS com `anon_id` (zero sem).
--   · 4.316 eventos JÁ LOGADOS também carregam o `anon_id` da mesma sessão de navegador.
--   · Cruzando os dois, 22 anon_ids aparecem antes E depois do cadastro → 19 dos 39 usuários
--     têm a jornada pré-conta reconstruível hoje.
-- Só que `atividade_navegacao` filtrava `user_id = p_user_id` e ponto. Tudo que a pessoa fez
-- antes de existir como usuário ficava invisível no 360, apesar de gravado. Dado coletado e
-- não usado é a forma mais barata de desperdício — e a mais difícil de perceber.
--
-- `pre_login` marca cada evento para a tela separar as fases. Sem essa marca a linha do tempo
-- misturaria "antes de se cadastrar" com "depois", sugerindo que a pessoa já era usuária
-- quando ainda estava decidindo — que é justamente a informação de valor aqui.
--
-- O DEFAULT do 2º parâmetro é preservado (`p_limite integer default 200`): recriar sem ele
-- quebraria qualquer chamador que omita o argumento.
drop function if exists public.atividade_navegacao(uuid, integer);

create function public.atividade_navegacao(p_user_id uuid, p_limite integer default 200)
returns jsonb
language sql
security definer
set search_path = public, pg_catalog
stable
as $$
  with anons as (
    -- Identificadores de navegador que ESTE usuário já usou estando logado. É a única ligação
    -- legítima entre a sessão anônima e a pessoa; sem um evento logado carregando o anon_id
    -- não há ponte, e a função devolve só o pós-login, exatamente como antes.
    select distinct anon_id from public.eventos_atividade
     where user_id = p_user_id and coalesce(anon_id,'') <> ''
  )
  select coalesce(jsonb_agg(x), '[]'::jsonb) from (
    select e.tipo, e.rota, e.alvo, e.detalhe, e.criado_em,
           (e.user_id is null) as pre_login
      from public.eventos_atividade e
     where e.user_id = p_user_id
        or (e.user_id is null and e.anon_id in (select anon_id from anons))
     order by e.criado_em desc
     limit greatest(1, least(p_limite, 5000))
  ) x;
$$;

revoke all on function public.atividade_navegacao(uuid, integer) from public, anon;
grant execute on function public.atividade_navegacao(uuid, integer) to authenticated, service_role;

-- Sem este índice o filtro por anon_id varre a tabela inteira a cada abertura do 360, e essa
-- tabela só cresce.
create index if not exists eventos_atividade_anon_idx
  on public.eventos_atividade (anon_id, criado_em desc) where anon_id is not null;
