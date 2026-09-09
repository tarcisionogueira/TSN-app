-- 09/09: achado ao vivo — Tarcisio e Joao Paulo se indicando um ao outro travava o navegador
-- (MinhaRede.jsx monta a arvore de indicacao por parent_id sem saber que nao era uma arvore de
-- verdade — dois parceiros indicando um ao outro faz o render recursivo entrar num la-e-volta
-- sem fim). O caso real ja foi corrigido (perfis.indicado_por do Tarcisio virou NULL — ele e o
-- admin/raiz, e o outro lado da indicacao era cronologicamente impossivel: sua conta e de
-- 16/06, a de Joao Paulo so existe desde 14/08). Mas o campo continua livre pra qualquer fluxo
-- futuro recriar um ciclo — este invariante e a rede de seguranca.
create or replace function public.qa_invariante_indicacao_ciclica()
returns bigint language sql stable set search_path to 'public' as $$
  with recursive cadeia as (
    select id, indicado_por, array[id] as caminho, false as ciclo
    from perfis
    union all
    select c.id, f.indicado_por, c.caminho || f.indicado_por, f.indicado_por = any(c.caminho)
    from cadeia c
    join perfis f on f.id = c.indicado_por
    where not c.ciclo and c.indicado_por is not null
  )
  select count(distinct id)::bigint from cadeia where ciclo;
$$;

-- E o registro em qa_invariantes() — mesmo padrão de qa_invariante_live_numeros_congelados.sql:
-- reescrita por âncora no texto ao vivo da função (ela é grande demais pra colar por inteiro
-- com segurança), idempotente, reproduz o mesmo efeito num banco novo.
do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='qa_invariantes';
  alvo := E'(select count(*) from perfis where coalesce(role,\'\')=\'\'), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('indicacao_ciclica' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (\'indicacao_ciclica\',\'Indicacao circular (A indica B e B indica A) trava a arvore de MinhaRede\',\'Conta\',\'bug\',\n       public.qa_invariante_indicacao_ciclica(), 0)';
  execute replace(d, alvo, novo);
end $do$;
