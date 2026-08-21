-- ═══════════════════════════════════════════════════════════════════════════════
-- CONSULTOR COMERCIAL — FASE 1 (plano: docs/PLANO_CONSULTOR_COMERCIAL.md, v2)
-- Trilha append-only + NPS + colunas de ciclo + RPCs de colunas mínimas + regras.
--
-- Princípios que esta migração APLICA (decisões do dono, 21/08):
--   • Escopo: consultor comercial vê SÓ leads alavancagem_% atribuídos a ele —
--     o filtro mora DENTRO de comercial_meus_leads, não na tela.
--   • Contato (whatsapp/email) só aparece DEPOIS de "Receber cliente" — e o ato
--     de receber é o próprio registro (evento 'recebido', timestamp do servidor).
--   • Trilha imutável: sdr_lead_eventos não tem policy de UPDATE/DELETE para
--     ninguém; toda escrita passa pelas RPCs SECURITY DEFINER.
--   • Role do usuário NÃO muda: o gate é perfis.vendedor_tipo='consultor' (ou admin).
-- Idempotente: pode rodar de novo sem quebrar.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Colunas de ciclo em sdr_leads ─────────────────────────────────────────
alter table public.sdr_leads add column if not exists recebido_em     timestamptz;
alter table public.sdr_leads add column if not exists finalizado_em   timestamptz;
alter table public.sdr_leads add column if not exists resultado       text;
alter table public.sdr_leads add column if not exists resultado_motivo text;
do $$ begin
  alter table public.sdr_leads add constraint sdr_leads_resultado_ck
    check (resultado is null or resultado in ('ganho','perdido','sem_contato'));
exception when duplicate_object then null; end $$;
-- O CHECK original de status era do vocabulário SDR (novo/contatado/qualificado/
-- convertido/perdido) e recusava o ciclo comercial — o teste de mesa da F1 pegou
-- ANTES de qualquer cliente. Amplia mantendo o vocabulário antigo válido (outros
-- fluxos o usam); o ciclo do comercial soma atribuido/em_atendimento/finalizado.
alter table public.sdr_leads drop constraint if exists sdr_leads_status_check;
alter table public.sdr_leads add constraint sdr_leads_status_check
  check (status = any (array['novo','contatado','qualificado','convertido','perdido',
                             'atribuido','em_atendimento','finalizado']));

-- ── 2. Trilha append-only ────────────────────────────────────────────────────
create table if not exists public.sdr_lead_eventos (
  id          bigint generated always as identity primary key,
  lead_id     uuid not null references public.sdr_leads(id) on delete cascade,
  autor_id    uuid,
  autor_papel text not null check (autor_papel in ('consultor','admin','sistema','cliente')),
  tipo        text not null check (tipo in ('atribuido','recebido','contato','feedback',
                'atendimento_confirmado','finalizado','reaberto','nps_enviado','nps_respondido')),
  comentario  text,
  criado_em   timestamptz not null default now()
);
create index if not exists sdr_lead_eventos_lead_idx on public.sdr_lead_eventos (lead_id, criado_em);
alter table public.sdr_lead_eventos enable row level security;
-- SELECT: admin vê tudo; consultor vê a trilha dos SEUS leads. Sem policy de
-- INSERT/UPDATE/DELETE: cliente nenhum escreve direto — só as RPCs (definer).
drop policy if exists lead_eventos_select on public.sdr_lead_eventos;
create policy lead_eventos_select on public.sdr_lead_eventos for select using (
  exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin')
  or exists (select 1 from public.sdr_leads l where l.id = lead_id and l.consultor_id = (select auth.uid()))
);

-- ── 3. NPS do cliente (a contraprova; envio/resposta chegam na F5) ───────────
create table if not exists public.sdr_lead_nps (
  id           uuid primary key default gen_random_uuid(),
  lead_id      uuid not null unique references public.sdr_leads(id) on delete cascade,
  token        text not null unique,
  enviado_em   timestamptz,
  respondido_em timestamptz,
  contratou    boolean,
  nota         int check (nota between 0 and 10),
  comentario   text,
  criado_em    timestamptz not null default now()
);
alter table public.sdr_lead_nps enable row level security;
drop policy if exists lead_nps_admin on public.sdr_lead_nps;
create policy lead_nps_admin on public.sdr_lead_nps for select using (
  exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin')
);

