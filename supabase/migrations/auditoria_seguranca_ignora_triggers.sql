-- FIX do falso-positivo do auditor: o check rpc_definer_anon acusava as funções de
-- TRIGGER anti-escalação (casos_protege_atribuicao, arrematacoes_protege_honorarios)
-- como "SECURITY DEFINER executável por anon". Funções que retornam `trigger` NÃO são
-- chamáveis via RPC (o PostgREST as ignora) e sem contexto de trigger falham — logo
-- não são risco de anon. Excluí-las mantém o auditor confiável (sem gritar à toa) e
-- futuro-prova as próximas triggers protetoras que o app venha a criar.
--
-- Única mudança: a linha `and p.prorettype <> 'pg_catalog.trigger'::regtype` no
-- primeiro SELECT. O resto é idêntico à versão em produção.
CREATE OR REPLACE FUNCTION public.auditoria_seguranca()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog'
AS $function$
declare
  achados jsonb := '[]'::jsonb;
  itens   jsonb;
  allow_anon_definer text[] := array[
    'get_contrato_por_token','is_admin','is_equipe','app_role','email_existe',
    'obter_arquivo_ebook','registrar_imovel_visto','vincular_indicacao',
    'usar_convite','usar_convite_equipe','salvar_kyc_equipe','gerar_codigo_indicacao',
    'get_convite_equipe_info','get_convite_vendedor_info'
  ];
  admin_rpcs text[] := array[
    'admin_busca_usuarios','admin_360_estatisticas','limpar_analises_orfas',
    'moderador_gerar_insights','enfileirar_docs_faltantes',
    'arremate_aprendizado_resumo','arremate_juridico_resumo'
  ];
begin
  select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb) into itens
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.prosecdef
    and p.prorettype <> 'pg_catalog.trigger'::regtype
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not (p.proname = any(allow_anon_definer));
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','rpc_definer_anon','severidade','atencao',
      'detalhe','Funcao SECURITY DEFINER executavel por anonimo fora da allowlist','itens',itens);
  end if;

  select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb) into itens
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname = any(admin_rpcs)
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','rpc_admin_exposto','severidade','critico',
      'detalhe','RPC de admin/cron executavel por anon/authenticated','itens',itens);
  end if;

  select coalesce(jsonb_agg(distinct c.relname), '[]'::jsonb) into itens
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='r' and not c.relrowsecurity
    and exists (select 1 from information_schema.columns col
                where col.table_schema='public' and col.table_name=c.relname
                  and col.column_name in ('user_id','cpf','cpf_enc'));
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','tabela_pii_sem_rls','severidade','critico',
      'detalhe','Tabela com user_id/cpf sem RLS','itens',itens);
  end if;

  select coalesce(jsonb_agg(id), '[]'::jsonb) into itens
  from storage.buckets where id in ('documentos','arrematacoes') and public;
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','bucket_sensivel_publico','severidade','critico',
      'detalhe','Bucket com documentos sensiveis marcado como publico','itens',itens);
  end if;

  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='documentos_select_autenticado') then
    achados := achados || jsonb_build_object('check','documentos_bucket_amplo','severidade','critico',
      'detalhe','Politica ampla documentos_select_autenticado reintroduzida','itens','[]'::jsonb);
  end if;

  if not exists (select 1 from pg_trigger where tgrelid='public.perfis'::regclass
                 and tgname='trg_proteger_perfil' and not tgisinternal) then
    achados := achados || jsonb_build_object('check','trigger_perfil_ausente','severidade','critico',
      'detalhe','Trigger trg_proteger_perfil ausente','itens','[]'::jsonb);
  end if;

  return jsonb_build_object(
    'gerado_em', now(),
    'total',    jsonb_array_length(achados),
    'criticos', (select count(*) from jsonb_array_elements(achados) e where e->>'severidade'='critico'),
    'atencao',  (select count(*) from jsonb_array_elements(achados) e where e->>'severidade'='atencao'),
    'achados',  achados
  );
end;
$function$;
