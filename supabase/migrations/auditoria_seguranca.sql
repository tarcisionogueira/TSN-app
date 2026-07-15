-- Auditor de segurança CONTÍNUO (o "bug bounty" embutido na saúde do sistema).
-- Bateria determinística de checagens de postura no próprio banco (RLS, grants de RPC,
-- buckets, triggers) que DETECTA REGRESSÕES: se alguma brecha fechada reabrir, o cron
-- /api/seguranca-auditoria-cron avisa o admin. Não substitui pentest ao vivo — é a rede
-- sempre-ligada entre eles.

create table if not exists public.seguranca_auditoria (
  id        bigint generated always as identity primary key,
  gerado_em timestamptz default now(),
  total     int,
  criticos  int,
  atencao   int,
  achados   jsonb
);
alter table public.seguranca_auditoria enable row level security;  -- sem policy = só service_role/admin

create or replace function public.auditoria_seguranca()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_catalog
as $func$
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
  -- 1) SECURITY DEFINER executável por anon fora da allowlist
  select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb) into itens
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.prosecdef
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not (p.proname = any(allow_anon_definer));
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','rpc_definer_anon','severidade','atencao',
      'detalhe','Funcao SECURITY DEFINER executavel por anonimo fora da allowlist','itens',itens);
  end if;

  -- 2) RPCs de admin/cron expostos a anon/authenticated (REGRESSAO)
  select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb) into itens
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.proname = any(admin_rpcs)
    and (has_function_privilege('anon', p.oid, 'EXECUTE')
         or has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','rpc_admin_exposto','severidade','critico',
      'detalhe','RPC de admin/cron executavel por anon/authenticated','itens',itens);
  end if;

  -- 3) Tabelas com PII/user_id sem RLS
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

  -- 4) Buckets sensiveis publicos
  select coalesce(jsonb_agg(id), '[]'::jsonb) into itens
  from storage.buckets where id in ('documentos','arrematacoes') and public;
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','bucket_sensivel_publico','severidade','critico',
      'detalhe','Bucket com documentos sensiveis marcado como publico','itens',itens);
  end if;

  -- 5) Politica AMPLA do bucket documentos reintroduzida
  if exists (select 1 from pg_policies where schemaname='storage' and tablename='objects'
             and policyname='documentos_select_autenticado') then
    achados := achados || jsonb_build_object('check','documentos_bucket_amplo','severidade','critico',
      'detalhe','Politica ampla documentos_select_autenticado reintroduzida','itens','[]'::jsonb);
  end if;

  -- 6) Trigger de protecao de campos sensiveis do perfil ausente
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
$func$;

revoke execute on function public.auditoria_seguranca() from public, anon, authenticated;
