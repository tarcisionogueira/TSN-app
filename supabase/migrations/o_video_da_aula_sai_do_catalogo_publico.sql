-- ============================================================================
-- O VÍDEO SAI DO CATÁLOGO PÚBLICO (03/09) — combinado com o dono em 01/09,
-- para depois da aula de 02/09. A aula aconteceu; esta é a hora.
--
-- O PROBLEMA. `aulas_admin` tem policy `"Leitura publica aulas" (SELECT true)` e
-- isso inclui `video_url`. A liberação de módulo que subiu em 01/09 era, por
-- isso, apenas de INTERFACE: quem abrisse o devtools listava a URL de qualquer
-- aula, de qualquer módulo, pagando ou não.
--
-- ⚠️ POR QUE NÃO É RLS. RLS é por LINHA. O que precisa sair não é a linha — o
-- catálogo (título, módulo, duração, grátis) TEM de continuar público, porque é
-- dele que vivem a loja, a landing de produto e a área de membros. O que precisa
-- sair é uma COLUNA. Para isso existe grant por coluna, e é o que se usa aqui.
--
-- BOM MOMENTO PARA FAZER: hoje só existe um curso (`Comece aqui`), e ele é
-- `gratuito = true` — ou seja, todo mundo passa no portão de qualquer jeito. O
-- raio de explosão desta mudança é praticamente zero, e é justamente por isso
-- que ela deve ser feita agora, e não quando houver conteúdo pago a proteger.
-- ============================================================================

-- ─── 1. A coluna sai da leitura pública ──────────────────────────────────────
revoke select (video_url) on public.aulas_admin from anon, authenticated;

comment on column public.aulas_admin.video_url is
  'NÃO é legível por anon/authenticated (grant de coluna revogado em 03/09). Quem entrega esta '
  'URL para o aluno é a RPC public.aula_video(uuid), que confere plano E liberação do módulo. '
  'O admin continua lendo pela policy "Admin gerencia aulas".';

