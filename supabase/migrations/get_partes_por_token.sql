-- Roster de assinantes acessível pelo TOKEN do contrato (tela pública ContratoLink): após assinar,
-- ou ao reabrir um link já assinado, a parte vê quem já assinou e quem falta, sem precisar de conta.
-- Espelha o padrão de get_contrato_testemunha (anon, token-gated). Campos SEGUROS apenas: nome
-- (de dados_signatario) ou e-mail MASCARADO quando ainda não assinou; nunca CPF/KYC de terceiros.
create or replace function public.get_partes_por_token(p_token text)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with alvo as (
    select id, contrato_grupo_id from public.contratos_link where token = p_token limit 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'nome', coalesce(
              nullif(c.dados_signatario->>'nome',''),
              nullif(c.dados_signatario->>'razao_social',''),
              regexp_replace(coalesce(c.assinante_email,''), '(^.).*(@.*)$', '\1***\2')),
    'assinou', (c.status = 'assinado'),
    'assinado_em', c.assinado_em,
    'requer_testemunha', coalesce(c.requer_testemunha, false),
    'testemunha_assinou', (c.testemunha_em is not null),
    'eu', (c.token = p_token)
  ) order by c.criado_em), '[]'::jsonb)
  from alvo a
  join public.contratos_link c
    on (a.contrato_grupo_id is not null and c.contrato_grupo_id = a.contrato_grupo_id)
    or (a.contrato_grupo_id is null and c.id = a.id);
$$;

revoke all on function public.get_partes_por_token(text) from public;
grant execute on function public.get_partes_por_token(text) to anon, authenticated;

-- Entra na allowlist do auditor (token-gated, anon-executável por design, como os outros get_*_token).
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
