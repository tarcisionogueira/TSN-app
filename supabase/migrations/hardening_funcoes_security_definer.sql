-- Hardening de segurança: SECURITY DEFINER executáveis por anon/authenticated + search_path
--
-- Contexto: o linter do Supabase apontou 30 funções SECURITY DEFINER executáveis por
-- `anon` (internet não autenticada) e 31 por `authenticated`. Funções DEFINER ignoram RLS,
-- então expô-las a papéis não confiáveis é risco (ex.: `solicitar_saque`, `get_user_id_by_email`).
--
-- Estratégia:
--   A) Funções chamadas pelo FRONTEND com JWT de usuário logado  -> só `authenticated` (+ service_role).
--   B) Funções server-only / cron / trigger / admin                -> só `service_role` (rotas api/).
--   C) Helpers de RLS (is_admin/is_equipe/app_role)                -> NÃO MEXER (as policies os avaliam
--      no papel do chamador; revogar de anon quebraria leitura pública de imóveis).
--
-- service_role é mantido em tudo porque as rotas api/ chamam via chave de serviço.
-- O owner (postgres) sempre mantém EXECUTE.

BEGIN;

-- ========================================================================
-- GRUPO A — chamadas pelo frontend (authenticated): revoga anon, mantém authenticated
-- ========================================================================
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'public.usar_convite(text)',
    'public.usar_convite_equipe(text,uuid)',
    'public.vincular_indicacao(text)',
    'public.gerar_codigo_indicacao(uuid)',
    'public.get_db_size_mb()',
    'public.salvar_kyc_equipe(text,jsonb)'
  ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon;', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role;', f);
  END LOOP;
END $$;

-- ========================================================================
-- GRUPO B — server-only / cron / trigger / admin: revoga anon E authenticated, mantém service_role
-- ========================================================================
DO $$
DECLARE f text;
BEGIN
  FOR f IN SELECT unnest(ARRAY[
    'public._admin_gerar_codigos_faltantes()',
    'public.anexos_expirados(integer)',
    'public.conceder_bonus_explorador()',
    'public.conceder_extras_analise(uuid,uuid,integer)',
    'public.consultar_sancoes(text)',
    'public.consumir_analise()',
    'public.desativar_imoveis_cef_vencidos(interval)',
    'public.diagnostico_snapshot()',
    'public.distribuir_solicitacoes()',
    'public.expirar_contratos_link()',
    'public.get_user_id_by_email(text)',
    'public.obter_cota_analise(uuid,text)',
    'public.performance_analista(uuid,text)',
    'public.preco_vigente(uuid,text)',
    'public.registrar_preco_contratado(uuid,text)',
    'public.registrar_uso(text,text,integer,bigint,bigint,numeric,bigint)',
    'public.registrar_uso_brightdata(integer)',
    'public.solicitar_saque(uuid,numeric)',
    'public.stats_completude_imoveis()',
    'public.sustentabilidade_ia()'
  ])
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated;', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', f);
  END LOOP;
END $$;

-- handle_new_user() é trigger em auth.users; grant não afeta o disparo do trigger.
-- Revogamos o EXECUTE direto (ninguém deve chamá-la manualmente).
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- ========================================================================
-- search_path mutável (funções SECURITY INVOKER apontadas pelo linter)
-- ========================================================================
ALTER FUNCTION public.calc_score_financeiro(text,numeric,text) SET search_path = public, pg_temp;
ALTER FUNCTION public.limite_ia(text,text)                      SET search_path = public, pg_temp;
ALTER FUNCTION public.preservar_data_leilao()                  SET search_path = public, pg_temp;

COMMIT;
