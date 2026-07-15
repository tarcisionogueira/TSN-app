-- Monitoramento de cobertura de documentos por leiloeiro no moderador semanal.
-- Lê leiloeiro_conhecimento.docs_status='corrigivel' e gera/atualiza o insight
-- 'docs:cobertura' (lista os leiloeiros com lacuna corrigível — contramedida em
-- docs_estrategia). Chamado pelo api/moderador-cron.js logo após moderador_gerar_insights.
-- Fecha o ciclo: diagnóstico (workflow) -> aprendizado (docs_estrategia/docs_status)
-- -> MONITORAMENTO automático (este insight) -> contramedida.
create or replace function public.moderador_docs_coverage_insight()
returns void language plpgsql security definer set search_path=public,pg_catalog as $$
begin
  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'docs:cobertura','docs',
    case when count(*)>0 then 'atencao' else 'info' end, 'scraper',
    'Cobertura de documentos — lacunas corrigíveis',
    case when count(*)>0
      then 'Leiloeiros com lacuna CORRIGÍVEL (ver leiloeiro_conhecimento.docs_estrategia): '||string_agg(fonte, ', ' order by fonte)
      else 'Nenhuma lacuna de documentos corrigível pendente.' end,
    jsonb_build_object('corrigiveis', coalesce(jsonb_agg(fonte order by fonte) filter (where true),'[]'::jsonb))
  from public.leiloeiro_conhecimento where docs_status='corrigivel'
  on conflict (chave) do update set severidade=excluded.severidade, detalhe=excluded.detalhe, dados=excluded.dados, gerado_em=now();
end $$;
revoke execute on function public.moderador_docs_coverage_insight() from public, anon, authenticated;

-- Nota: docs_estrategia + docs_status das 10 fontes com lacuna foram semeados a partir
-- da auditoria com agentes de 15/07/2026 (workflow auditoria-docs-leiloeiros).
