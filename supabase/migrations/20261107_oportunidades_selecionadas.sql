-- OPORTUNIDADE SELECIONADA PARA O ASSESSORADO (07/11, dono + arena).
-- Cláusula 1.3 do termo de assessoria: a equipe seleciona, o cliente aprova ou recusa, as partes marcam a
-- reunião. Aprovar pede a reunião e NUNCA autoriza lance (cláusula 1.5): por isso a tabela não tem campo de lance.
--
-- É registro de prova (cláusulas 3.9 e 9.6), então:
--   · o retrato do lote, do perfil e dos motivos é montado no servidor e congelado aqui. Sem chave estrangeira:
--     o lote pode sair do acervo e a conta pode ser encerrada, e a prova continua;
--   · o trigger impede reescrever o que já foi registrado;
--   · o cliente só lê as próprias linhas. Toda escrita passa pelas rotas de servidor, que conferem o JWT.
-- "Apresentada" não é gravada como rótulo: ficam os fatos (selecionada_em, aviso_*, visto_em, decidida_em), porque
-- a definição jurídica ainda pode mudar e o fato serve para qualquer redação.
create table if not exists public.oportunidades_selecionadas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null,
  imovel_id uuid not null,
  retrato jsonb not null,
  motivo_equipe text not null check (length(trim(motivo_equipe)) >= 10),
  selecionada_por uuid not null,
  selecionada_por_nome text,
  selecionada_em timestamptz not null default now(),
  prazo_curto_confirmado boolean not null default false,
  status text not null default 'selecionada' check (status in ('selecionada', 'aprovada', 'recusada', 'retirada')),
  decidida_em timestamptz,
  decisao_texto text,
  decisao_texto_versao text,
  decisao_texto_sha256 text,
  decisao_ip text,
  decisao_user_agent text,
  motivo_recusa text,
  retirada_por uuid,
  retirada_em timestamptz,
  retirada_motivo text,
  solicitacao_id uuid,
  visto_em timestamptz,
  aviso_status text check (aviso_status in ('aceito', 'enfileirado', 'falhou')),
  aviso_email_id text,
  aviso_em timestamptz,
  aviso_erro text
);

create unique index if not exists oportunidades_selecionadas_viva_uq
  on public.oportunidades_selecionadas (cliente_id, imovel_id) where status in ('selecionada', 'aprovada');
create index if not exists oportunidades_selecionadas_cliente_idx
  on public.oportunidades_selecionadas (cliente_id, selecionada_em desc);

alter table public.oportunidades_selecionadas enable row level security;
create policy oportunidades_selecionadas_cliente_le on public.oportunidades_selecionadas
  for select to authenticated using (cliente_id = (select auth.uid()));

-- Regra `oportunidade.registro_imutavel`: o que foi selecionado e decidido não se reescreve.
create or replace function public.oportunidade_selecionada_proteger()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  -- oportunidade.registro_imutavel
  if new.cliente_id is distinct from old.cliente_id or new.imovel_id is distinct from old.imovel_id
     or new.retrato is distinct from old.retrato or new.motivo_equipe is distinct from old.motivo_equipe
     or new.selecionada_por is distinct from old.selecionada_por or new.selecionada_por_nome is distinct from old.selecionada_por_nome
     or new.selecionada_em is distinct from old.selecionada_em or new.prazo_curto_confirmado is distinct from old.prazo_curto_confirmado then
    raise exception 'oportunidade selecionada: o registro da seleção não pode ser alterado';
  end if;
  if new.status is distinct from old.status and not (
       (old.status = 'selecionada' and new.status in ('aprovada', 'recusada', 'retirada'))
       or (old.status = 'aprovada' and new.status = 'retirada')) then
    raise exception 'oportunidade selecionada: transição de % para % não permitida', old.status, new.status;
  end if;
  if old.decidida_em is not null and (
       new.decidida_em is distinct from old.decidida_em or new.decisao_texto is distinct from old.decisao_texto
       or new.decisao_texto_versao is distinct from old.decisao_texto_versao or new.decisao_texto_sha256 is distinct from old.decisao_texto_sha256
       or new.decisao_ip is distinct from old.decisao_ip or new.decisao_user_agent is distinct from old.decisao_user_agent
       or new.motivo_recusa is distinct from old.motivo_recusa) then
    raise exception 'oportunidade selecionada: a decisão do cliente não pode ser alterada';
  end if;
  if (old.visto_em is not null and new.visto_em is distinct from old.visto_em)
     or (old.solicitacao_id is not null and new.solicitacao_id is distinct from old.solicitacao_id)
     or (old.retirada_em is not null and (new.retirada_em is distinct from old.retirada_em or new.retirada_por is distinct from old.retirada_por or new.retirada_motivo is distinct from old.retirada_motivo)) then
    raise exception 'oportunidade selecionada: carimbo já gravado não pode ser alterado';
  end if;
  return new;
end; $$;

create or replace trigger oportunidade_selecionada_proteger
  before update on public.oportunidades_selecionadas
  for each row execute function public.oportunidade_selecionada_proteger();

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('oportunidade.registro_imutavel', 'true'::jsonb,
  'Seleção e decisão de oportunidade do assessorado não se reescrevem. Aprovar pede a reunião e não autoriza lance (termo, 1.3 e 1.5).',
  array['oportunidade_selecionada_proteger'], true)
on conflict (chave) do nothing;

-- Lista nominal do que parou. Invoker de propósito: quem lê tudo é a service key do health-check.
create or replace function public.oportunidades_paradas()
returns table (tipo text, oportunidade_id uuid, cliente_id uuid, detalhe text, desde timestamptz)
language sql stable set search_path to 'public' as $$
  select 'aprovada_sem_reuniao', o.id, o.cliente_id, coalesce(o.retrato->'lote'->>'titulo', o.imovel_id::text), o.decidida_em
    from oportunidades_selecionadas o left join solicitacoes s on s.id = o.solicitacao_id
   where o.status = 'aprovada' and s.reuniao_em is null and o.decidida_em < now() - interval '2 days'
  union all
  select 'aviso_nao_saiu', o.id, o.cliente_id, coalesce(o.aviso_erro, o.aviso_status, 'sem registro do aviso'), o.selecionada_em
    from oportunidades_selecionadas o
   where o.status = 'selecionada' and coalesce(o.aviso_status, 'falhou') <> 'aceito' and o.selecionada_em < now() - interval '1 hour'
  union all
  select 'sem_resposta_ha_3_dias', o.id, o.cliente_id, coalesce(o.retrato->'lote'->>'titulo', o.imovel_id::text), o.selecionada_em
    from oportunidades_selecionadas o
   where o.status = 'selecionada' and o.selecionada_em < now() - interval '3 days'
  order by 5;
$$;
