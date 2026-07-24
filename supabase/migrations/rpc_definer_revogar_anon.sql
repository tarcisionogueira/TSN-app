-- Segurança (defesa em profundidade): tira o EXECUTE de ANON/PUBLIC das funções
-- SECURITY DEFINER que só o BACKEND (service_role) ou o CLIENTE AUTENTICADO chamam.
-- Postgres concede EXECUTE a PUBLIC por padrão → anon podia invocar RPCs sensíveis
-- (crédito, comissão de rede, índice, ranks). O auditor sinalizava `rpc_definer_anon`.
-- Ninguém no frontend chama essas 14 (só o backend com SERVICE_KEY); as 2 chamadas do
-- cliente (relatorio_comissoes_rede, vincular_upline) ficam restritas a `authenticated`.
-- (vincular_upline já é no-op para anon: exige auth.uid() e só altera a própria linha.)

-- ── Só backend (service_role) ──
do $$
declare fn text;
begin
  foreach fn in array array[
    'creditar_credito(uuid,numeric,text,text)',
    'debitar_credito(uuid,text,bigint,text,text)',
    'distribuir_comissao_rede(uuid,text,numeric,text)',
    'distribuir_pool_rank(text,numeric)',
    'indice_regiao_ponderado(text,text,text,double precision,double precision,text)',
    'ingerir_amostras_indice(jsonb)',
    'limite_ia_efetivo(uuid,text)',
    'matricula_cobertura()',
    'pode_debitar(uuid,bigint)',
    'rank_do_parceiro(uuid)',
    'recalcular_ranks()',
    'rede_metricas_parceiro(uuid)',
    'saldo_credito(uuid)',
    'valor_credito(bigint)'
  ]
  loop
    execute format('revoke all on function public.%s from public, anon, authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end $$;

-- ── Cliente autenticado (JWT do usuário) + backend ──
revoke all on function public.relatorio_comissoes_rede() from public, anon;
grant execute on function public.relatorio_comissoes_rede() to authenticated, service_role;

revoke all on function public.vincular_upline(text) from public, anon;
grant execute on function public.vincular_upline(text) to authenticated, service_role;