-- ── 4. RPCs ──────────────────────────────────────────────────────────────────
-- Gate comum: admin OU capacidade vendedor_tipo='consultor' (role do plano intacto).
create or replace function public.comercial_gate()
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_papel text;
begin
  if (select auth.uid()) is null then raise exception 'nao autenticado'; end if;
  select case when role = 'admin' then 'admin'
              when vendedor_tipo = 'consultor' then 'consultor' end
    into v_papel from public.perfis where id = (select auth.uid());
  if v_papel is null then raise exception 'sem acesso comercial'; end if;
  return v_papel;
end $$;

-- Lista dos MEUS leads de alavancagem. As regras são LIDAS de regra_negocio (dado,
-- não comentário — padrão da casa): o escopo vem de regra('comercial.escopo_leads')
-- e a ocultação de contato de regra('comercial.contato_apos_receber'). Fallbacks
-- sempre RESTRITIVOS: regra ausente FECHA o acesso, nunca abre.
create or replace function public.comercial_meus_leads()
returns table (
  id uuid, nome text, produto text, origem text, status text,
  criado_em timestamptz, recebido_em timestamptz, finalizado_em timestamptz,
  resultado text, telefone text, email text,
  ultimo_evento_tipo text, ultimo_evento_em timestamptz
) language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, l.nome,
         case l.origem when 'alavancagem_home_equity' then 'Home Equity'
                       when 'alavancagem_consorcio'   then 'Consórcio'
                       else l.origem end,
         l.origem, l.status, l.criado_em, l.recebido_em, l.finalizado_em, l.resultado,
         case when l.recebido_em is not null
               and coalesce(public.regra('comercial.contato_apos_receber')->>'evento_de_revelacao','recebido') = 'recebido'
              then l.whatsapp end,
         case when l.recebido_em is not null
               and coalesce(public.regra('comercial.contato_apos_receber')->>'evento_de_revelacao','recebido') = 'recebido'
              then l.email end,
         e.tipo, e.criado_em
    from public.sdr_leads l
    left join lateral (select tipo, criado_em from public.sdr_lead_eventos ev
                        where ev.lead_id = l.id order by ev.criado_em desc limit 1) e on true
   where public.comercial_gate() is not null
     and l.consultor_id = (select auth.uid())
     and l.origem = any (coalesce(
           (select array(select jsonb_array_elements_text(public.regra('comercial.escopo_leads')->'origens'))),
           array['alavancagem_consorcio','alavancagem_home_equity']))
   order by l.criado_em desc;
$$;

-- "Receber cliente": confirma o início do atendimento, grava o evento e SÓ ENTÃO
-- devolve o contato. A revelação é o registro.
create or replace function public.comercial_receber_lead(p_lead uuid)
returns table (nome text, telefone text, email text)
language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_papel text; v_lead public.sdr_leads;
begin
  v_papel := public.comercial_gate();
  select * into v_lead from public.sdr_leads
   where id = p_lead and consultor_id = (select auth.uid())
     and origem = any (coalesce(
           (select array(select jsonb_array_elements_text(public.regra('comercial.escopo_leads')->'origens'))),
           array['alavancagem_consorcio','alavancagem_home_equity']))
   for update;
  if not found then raise exception 'lead nao encontrado ou nao atribuido a voce'; end if;
  if v_lead.recebido_em is null then
    update public.sdr_leads set recebido_em = now(), status = 'em_atendimento' where id = p_lead;
    -- Aplica regra('comercial.contato_apos_receber'): o evento de revelação registrado
    -- é o que autoriza comercial_meus_leads a expor o contato deste lead.
    insert into public.sdr_lead_eventos (lead_id, autor_id, autor_papel, tipo, comentario)
    values (p_lead, (select auth.uid()), v_papel,
            coalesce(public.regra('comercial.contato_apos_receber')->>'evento_de_revelacao','recebido'),
            'Cliente recebido — início do atendimento');
  end if;
  return query select v_lead.nome, v_lead.whatsapp, v_lead.email;
