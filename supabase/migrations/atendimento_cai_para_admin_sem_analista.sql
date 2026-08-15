-- SEM ANALISTA, O ATENDIMENTO CAI PARA O ADMIN (15/08, decisão do dono).
--
-- POR QUE. Três pedidos de reunião ficaram em `status='solicitado'` desde 1 e 5 de julho —
-- 41 a 45 dias — com `analista_id` nulo. A causa não era código: NÃO EXISTE perfil com
-- role='analista' ativo, e havia 42 horários livres esperando alguém. Do lado do cliente,
-- que leu na tela "nossa equipe entrará em contato em breve", o pedido simplesmente não
-- existiu.
--
-- O defeito de fundo é o de sempre neste projeto: a fila existia, o dono dela não. Ninguém
-- é responsável por uma linha com `analista_id = null` — ela não aparece como "minha" para
-- ninguém, e some. A regra do dono resolve na raiz: **enquanto não houver analista, o
-- pedido é do admin**. Deixa de ser fila órfã e passa a ter dono desde o instante em que
-- nasce.
--
-- Feito por TRIGGER, e não no front, porque a solicitação é criada em três telas diferentes
-- (Analise, Painel e a regeneração) com `insert` direto no banco. Regra de negócio que mora
-- na tela é regra que a próxima tela esquece — foi assim que o "Explorador indica mas só
-- saca sendo pagante" ficou dois meses valendo só no comentário.

create or replace function public.atendimento_atribuir_admin_sem_analista()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare admin_id uuid;
begin
  -- Só age quando ninguém pegou o pedido.
  if new.analista_id is not null then return new; end if;
  -- Havendo analista ativo, a fila é dele: não sequestra o trabalho da equipe.
  if exists (select 1 from perfis where role = 'analista' and ativo) then return new; end if;
  select id into admin_id from perfis where role = 'admin' and ativo order by created_at limit 1;
  if admin_id is not null then new.analista_id := admin_id; end if;
  return new;
end $$;

drop trigger if exists trg_solicitacao_cai_para_admin on public.solicitacoes;
create trigger trg_solicitacao_cai_para_admin
  before insert on public.solicitacoes
  for each row execute function public.atendimento_atribuir_admin_sem_analista();

-- BACKFILL: os pedidos que já estavam órfãos passam a ter dono. Sem isto a regra valeria só
-- para o futuro e os três de julho continuariam exatamente onde estão.
update public.solicitacoes s
   set analista_id = (select id from perfis where role='admin' and ativo order by created_at limit 1)
 where s.analista_id is null
   and coalesce(s.status,'') not in ('cancelado','concluido','recusado')
   and not exists (select 1 from perfis where role='analista' and ativo);

-- MESMA REGRA PARA O CHAMADO. `chamados.atendente_id` tinha o mesmo buraco: chamado aberto
-- sem atendente não é de ninguém. Em 14/08 havia 22 chamados abertos e 11 criados na semana,
-- e o registro nunca virou aviso.
create or replace function public.chamado_atribuir_admin_sem_equipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare admin_id uuid;
begin
  if new.atendente_id is not null then return new; end if;
  if exists (select 1 from perfis where role in ('analista','consultor') and ativo) then return new; end if;
  select id into admin_id from perfis where role = 'admin' and ativo order by created_at limit 1;
  if admin_id is not null then new.atendente_id := admin_id; end if;
  return new;
end $$;

drop trigger if exists trg_chamado_cai_para_admin on public.chamados;
create trigger trg_chamado_cai_para_admin
  before insert on public.chamados
  for each row execute function public.chamado_atribuir_admin_sem_equipe();

update public.chamados c
   set atendente_id = (select id from perfis where role='admin' and ativo order by created_at limit 1)
 where c.atendente_id is null and c.status = 'aberto'
   and not exists (select 1 from perfis where role in ('analista','consultor') and ativo);
