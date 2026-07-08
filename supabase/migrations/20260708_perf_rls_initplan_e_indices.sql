-- Performance/custo (advisors Supabase). Tudo idempotente e semanticamente neutro.
--
-- 1) auth_rls_initplan: envolve auth.uid()/role()/jwt()/email() e os helpers STABLE
--    (app_role/is_admin/is_equipe) em (select ...) dentro das policies. Assim o
--    Postgres avalia a função UMA vez por query em vez de UMA vez por linha — mesmo
--    resultado, muito menos CPU em tabelas grandes (imoveis, perfis, contratos...).
--    Só reescreve policies ainda NÃO envolvidas em (select ...); rodar de novo é no-op.
do $$
declare r record; nq text; nc text; stmt text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check
      from pg_policies
     where schemaname = 'public'
       and (coalesce(qual,'')       ~ 'auth\.(uid|role|jwt|email)\(\)'
            or coalesce(with_check,'') ~ 'auth\.(uid|role|jwt|email)\(\)')
       and coalesce(qual,'')       !~ '\(\s*SELECT'
       and coalesce(with_check,'') !~ '\(\s*SELECT'
  loop
    nq := r.qual; nc := r.with_check;
    if nq is not null then
      nq := regexp_replace(nq, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
      nq := regexp_replace(nq, '(^|[^.a-z_])(app_role|is_admin|is_equipe)\(\)', '\1(select \2())', 'g');
    end if;
    if nc is not null then
      nc := regexp_replace(nc, 'auth\.(uid|role|jwt|email)\(\)', '(select auth.\1())', 'g');
      nc := regexp_replace(nc, '(^|[^.a-z_])(app_role|is_admin|is_equipe)\(\)', '\1(select \2())', 'g');
    end if;
    stmt := format('ALTER POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    if nq is not null then stmt := stmt || ' USING (' || nq || ')'; end if;
    if nc is not null then stmt := stmt || ' WITH CHECK (' || nc || ')'; end if;
    execute stmt;
  end loop;
end $$;

-- 2) unindexed_foreign_keys: índice de cobertura nas FKs (evita seq scan em join /
--    ON DELETE do pai). Barato agora que as tabelas ainda são pequenas.
CREATE INDEX IF NOT EXISTS idx_arrematado_lancamentos_user_id ON public.arrematado_lancamentos (user_id);
CREATE INDEX IF NOT EXISTS idx_convites_vendedor_criado_por   ON public.convites_vendedor   (criado_por);
CREATE INDEX IF NOT EXISTS idx_juridico_aprendizado_caso_id   ON public.juridico_aprendizado (caso_id);
CREATE INDEX IF NOT EXISTS idx_laudo_aprendizado_criado_por   ON public.laudo_aprendizado   (criado_por);
CREATE INDEX IF NOT EXISTS idx_mercado_aprendizado_criado_por ON public.mercado_aprendizado (criado_por);
CREATE INDEX IF NOT EXISTS idx_processos_monitorados_caso_id  ON public.processos_monitorados (caso_id);
CREATE INDEX IF NOT EXISTS idx_reembolsos_garantia_user_id    ON public.reembolsos_garantia (user_id);

-- 3) duplicate_index: config_financeira tem UNIQUE(gateway) além da PK(gateway).
--    A PK já garante a unicidade; a constraint extra só custa escrita/armazenamento.
ALTER TABLE public.config_financeira DROP CONSTRAINT IF EXISTS config_financeira_gateway_key;
