-- auditoria_seguranca(): novo check — "role vindo do metadado do cadastro".
--
-- Motivo: em 02/08 a escalação de privilégio do `handle_new_user` (perfis.role gravado direto de
-- `raw_user_meta_data->>'role'`, controlado pelo cliente no signUp) passou batida pelo auditor —
-- ele confere que a trigger anti-escalação EXISTE, mas ela é BEFORE **UPDATE**; o INSERT ficava
-- aberto e o painel seguia 0 crítico / 0 atenção.
--
-- Este check é GENÉRICO: qualquer função de banco (trigger nova, RPC nova) que derive o papel do
-- metadado do cadastro sem a allowlist vira CRÍTICO no próximo run — sem precisar lembrar de
-- incluir nada, no espírito do resto do auditor.
-- Marcador da correção: `array['explorador']` (a allowlist). Quem reescrever o clamp de outro
-- jeito deve manter o marcador ou ajustar este check — de propósito: mexer no papel do cadastro
-- é exatamente o tipo de mudança que merece revisão explícita.
create or replace function public.auditoria_seguranca()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'pg_catalog'
as $function$
declare
  achados jsonb := '[]'::jsonb;
  itens   jsonb;
  allow_anon_definer text[] := array[
    'get_contrato_por_token','get_contrato_testemunha','get_partes_por_token','is_admin','is_equipe','app_role','email_existe',
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

  -- views SECURITY DEFINER (sem security_invoker) que expõem PII (chave_pix/cpf)
  -- e são legíveis por anon/authenticated → ignoram o RLS das tabelas base (vazamento).
  select coalesce(jsonb_agg(distinct c.relname), '[]'::jsonb) into itens
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname='public' and c.relkind='v'
    and not coalesce((select o.option_value::bool from pg_options_to_table(c.reloptions) o
                      where o.option_name='security_invoker'), false)
    and (has_table_privilege('anon', c.oid, 'SELECT') or has_table_privilege('authenticated', c.oid, 'SELECT'))
    and exists (select 1 from information_schema.columns col
                where col.table_schema='public' and col.table_name=c.relname
                  and col.column_name in ('chave_pix','cpf','cpf_enc'));
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','view_definer_pii','severidade','critico',
      'detalhe','View SECURITY DEFINER com PII (chave_pix/cpf) legivel por anon/authenticated','itens',itens);
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

  -- NOVO (02/08): papel do usuário NUNCA pode vir do metadado do cadastro sem allowlist.
  -- Cobre o INSERT (ponto cego do trg_proteger_perfil, que só protege UPDATE).
  select coalesce(jsonb_agg(distinct p.proname), '[]'::jsonb) into itens
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname='public' and p.prokind='f'
    and pg_get_functiondef(p.oid) like '%raw_user_meta_data->>''role''%'
    and pg_get_functiondef(p.oid) not like '%array[''explorador'']%';
  if jsonb_array_length(itens) > 0 then
    achados := achados || jsonb_build_object('check','role_do_metadado_cliente','severidade','critico',
      'detalhe','Funcao grava o papel a partir do metadado do cadastro (raw_user_meta_data.role) sem allowlist — escalacao de privilegio no signup','itens',itens);
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
