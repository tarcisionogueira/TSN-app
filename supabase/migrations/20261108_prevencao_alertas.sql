-- 08/11: três defeitos do dia já tinham rastro no banco e ninguém viu a tempo.

-- 1) Pagamento × sistema. O boleto do Marcos ficou 32 dias aprovado com a cobrança aberta, e o William pagou sem
--    ninguém ativar a assessoria. Só compara o que já está gravado: não chama gateway nem tem custo.
create or replace function public.pagamentos_sem_baixa()
returns table (tipo text, referencia text, valor numeric, desde timestamptz, detalhe text)
language sql stable security definer set search_path = public as $f$
  -- O aviso do pagamento nunca foi processado. Sem filtrar a URL, entra pagamento feito pela própria conta em
  -- terceiros, que avisa o sistema do vendedor. A folga de 1 h deixa a fila trabalhar.
  select 'aviso_nao_processado', m.mp_payment_id, m.valor, m.criado_em,
         coalesce(m.dados_mp->'metadata'->>'tipo', m.origem)
    from mp_pagamentos m
   where m.status = 'approved'
     and m.criado_em > now() - interval '60 days' and m.criado_em < now() - interval '1 hour'
     and (m.origem <> 'terceiro' or m.dados_mp->>'notification_url' ilike '%bidprobrasil%')
     and not exists (select 1 from webhook_eventos_processados e
                      where e.gateway = 'mercadopago' and e.gateway_payment_id = m.mp_payment_id)
  union all
  -- O aviso chegou, ou não, mas a cobrança segue aberta com o dinheiro aprovado.
  select 'cobranca_aberta', c.id::text, m.valor, m.criado_em, left(c.descricao, 90)
    from mp_pagamentos m
    join cobrancas_avulsas c
      on c.id::text = coalesce(m.dados_mp->'metadata'->>'cobranca_id', substring(m.external_ref from 'cobranca:(.+)'))
   where m.status = 'approved' and c.status = 'aberta'
  union all
  -- Assessoria paga por cobrança avulsa não muda o papel: a pessoa pagou e não está na lista de assessorados.
  select 'pagou_falta_ativar', c.id::text, c.valor, c.pago_em, left(c.descricao, 90)
    from cobrancas_avulsas c
   where c.status = 'paga'
     and (c.descricao ilike '%assessoria%' or c.termo_titulo ilike '%assessoria%')
     and not exists (
       select 1 from perfis p
        where p.role like 'assessorado%'
          and (p.id::text = (select m.user_id::text from mp_pagamentos m where m.mp_payment_id = c.gateway_payment_id)
               or p.id in (select u.id from auth.users u where lower(u.email) = lower(c.destinatario_email))));
$f$;
revoke all on function public.pagamentos_sem_baixa() from public, anon, authenticated;
grant execute on function public.pagamentos_sem_baixa() to service_role;

-- 2) Problema conhecido sai de "agir hoje", com motivo e prazo. Mesmo desenho de fonte_regressao_explicada:
--    venceu o prazo, volta sozinho a ser erro. O texto do item segue mostrando o estado real.
create table if not exists public.health_check_explicado (
  nome text primary key,
  explicacao text not null,
  explicado_ate timestamptz not null,
  criado_em timestamptz not null default now()
);
alter table public.health_check_explicado enable row level security;

-- 3) Tabelas que só o servidor grava, conferido no código em 08/11: o aviso de RLS estava em 34 de 60 rodadas à toa.
create or replace function public.auditoria_uso() returns jsonb
language sql stable security definer set search_path = public as $f$
with donos(col) as (values ('user_id'),('usuario_id'),('cliente_id'),('arrematante_id'),('criado_por'),('de_consultor_id'),('para_user_id'),('owner_id')),
allow(t) as (values
  ('alertas_enviados'),('arremate_aprendizado'),('audit_logs'),('chargebacks'),('comissoes'),
  ('compras'),('compras_produtos'),('convites_vendedor'),('emails_log'),('imovel_visto'),
  ('processos_monitorados'),('push_subscriptions'),('reembolsos_garantia'),('reunioes'),
  ('saldo_lancamentos'),('saldos_profissionais'),('saques'),
  ('atividade_log'),('doc_retencao_aviso'),('credito_lancamentos'),
  ('eventos_atividade'),('cota_concessoes'),('documental_pedidos_leiloeiro'),
  ('asaas_transferencias_pendentes'),('assessorado_designacao'),('email_bloqueados'),('equipe_email'),('veiculo_propostas_leiloeiro'),
  ('documentos_aguardando'),('oportunidades_selecionadas')),
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
    and td.relname !~ '^_bkp'
  group by td.relname
)
select jsonb_build_object(
  'total', (select count(*) from gaps),
  'gaps', coalesce((select jsonb_agg(jsonb_build_object('tabela', relname, 'coluna_dono', colunas) order by relname) from gaps), '[]'::jsonb),
  'gerado_em', now()
);
$f$;

-- 4) Fila parada desde antes de 01/11: nada foi corrigido por esta linha, ela só deixa de contar como aviso aberto.
--    Os relatórios envolvidos seguem como estão, e a anomalia volta se o gerador acusar de novo.
update public.relatorio_anomalias set resolvido = true
 where not resolvido and atualizado_em < '2026-11-01';
