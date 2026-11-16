-- OPORTUNIDADE DO ASSESSORADO: RELATÓRIOS ANTES DO ENVIO (#420) E AUTORIZAÇÃO DE LANCE REGISTRADA (#419) — 16/11.
-- Decisão do dono (16/11): "Precisa ter os dois relatórios para poder enviar para aprovação."
--
-- 1. Termo 1.4: relatório de viabilidade, separando o documentado do estimado, ANTES do lance. Agora a equipe só envia a
--    oportunidade se o CLIENTE já tiver o mercadológico e o documental concluídos daquele lote (gerados em nome dele,
--    então ele os abre na própria conta). A rota congela no retrato qual relatório foi entregue, de quando e o hash do
--    conteúdo; este gatilho confere no banco que os ids do retrato existem, são do cliente, do lote e estão concluídos.
-- 2. Termo 1.5: lance só com autorização individual, por escrito, com valor máximo. Até aqui ela só existia fora da
--    plataforma. `autorizacoes_lance` guarda o texto aceito, a versão, o hash, IP e navegador; não se reescreve, só se
--    revoga. Uma vigente por oportunidade: mudar o valor = revogar e autorizar de novo (as duas ficam no histórico).

-- ── 1. relatórios exigidos no envio ───────────────────────────────────────────────────────────────────────────────
create or replace function public.oportunidade_exige_relatorios()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  v_merc uuid; v_doc uuid;
begin
  -- oportunidade.relatorios_antes_do_envio
  begin
    v_merc := (new.retrato->'relatorios'->'mercado'->>'id')::uuid;
    v_doc  := (new.retrato->'relatorios'->'documental'->>'id')::uuid;
  exception when others then
    raise exception 'oportunidade: referência de relatório inválida no retrato';
  end;
  if v_merc is null or v_doc is null then
    raise exception 'oportunidade: só pode ser enviada com o relatório mercadológico e o documental do cliente concluídos';
  end if;
  if not exists (select 1 from analises_mercado a where a.id = v_merc and a.user_id = new.cliente_id
                   and a.imovel_id = new.imovel_id::text and a.status = 'concluida') then
    raise exception 'oportunidade: o relatório mercadológico informado não é deste cliente/lote ou não está concluído';
  end if;
  if not exists (select 1 from analises_documental a where a.id = v_doc and a.user_id = new.cliente_id
                   and a.imovel_id = new.imovel_id::text and a.status = 'concluida') then
    raise exception 'oportunidade: o relatório documental informado não é deste cliente/lote ou não está concluído';
  end if;
  return new;
end; $$;

create or replace trigger oportunidade_exige_relatorios
  before insert on public.oportunidades_selecionadas
  for each row execute function public.oportunidade_exige_relatorios();

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('oportunidade.relatorios_antes_do_envio', 'true'::jsonb,
  'Oportunidade só vai ao assessorado com o relatório mercadológico e o documental dele concluídos para o lote; o retrato congela qual foi entregue e quando (termo, 1.4). Decisão do dono, 16/11.',
  array['oportunidade_exige_relatorios'], true)
on conflict (chave) do nothing;

-- ── 2. autorização de lance ───────────────────────────────────────────────────────────────────────────────────────
create table if not exists public.autorizacoes_lance (
  id uuid primary key default gen_random_uuid(),
  oportunidade_id uuid not null references public.oportunidades_selecionadas(id),
  cliente_id uuid not null,
  imovel_id uuid not null,
  valor_maximo numeric(14,2) not null check (valor_maximo > 0),
  relatorios jsonb not null,
  texto text not null,
  texto_versao text not null,
  texto_sha256 text not null,
  ip text,
  user_agent text,
  criada_em timestamptz not null default now(),
  revogada_em timestamptz,
  revogada_ip text,
  revogada_user_agent text
);
create unique index if not exists autorizacoes_lance_vigente_uq on public.autorizacoes_lance (oportunidade_id) where revogada_em is null;
create index if not exists autorizacoes_lance_cliente_idx on public.autorizacoes_lance (cliente_id, criada_em desc);

alter table public.autorizacoes_lance enable row level security;
create policy autorizacoes_lance_cliente_le on public.autorizacoes_lance
  for select to authenticated using (cliente_id = (select auth.uid()));

create or replace function public.autorizacao_lance_proteger()
returns trigger language plpgsql set search_path to 'public' as $$
declare
  o record;
begin
  -- oportunidade.autorizacao_lance_registrada
  if tg_op = 'INSERT' then
    select * into o from oportunidades_selecionadas where id = new.oportunidade_id;
    if not found then raise exception 'autorização de lance: oportunidade inexistente'; end if;
    if o.status <> 'aprovada' then raise exception 'autorização de lance: só depois de o cliente aprovar a oportunidade'; end if;
    if o.cliente_id <> new.cliente_id or o.imovel_id <> new.imovel_id then
      raise exception 'autorização de lance: cliente ou lote diferente do da oportunidade';
    end if;
    if new.relatorios is distinct from o.retrato->'relatorios' then
      raise exception 'autorização de lance: os relatórios têm de ser os entregues com a oportunidade';
    end if;
    if new.revogada_em is not null then raise exception 'autorização de lance: não nasce revogada'; end if;
    return new;
  end if;
  -- UPDATE: só a revogação, uma vez, e nada mais muda.
  if old.revogada_em is not null then raise exception 'autorização de lance: já revogada, não se altera'; end if;
  if new.revogada_em is null
     or new.oportunidade_id is distinct from old.oportunidade_id or new.cliente_id is distinct from old.cliente_id
     or new.imovel_id is distinct from old.imovel_id or new.valor_maximo is distinct from old.valor_maximo
     or new.relatorios is distinct from old.relatorios or new.texto is distinct from old.texto
     or new.texto_versao is distinct from old.texto_versao or new.texto_sha256 is distinct from old.texto_sha256
     or new.ip is distinct from old.ip or new.user_agent is distinct from old.user_agent or new.criada_em is distinct from old.criada_em then
    raise exception 'autorização de lance: o registro não se reescreve; para mudar o valor, revogue e autorize de novo';
  end if;
  return new;
end; $$;

create or replace trigger autorizacao_lance_proteger
  before insert or update on public.autorizacoes_lance
  for each row execute function public.autorizacao_lance_proteger();

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('oportunidade.autorizacao_lance_registrada', 'true'::jsonb,
  'Lance só com autorização do cliente registrada na plataforma, por lote, com valor máximo e o texto aceito; só depois da aprovação da oportunidade, com os relatórios entregues nela; não se reescreve, só se revoga (termo, 1.5).',
  array['autorizacao_lance_proteger'], true)
on conflict (chave) do nothing;