end $$;

-- Acompanhamento e finalização. Regras aplicadas AQUI (não na tela):
--   • só lead RECEBIDO aceita evento (não se atende o que não se recebeu);
--   • 'feedback' exige comentário; 'finalizado' exige comentário (≥5) + resultado,
--     e 'perdido' exige motivo estruturado (cruza com o NPS na F5);
--   • 'atendimento_confirmado' é único (é o gatilho dos 15 dias do NPS);
--   • 'reaberto' reabre um finalizado (trilha guarda o histórico completo).
create or replace function public.comercial_registrar_evento(
  p_lead uuid, p_tipo text, p_comentario text default null,
  p_resultado text default null, p_motivo text default null
) returns void language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare
  v_papel text; v_lead public.sdr_leads;
  -- Regra lida como DADO (padrão da casa): mínimos e exigências vêm de
  -- regra('comercial.finalizar_exige_comentario'); fallback é o valor MAIS exigente.
  v_regra jsonb := public.regra('comercial.finalizar_exige_comentario');
  v_min int;
begin
  v_min := coalesce((v_regra->>'min_chars')::int, 5);
  v_papel := public.comercial_gate();
  select * into v_lead from public.sdr_leads
   where id = p_lead and consultor_id = (select auth.uid())
     and origem = any (coalesce(
           (select array(select jsonb_array_elements_text(public.regra('comercial.escopo_leads')->'origens'))),
           array['alavancagem_consorcio','alavancagem_home_equity']))
   for update;
  if not found then raise exception 'lead nao encontrado ou nao atribuido a voce'; end if;
  if v_lead.recebido_em is null then raise exception 'receba o cliente antes de registrar eventos'; end if;
  if p_tipo not in ('contato','feedback','atendimento_confirmado','finalizado','reaberto') then
    raise exception 'tipo de evento invalido';
  end if;
  if p_tipo = 'feedback' and coalesce(length(trim(p_comentario)), 0) < 3 then
    raise exception 'feedback exige comentario';
  end if;
  if p_tipo = 'atendimento_confirmado' and exists (
    select 1 from public.sdr_lead_eventos where lead_id = p_lead and tipo = 'atendimento_confirmado'
  ) then raise exception 'atendimento ja confirmado para este cliente'; end if;
  if p_tipo = 'finalizado' then
    if v_lead.finalizado_em is not null then raise exception 'lead ja finalizado'; end if;
    if coalesce(length(trim(p_comentario)), 0) < v_min then raise exception 'finalizar exige comentario'; end if;
    if not (p_resultado = any (coalesce(
          (select array(select jsonb_array_elements_text(v_regra->'resultados'))),
          array['ganho','perdido','sem_contato']))) then
      raise exception 'resultado invalido (ganho/perdido/sem_contato)';
    end if;
    if p_resultado = 'perdido' and coalesce((v_regra->>'perdido_exige_motivo')::boolean, true)
       and p_motivo not in ('sem_interesse','nao_qualificou','fechou_por_fora','outro') then
      raise exception 'perdido exige motivo (sem_interesse/nao_qualificou/fechou_por_fora/outro)';
    end if;
    update public.sdr_leads
       set finalizado_em = now(), resultado = p_resultado,
           resultado_motivo = case when p_resultado = 'perdido' then p_motivo end,
           status = 'finalizado'
     where id = p_lead;
  elsif p_tipo = 'reaberto' then
    if v_lead.finalizado_em is null then raise exception 'so se reabre lead finalizado'; end if;
    update public.sdr_leads
       set finalizado_em = null, resultado = null, resultado_motivo = null, status = 'em_atendimento'
     where id = p_lead;
  end if;
  insert into public.sdr_lead_eventos (lead_id, autor_id, autor_papel, tipo, comentario)
  values (p_lead, (select auth.uid()), v_papel, p_tipo,
          case when p_tipo = 'finalizado'
               then coalesce(p_resultado,'') || coalesce(' ('||p_motivo||')','') || ': ' || p_comentario
               else p_comentario end);
