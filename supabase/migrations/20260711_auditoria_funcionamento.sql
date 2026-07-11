-- Camada de FUNCIONAMENTO da auditoria do sistema.
-- A auditoria do Claude (scripts/auditoria-claude.mjs) é um review ESTÁTICO de
-- código — não enxerga estado de runtime. Esta função devolve um retrato do
-- funcionamento em produção (coleta por leiloeiro, filas, health-check) para o
-- runner transformar em achados e gravar no MESMO relatório (auditoria_sistema),
-- tornando-o "de segurança E funcionamento".
--
-- SECURITY DEFINER + search_path fixo (advisor). Só o service_role chama
-- (revogado de anon/authenticated) — usado pelo runner da GitHub Action.
create or replace function public.auditoria_funcionamento()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'gerado_em', now(),
    -- Coleta por fonte: ativos + há quantos dias a fonte não recebe atualização.
    -- Estagnação/zero ativos = provável falha de conexão com o leiloeiro.
    'fontes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'fonte', f.fonte,
        'ativos', f.ativos,
        'dias_sem_atualizar', round(extract(epoch from (now() - f.ult)) / 86400.0, 1)
      ) order by f.ult nulls first)
      from (
        select fonte,
               count(*) filter (where ativo) as ativos,
               max(atualizado_em) as ult
        from public.imoveis_leilao
        group by fonte
      ) f
    ), '[]'::jsonb),
    -- Filas de captura de documentos.
    'docs_fila_erro', (select count(*) from public.documentos_fila where status = 'erro'),
    'docs_fila_pend_antigos', (select count(*) from public.documentos_fila
      where status = 'pendente' and criado_em < now() - interval '2 days'),
    'cef_fila_erro', (select count(*) from public.cef_matricula_fila where status = 'erro'),
    -- UFs da Caixa que falharam a coleta.
    'ufs_falhando', (select count(*) from public.scraper_retry),
    -- Health-check (api/health-check, cron diário 06:00 UTC).
    'health', (
      select jsonb_build_object(
        'ultimo', executado_em,
        'status', status,
        'horas_atras', round(extract(epoch from (now() - executado_em)) / 3600.0, 1)
      )
      from public.health_check_logs order by executado_em desc limit 1
    )
  );
$$;

revoke execute on function public.auditoria_funcionamento() from anon, authenticated;
grant execute on function public.auditoria_funcionamento() to service_role;
