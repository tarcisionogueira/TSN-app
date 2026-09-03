-- ══════════════════════════════════════════════════════════════════════════════════════
-- DOIS SINAIS QUE CONFUNDIAM COISAS DIFERENTES (03/09).
-- ══════════════════════════════════════════════════════════════════════════════════════
-- (Aplicado no banco em duas migrações; consolidado aqui para que um banco novo reproduza
--  o mesmo estado — forma nº 7 do CLAUDE.md, nas duas direções.)
--
-- ── 1. `leiloeiro_integrado` não sabia dizer "não sei" ─────────────────────────────────
-- Era boolean com default false. Quando a lista de leiloeiros do acervo não podia ser lida,
-- TODO edital saía "leiloeiro a integrar" — inclusive gente que a gente raspa todo dia — e o
-- backlog de aquisição passava a mentir sem dar erro. "Conferi e não casa" e "não consegui
-- conferir" pedem ações opostas.
--
-- ⚠️ E o tri-state SÓ é seguro porque a RPC do painel mudou junto: `count(*) filter (where
-- not leiloeiro_integrado)` NÃO conta NULL, e `count(*) filter (where leiloeiro_integrado)`
-- também não — a linha sumiria das DUAS contagens e a soma deixaria de bater com o total, em
-- silêncio. Introduzir o nulo sem tocar no consumidor seria cometer, no conserto, o defeito
-- que ele veio consertar.
--
-- ── 2. Combo que cai não é run que falha ───────────────────────────────────────────────
-- `monitor_runs.erro` é lido pelo freio da rede de segurança (`erro is null`) e pelo
-- invariante `radar_editais_sem_pull`. Qualquer combo (tribunal × termo) com problema
-- sobrescrevia `erroGeral` e reprovava o run inteiro. O run de 29/08 18:53 trouxe 98 editais
-- novos, viu 2.093 itens, e foi carimbado FALHA por 1 combo em 12 — e como é esse insert que
-- o freio lê, o residencial coletava de graça, o log dizia que não, e o Bright Data era
-- chamado para refazer. Com 27 tribunais isso vira regra, não exceção.

alter table public.editais_leilao alter column leiloeiro_integrado drop default;

comment on column public.editais_leilao.leiloeiro_integrado is
  'true = casa com leiloeiro do acervo; false = conferido e NAO casa; NULL = nao foi possivel conferir (lista de leiloeiros indisponivel).';

alter table public.monitor_runs add column if not exists aviso text;

comment on column public.monitor_runs.aviso is
  'Desfecho PARCIAL de um run que deu certo (ex.: 11 de 12 combos responderam). Fica FORA de `erro` de proposito.';

-- A RPC do painel, com as TRÊS contagens (ver o aviso acima).
create or replace function public.admin_radar_editais(p_dias integer default 30, p_so_nao_integrado boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $fn$
declare v_role text;
begin
  select role into v_role from public.perfis where id = auth.uid();
  if v_role is distinct from 'admin' then raise exception 'apenas admin'; end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'kpis', (
      select jsonb_build_object(
        'total', count(*),
        'novos_7d', count(*) filter (where data_disponibilizacao > (now()-interval '7 days')::date),
        'leiloeiros_distintos', count(distinct leiloeiro_nome_norm),
        'nao_integrados', count(*) filter (where leiloeiro_integrado is false),
        'ja_no_acervo', count(*) filter (where leiloeiro_integrado is true),
        'nao_conferidos', count(*) filter (where leiloeiro_integrado is null),
        'sem_leiloeiro', count(*) filter (where leiloeiro_nome is null),
        'erro_parse', count(*) filter (where status = 'erro_parse')
      )
      from public.editais_leilao
      where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
    ),
    'editais', coalesce((
      select jsonb_agg(to_jsonb(e) - 'texto_integral' - 'payload' order by e.data_disponibilizacao desc, e.criado_em desc)
      from (
        select * from public.editais_leilao
        where data_disponibilizacao > (now() - (p_dias || ' days')::interval)::date
          and (not p_so_nao_integrado or leiloeiro_integrado is not true)
        order by data_disponibilizacao desc, criado_em desc
        limit 300
      ) e
    ), '[]'::jsonb)
  );
end $fn$;
revoke execute on function public.admin_radar_editais(integer, boolean) from public, anon;
grant execute on function public.admin_radar_editais(integer, boolean) to authenticated;

-- O vigia da regressão do cruzamento.
create or replace function public.qa_invariante_editais_cruzamento_cego()
returns bigint language sql stable security definer set search_path to 'public'
as $fn$
  select count(*)::bigint from public.editais_leilao
   where leiloeiro_nome is not null and leiloeiro_integrado is null;
$fn$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='qa_invariantes';
  alvo := E'public.qa_invariante_radar_editais_sem_pull(), 2)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('editais_cruzamento_cego' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''editais_cruzamento_cego'',''Edital com leiloeiro nomeado que nao pode ser cruzado com o acervo'',''Captura'',''bug'',\n       public.qa_invariante_editais_cruzamento_cego(), 0)';
  execute replace(d, alvo, novo);
end $do$;