-- ─── 2. Quem pode assistir — a regra que vivia só no cliente ─────────────────
-- Porte fiel de `podeAssistir(licao, plano, comprouAvulso, planosGratis, cursoGratuito)`
-- de `src/pages/Curso.jsx`, na MESMA ordem de precedência.
--
-- ⚠️ DOIS TIPOS QUE EU SUPUS ERRADO E O SCHEMA CORRIGIU antes de aplicar:
-- `cursos_admin.planos_gratis` é `text[]` (não jsonb — nada de operador `?`), e
-- `compras_produtos.produto_id` é `uuid` (não text — o `::text` que eu tinha
-- escrito comparava tipos diferentes). É a forma #6 desta base: conferir a
-- coluna no schema em vez de deduzir do nome.
--
-- ⚠️ UMA DIFERENÇA DELIBERADA, e ela é conserto de um furo latente: a lista
-- `PLANOS_PAGOS` do cliente NÃO inclui `top2_anual`, `assessorado_anual` nem
-- `clube_anual`. Hoje ninguém usa esses papéis (a base é explorador 101 · top2 4
-- · assessorado 2 · admin 1), então o furo está dormindo — mas no dia em que
-- existir o primeiro assinante ANUAL, ele seria barrado do curso que pagou. No
-- cliente isso era um cadeado indevido na tela; aqui passaria a ser o servidor
-- recusando o vídeo, que é pior. Os `_anual` entram.
create or replace function public.aula_pode_assistir(p_aula uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with a as (
    select al.id, al.curso_id, coalesce(al.gratis, false) as gratis
      from public.aulas_admin al where al.id = p_aula
  ),
  c as (
    select cu.id, coalesce(cu.gratuito, false) as gratuito,
           coalesce(cu.planos_gratis, '{}'::text[]) as planos_gratis
      from public.cursos_admin cu join a on a.curso_id = cu.id
  ),
  u as (select p.role from public.perfis p where p.id = p_user)
  select case
    when not exists (select 1 from a) then false          -- aula inexistente
    when (select gratuito from c) then true               -- curso marcado gratuito
    when (select gratis from a)   then true               -- amostra grátis
    when exists (select 1 from public.compras_produtos cp  -- comprou avulso
                  where cp.user_id = p_user and cp.produto_tipo = 'curso'
                    and cp.produto_id = (select curso_id from a)
                    and cp.status = 'ativo') then true
    when (select role from u) in ('top2','top2_anual','assessorado','assessorado_anual',
                                  'clube','clube_anual','analista','consultor','advogado','admin')
      then true
    -- `= any (c.planos_gratis)` com a COLUNA, não com um subselect: `any (select …)`
    -- é semântica de LINHAS e o Postgres recusa (text = text[]). Referenciar a
    -- coluna dentro de um EXISTS devolve a semântica de array que se quer aqui.
    when exists (select 1 from c where (select role from u) = any (c.planos_gratis)) then true
    -- O caso especial que o cliente já tratava: quem é `top2` entra por um curso
    -- liberado para `top2_anual`.
    when (select role from u) = 'top2'
         and exists (select 1 from c where 'top2_anual' = any (c.planos_gratis)) then true
    else false
  end;
$$;

-- ─── 3. A entrega do vídeo ───────────────────────────────────────────────────
-- Devolve o MOTIVO junto, e não só um nulo: "você não tem acesso", "o módulo
-- abre depois" e "esta aula não tem vídeo" mandam o aluno fazer coisas
-- diferentes, e um nulo mudo faria a tela dizer a mesma coisa para os três.
create or replace function public.aula_video(p_aula uuid)
returns table (video_url text, motivo text, abre_em timestamptz)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_curso  uuid;
  v_modulo text;
  v_url    text;
  v_inicio timestamptz;
  v_abre   timestamptz;
begin
  -- Sem sessão não há vídeo. Não é rigor: o portão inteiro depende de saber QUEM
  -- está pedindo, e responder a um anônimo seria reabrir o buraco que a coluna
  -- revogada acabou de fechar.
  if v_user is null then
    return query select null::text, 'sem_sessao', null::timestamptz; return;
  end if;

  select a.curso_id, coalesce(a.modulo, 'Módulo 1'), a.video_url
    into v_curso, v_modulo, v_url
    from public.aulas_admin a where a.id = p_aula;

  if v_curso is null then
    return query select null::text, 'aula_inexistente', null::timestamptz; return;
  end if;

  if not public.aula_pode_assistir(p_aula, v_user) then
    return query select null::text, 'sem_acesso', null::timestamptz; return;
  end if;

  -- Liberação do módulo. Sem marco de início o aluno é tratado como quem começa
  -- AGORA — o que tranca módulo com prazo, que é o certo: quem nunca abriu o
  -- curso não pode pular a fila. Na prática a tela chama
  -- `curso_modulos_liberacao` ao carregar, então o marco já existe quando o play
  -- acontece.
  select ca.iniciado_em into v_inicio
    from public.curso_acesso ca where ca.user_id = v_user and ca.curso_id = v_curso;
  v_inicio := coalesce(v_inicio, now());

  select greatest(v_inicio + make_interval(days => coalesce(cm.libera_apos_dias, 0)),
                  coalesce(cm.libera_em::timestamptz, '-infinity'::timestamptz))
    into v_abre
    from public.curso_modulos cm
   where cm.curso_id = v_curso and cm.modulo = v_modulo;

  if v_abre is not null and now() < v_abre then
    return query select null::text, 'modulo_nao_liberado', v_abre; return;
  end if;

  if coalesce(v_url, '') = '' then
    return query select null::text, 'sem_video', null::timestamptz; return;
  end if;

  return query select v_url, 'ok'::text, null::timestamptz;
end $$;

-- Quem chama é o ALUNO logado. `anon` fica de fora — a função já recusaria por
-- falta de sessão, mas não se deixa exposta uma DEFINER que lê `video_url` para
-- quem não precisa dela. Revogar dos três antes: o Supabase concede a `anon` e
-- `authenticated` por default privilege, e `revoke ... from public` não tira
-- grant de papel. Conferir `pg_proc.proacl` depois de aplicar.
revoke all on function public.aula_video(uuid)             from public, anon, authenticated;
revoke all on function public.aula_pode_assistir(uuid, uuid) from public, anon, authenticated;
grant execute on function public.aula_video(uuid) to authenticated, service_role;
grant execute on function public.aula_pode_assistir(uuid, uuid) to service_role;

-- ============================================================================
-- ⚠️ ADENDO (aplicado logo em seguida, em migração própria:
-- `video_url_grant_de_coluna_nao_vence_grant_de_tabela.sql`)
--
-- O `revoke select (video_url)` acima BLOQUEOU o `anon` e NÃO bloqueou o
-- `authenticated`. Medir foi o único jeito de descobrir: `anon` já tinha grant
-- por COLUNA, mas `authenticated` detinha SELECT na TABELA INTEIRA — e em
-- Postgres um grant de tabela cobre toda coluna, presente e futura. Revogar uma
-- coluna de quem tem a tabela é um no-op silencioso.
--
-- É a TERCEIRA vez em três dias que a mesma família de armadilha aparece nesta
-- base: revoke de `anon` com o grant no PUBLIC (31/08), revoke do PUBLIC com o
-- grant em papel (31/08), e agora revoke de coluna com grant de tabela. A
-- assinatura é sempre a mesma — o comando "funciona", não muda nada, e só reler
-- o ACL prova. Nunca dar um revoke por feito sem conferir depois.
-- ============================================================================
