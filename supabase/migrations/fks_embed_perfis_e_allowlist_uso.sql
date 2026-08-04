-- ─────────────────────────────────────────────────────────────────────────────
-- 1) AS DUAS RELAÇÕES QUE FALTAVAM (quebravam telas do Admin com HTTP 400)
--
-- Achado 04/08 pelo Health Check (item "erros de runtime do cliente"), com a mensagem
-- exata gravada em `erros_cliente`:
--   • "Could not find a relationship between 'solicitacoes' and 'user_id' in the schema
--      cache"  → tela de Transcrições de reunião (Admin), que embute
--      `solicitacoes ( ..., perfis:user_id ( nome ) )`. O FK
--      transcricoes_reuniao→solicitacoes EXISTE; o que falta é o de dentro,
--      solicitacoes.user_id→perfis.
--   • "Could not find a relationship between 'links_promo' and 'perfis' in the schema
--      cache"  → tela de Links promocionais, que faz `select('*, perfis(nome)')` e
--      depende de links_promo.criado_por→perfis.
--
-- O PostgREST monta embed a partir de CHAVE ESTRANGEIRA declarada; sem ela a consulta
-- inteira volta 400 e a aba fica vazia. Nenhuma das duas telas estava funcionando.
--
-- ON DELETE SET NULL de propósito: preserva o histórico (a solicitação/o link continuam
-- existindo depois que a conta sai) e NÃO trava a exclusão de conta, que é fluxo de LGPD
-- neste projeto. NO ACTION faria a exclusão do perfil falhar; CASCADE apagaria histórico
-- financeiro/operacional junto — os dois seriam pior que o problema.
--
-- Verificado antes de aplicar: 0 órfãos em ambas (solicitacoes: 3 linhas, 0 órfãs;
-- links_promo: 0 linhas). As colunas já eram NULLABLE, então SET NULL é válido.
-- ─────────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'solicitacoes_user_id_perfis_fkey'
  ) then
    alter table public.solicitacoes
      add constraint solicitacoes_user_id_perfis_fkey
      foreign key (user_id) references public.perfis(id) on delete set null;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'links_promo_criado_por_perfis_fkey'
  ) then
    alter table public.links_promo
      add constraint links_promo_criado_por_perfis_fkey
      foreign key (criado_por) references public.perfis(id) on delete set null;
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) ALLOWLIST DO auditoria_uso — duas tabelas SÓ-SERVIDOR que viravam aviso diário
--
-- O Health Check vinha acusando `cota_concessoes(user_id)` e `eventos_atividade(user_id)`
-- como "RLS ligada mas sem política de escrita do usuário". A própria checagem já prevê a
-- saída correta: "ou incluir na allowlist se for só-servidor". É o caso das duas —
-- MEDIDO, não presumido:
--   • eventos_atividade: escrita só por /api/track (service key). 4.722 linhas, a última
--     gravada hoje 19:00 — funcionando. O cliente nunca insere direto.
--   • cota_concessoes: o front só LÊ (Creditos.jsx faz select por user_id, e existe
--     política de SELECT para o dono). Quem concede cota é o servidor.
--
-- Criar política de INSERT para `authenticated` nestas duas seria REGRESSÃO de segurança:
-- deixaria qualquer usuário logado forjar evento de atividade e, pior, conceder cota a si
-- mesmo. O aviso é que estava errado, não o banco.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.auditoria_uso()
returns jsonb
language sql
stable security definer
set search_path to 'public'
as $function$
with donos(col) as (values ('user_id'),('usuario_id'),('cliente_id'),('arrematante_id'),('criado_por'),('de_consultor_id'),('para_user_id'),('owner_id')),
allow(t) as (values
  ('alertas_enviados'),('arremate_aprendizado'),('audit_logs'),('chargebacks'),('comissoes'),
  ('compras'),('compras_produtos'),('convites_vendedor'),('emails_log'),('imovel_visto'),
  ('processos_monitorados'),('push_subscriptions'),('reembolsos_garantia'),('reunioes'),
  ('saldo_lancamentos'),('saldos_profissionais'),('saques'),
  ('atividade_log'),('doc_retencao_aviso'),('credito_lancamentos'),
  -- Acrescentadas em 04/08 (só-servidor, conferidas em campo — ver comentário acima):
  ('eventos_atividade'),('cota_concessoes')),
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
$function$;

-- O PostgREST guarda o grafo de relacionamentos em cache: sem este reload os embeds novos
-- continuariam devolvendo 400 até o próximo restart do serviço.
notify pgrst, 'reload schema';
