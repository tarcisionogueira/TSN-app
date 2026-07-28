-- ESCALA (rumo a 10k): otimização oficial do Supabase para o lint auth_rls_initplan.
-- Envolve auth.uid()/auth.role()/auth.jwt()/auth.email() em (select ...) dentro das
-- políticas RLS, para o Postgres avaliar a função UMA vez por query (InitPlan) em vez de
-- POR LINHA. É SEMANTICAMENTE IDÊNTICO (o subselect escalar devolve o mesmo valor) — não
-- muda quem enxerga o quê, só o plano de execução.
--
-- Transformação em 2 passos (idempotente): (1) desembrulha (select auth.x()) → auth.x();
-- (2) embrulha auth.x() → (select auth.x()). Só faz ALTER nas políticas cujo texto MUDA.
-- Atômico: qualquer erro aborta o bloco inteiro (rollback), sem estado parcial.
-- Verificado: dry-run bateu fiel; nenhuma política usa current_setting.
do $$
declare
  r record; v_using text; v_check text; v_sql text; v_changed boolean;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies where schemaname = 'public'
  loop
    v_changed := false;
    v_sql := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    if r.qual is not null then
      v_using := regexp_replace(
        regexp_replace(r.qual, '\(\s*select\s+(auth\.(uid|role|jwt|email)\(\))\s*\)', '\1', 'gi'),
        '(auth\.(uid|role|jwt|email)\(\))', '(select \1)', 'g');
      if v_using <> r.qual then v_changed := true; end if;
      v_sql := v_sql || ' USING (' || v_using || ')';
    end if;
    if r.with_check is not null then
      v_check := regexp_replace(
        regexp_replace(r.with_check, '\(\s*select\s+(auth\.(uid|role|jwt|email)\(\))\s*\)', '\1', 'gi'),
        '(auth\.(uid|role|jwt|email)\(\))', '(select \1)', 'g');
      if v_check <> r.with_check then v_changed := true; end if;
      v_sql := v_sql || ' WITH CHECK (' || v_check || ')';
    end if;
    if v_changed then execute v_sql; end if;
  end loop;
end $$;
