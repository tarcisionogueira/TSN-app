-- ============================================================================
-- LIBERAÇÃO DE MÓDULO POR PRAZO — com PISO DE DATA (01/09)
--
-- PEDIDO DO DONO: "módulo 2 liberado após 3 dias, módulo 3 após 7 dias… assim
-- consigo gravar as primeiras aulas e lançar mesmo sem ter terminado de gravar."
--
-- ⚠️ E É AQUI QUE O PRAZO SOZINHO NÃO RESOLVE O PROBLEMA QUE ELE DESCREVEU.
-- "3 dias depois" é contado a partir de QUANDO O ALUNO COMEÇA. Um aluno que entra
-- hoje abre o módulo 3 daqui a 7 dias — esteja ele gravado ou não. E um aluno que
-- entra daqui a um mês abre em 7 dias contados de lá. Ou seja: o prazo dá RITMO,
-- mas não protege o lançamento; ele só empurra o problema para o próximo aluno.
--
-- Por isso são DOIS controles, e o módulo abre quando os DOIS já passaram:
--   `libera_apos_dias` — ritmo: X dias depois de o ALUNO começar o curso.
--   `libera_em`        — piso: não abre para NINGUÉM antes desta data.
-- O piso é o que deixa lançar sem ter terminado de gravar; o prazo é o que faz o
-- aluno consumir na ordem. Um sem o outro deixa um buraco: só prazo expõe módulo
-- vazio, só data faz todo mundo receber tudo de uma vez no dia D.
--
-- MÓDULO SEM REGRA CONTINUA ABERTO. Curso que já existe não muda de comportamento
-- por causa desta migração — a ausência de linha significa "liberado", não
-- "bloqueado". Fechar por omissão trancaria, calado, todo o acervo publicado.
-- ============================================================================

create table if not exists public.curso_modulos (
  id                uuid primary key default gen_random_uuid(),
  curso_id          uuid not null references public.cursos_admin(id) on delete cascade,
  modulo            text not null,               -- casa com aulas_admin.modulo
  libera_apos_dias  int  not null default 0 check (libera_apos_dias between 0 and 3650),
  libera_em         date,                        -- piso absoluto; null = sem piso
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now()
);

create unique index if not exists curso_modulos_unico on public.curso_modulos (curso_id, modulo);

alter table public.curso_modulos enable row level security;

-- Mesma forma de `aulas_admin`: admin gerencia, leitura é pública. A REGRA de
-- liberação não é segredo — é cronograma, e mostrá-lo ("abre em 3 dias") é parte
-- do produto. O que precisa ficar guardado é o CONTEÚDO, não o calendário.
create policy "Admin gerencia modulos" on public.curso_modulos for all
  using (exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin'));
create policy "Leitura publica modulos" on public.curso_modulos for select using (true);

comment on table public.curso_modulos is
  'Regra de liberação por módulo. libera_apos_dias = ritmo (dias após o aluno começar); '
  'libera_em = piso absoluto (não abre antes desta data, para ninguém). Abre quando os DOIS passaram. '
  'Módulo sem linha aqui está liberado.';

-- ─── Quando o relógio do aluno começa ────────────────────────────────────────
-- Sem esta marca não há de onde contar "3 dias depois". Usar a data da CONTA
-- seria errado (quem se cadastrou em junho abriria o curso inteiro de uma vez) e
-- usar o primeiro `aula_progresso` também (quem abre o curso e não clica em nada
-- nunca teria marco, e o módulo 2 não abriria nunca).
create table if not exists public.curso_acesso (
  user_id     uuid not null references public.perfis(id) on delete cascade,
  curso_id    uuid not null references public.cursos_admin(id) on delete cascade,
  iniciado_em timestamptz not null default now(),
  primary key (user_id, curso_id)
);

alter table public.curso_acesso enable row level security;
create policy "aluno le o proprio acesso" on public.curso_acesso for select
  using ((select auth.uid()) = user_id);

comment on table public.curso_acesso is
  'Quando cada aluno começou cada curso. É o marco a partir do qual curso_modulos.libera_apos_dias conta.';

-- ─── O estado dos módulos para o aluno que está chamando ─────────────────────
-- VOLATILE de propósito: a primeira chamada CARIMBA o início do aluno. É o único
-- lugar onde esse carimbo pode nascer sem depender de o aluno clicar em algo.
create or replace function public.curso_modulos_liberacao(p_curso uuid)
returns table (modulo text, liberado boolean, abre_em timestamptz, libera_apos_dias int)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_user uuid := auth.uid(); v_inicio timestamptz;
begin
  if v_user is null then
    raise exception 'sem sessao' using errcode = '28000';
  end if;

  insert into public.curso_acesso (user_id, curso_id)
       values (v_user, p_curso)
  on conflict (user_id, curso_id) do nothing;

  select ca.iniciado_em into v_inicio
    from public.curso_acesso ca
   where ca.user_id = v_user and ca.curso_id = p_curso;

  return query
  -- Os módulos vêm de `aulas_admin`, que é a fonte da verdade sobre quais existem;
  -- `curso_modulos` só acrescenta a regra. Assim um módulo criado hoje aparece
  -- liberado, em vez de sumir por não ter linha de regra.
  with mods as (
    select distinct coalesce(a.modulo, 'Módulo 1') as m
      from public.aulas_admin a where a.curso_id = p_curso
  )
  select mods.m,
         now() >= greatest(v_inicio + make_interval(days => coalesce(cm.libera_apos_dias, 0)),
                           coalesce(cm.libera_em::timestamptz, '-infinity'::timestamptz)),
         greatest(v_inicio + make_interval(days => coalesce(cm.libera_apos_dias, 0)),
                  coalesce(cm.libera_em::timestamptz, '-infinity'::timestamptz)),
         coalesce(cm.libera_apos_dias, 0)
    from mods
    left join public.curso_modulos cm on cm.curso_id = p_curso and cm.modulo = mods.m;
end $$;

-- Quem chama é o ALUNO logado, então `authenticated` precisa executar. `anon` não:
-- visitante sem sessão não tem relógio para começar, e a função lança nesse caso.
-- Revogar dos três antes de conceder — o Supabase concede a anon e authenticated
-- por default privilege, e `revoke ... from public` não tira grant de papel.
revoke all on function public.curso_modulos_liberacao(uuid) from public, anon, authenticated;
grant execute on function public.curso_modulos_liberacao(uuid) to authenticated, service_role;
