-- Tabelas de BACKUP (prefixo _bkp*, ex.: _bkp_gl_anexos_fantasma da limpeza do
-- GRUPOLANCE) são só-servidor / rede de segurança para reverter, NÃO são dados de
-- usuário. Elas têm RLS ligada sem política (estado seguro: ninguém acessa), mas o
-- auditoria_uso as flagava como "RLS mas SEM escrita do usuário" porque têm coluna
-- criado_por e INSERT concedido a authenticated. Passa a ignorá-las por padrão —
-- cobre backups atuais e futuros sem hardcode de nome (mesma filosofia do allow()).
CREATE OR REPLACE FUNCTION public.auditoria_uso()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with donos(col) as (values ('user_id'),('usuario_id'),('cliente_id'),('arrematante_id'),('criado_por'),('de_consultor_id'),('para_user_id'),('owner_id')),
allow(t) as (values
  ('alertas_enviados'),('arremate_aprendizado'),('audit_logs'),('chargebacks'),('comissoes'),
  ('compras'),('compras_produtos'),('convites_vendedor'),('emails_log'),('imovel_visto'),
  ('processos_monitorados'),('push_subscriptions'),('reembolsos_garantia'),('reunioes'),
  ('saldo_lancamentos'),('saldos_profissionais'),('saques')),
tabs as (
  select c.oid, c.relname from pg_class c
  join pg_namespace n on n.oid=c.relnamespace and n.nspname='public'
  where c.relkind='r' and c.relrowsecurity and has_table_privilege('authenticated', c.oid, 'INSERT')
),
tab_dono as (
  select distinct t.relname, d.col from tabs t
  join information_schema.columns ic on ic.table_schema='public' and ic.table_name=t.relname
  join donos d on d.col = ic.column_name
),
covered as (
  select distinct td.relname from tab_dono td
  where exists (select 1 from pg_policies p where p.schemaname='public' and p.tablename=td.relname
    and p.cmd in ('INSERT','ALL')
    and (coalesce(p.with_check, p.qual, '') like '%'||td.col||'%' or coalesce(p.with_check, p.qual, '') ilike '%auth.uid%'))
),
gaps as (
  select td.relname, string_agg(distinct td.col, ',') as colunas
  from tab_dono td
  where td.relname not in (select relname from covered)
    and td.relname not in (select t from allow)
    and td.relname !~ '^_bkp'  -- tabelas de backup (só-servidor) não são dados de usuário
  group by td.relname
)
select jsonb_build_object(
  'total', (select count(*) from gaps),
  'gaps', coalesce((select jsonb_agg(jsonb_build_object('tabela', relname, 'coluna_dono', colunas) order by relname) from gaps), '[]'::jsonb),
  'gerado_em', now()
);
$function$;