end $$;

-- Visão TOTAL do admin: cada lead de alavancagem com dono, trilha e NPS.
create or replace function public.admin_comercial_visao()
returns table (
  id uuid, nome text, whatsapp text, email text, origem text, status text,
  criado_em timestamptz, recebido_em timestamptz, finalizado_em timestamptz,
  resultado text, resultado_motivo text,
  consultor_id uuid, consultor_nome text, eventos jsonb, nps jsonb
) language sql stable security definer set search_path = public, pg_temp as $$
  select l.id, l.nome, l.whatsapp, l.email, l.origem, l.status,
         l.criado_em, l.recebido_em, l.finalizado_em, l.resultado, l.resultado_motivo,
         l.consultor_id, pc.nome,
         coalesce((select jsonb_agg(jsonb_build_object('tipo', ev.tipo, 'papel', ev.autor_papel,
                    'comentario', ev.comentario, 'em', ev.criado_em) order by ev.criado_em)
                    from public.sdr_lead_eventos ev where ev.lead_id = l.id), '[]'::jsonb),
         (select to_jsonb(n) - 'token' from public.sdr_lead_nps n where n.lead_id = l.id)
    from public.sdr_leads l
    left join public.perfis pc on pc.id = l.consultor_id
   where exists (select 1 from public.perfis p where p.id = (select auth.uid()) and p.role = 'admin')
     and l.origem like 'alavancagem_%'
   order by l.criado_em desc;
$$;

-- Superfície: nada para anon; autenticado chama (o gate decide por dentro).
revoke all on function public.comercial_gate() from public, anon;
revoke all on function public.comercial_meus_leads() from public, anon;
revoke all on function public.comercial_receber_lead(uuid) from public, anon;
revoke all on function public.comercial_registrar_evento(uuid, text, text, text, text) from public, anon;
revoke all on function public.admin_comercial_visao() from public, anon;
grant execute on function public.comercial_gate(), public.comercial_meus_leads(),
  public.comercial_receber_lead(uuid),
  public.comercial_registrar_evento(uuid, text, text, text, text),
  public.admin_comercial_visao() to authenticated;

-- ── 5. Regras de negócio (a auditoria 2b passa a vigiar) ─────────────────────
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values
  ('comercial.escopo_leads',
   '{"origens":["alavancagem_consorcio","alavancagem_home_equity"],"atribuicao":"consultor_id"}',
   'Consultor comercial vê EXCLUSIVAMENTE leads de alavancagem atribuídos a ele (dono, 21/08)',
   array['comercial_meus_leads'], true),
  ('comercial.contato_apos_receber',
   '{"colunas_ocultas_antes":["whatsapp","email"],"evento_de_revelacao":"recebido"}',
   'Contato do cliente só aparece após o botão Receber cliente — a revelação é o registro (dono, 21/08)',
   array['comercial_meus_leads','comercial_receber_lead'], true),
  ('comercial.finalizar_exige_comentario',
   '{"min_chars":5,"resultados":["ganho","perdido","sem_contato"],"perdido_exige_motivo":true}',
   'Finalizar lead exige comentário e resultado; perdido exige motivo estruturado',
   array['comercial_registrar_evento'], true),
  ('comercial.nps_cliente_15d',
   '{"dias":15,"gatilho":"atendimento_confirmado","perguntas":["contratou","nota","comentario"]}',
   'NPS ao cliente 15 dias após a confirmação do atendimento (dono, 21/08) — ATIVAR na F5, quando o cron de envio existir',
   array[]::text[], false)
on conflict (chave) do update
  set valor = excluded.valor, descricao = excluded.descricao,
      aplicada_por = excluded.aplicada_por, ativo = excluded.ativo,
      atualizado_em = now();
