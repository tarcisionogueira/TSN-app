-- WhatsApp via Evolution (QR) + Atendimento unificado + SDR com fila ativa (22/11, pedido do dono).
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- 1. TODA conversa de WhatsApp aparece na tela de ATENDIMENTO como um chamado canal='whatsapp'.
--    O espelho é um GATILHO em wa_mensagens: as duas portas (Cloud API e Evolution), a IA, a fila
--    ativa e a equipe pelo celular passam todas por wa_mensagens — um ponto só, nada fica de fora.
--    O caminho contrário (equipe responde NA TELA) grava wa_mensagens com `chamado_msg_id`, e o
--    gatilho pula essas linhas: a mensagem já está no chamado, espelhar duplicaria.
-- 2. Fila de mensagens ATIVAS (wa_disparos): 1 envio a cada 2 min (o cron garante), aberturas
--    variadas (wa_aberturas), lembrete único se não responder (etapa 2) e respeito a SAIR (optout).
-- 3. Estado da conexão da Evolution (wa_canal_estado): o chip atual está inativo; queda = e-mail.
-- Tabelas só do servidor: RLS ligada, zero policies (igual a wa_conversas).

alter table public.wa_conversas
  add column if not exists chamado_id uuid references public.chamados(id) on delete set null,
  add column if not exists interesse  text,          -- investidor_pro|veiculos|combo|assessoria|ebook|indefinido (do [[PERFIL]])
  add column if not exists optout_em  timestamptz;   -- pediu para não receber mensagem ativa

alter table public.wa_mensagens
  add column if not exists chamado_msg_id uuid;      -- veio da tela de Atendimento: NÃO espelhar de volta

create table if not exists public.wa_canal_estado (
  canal         text primary key,
  estado        text,
  atualizado_em timestamptz not null default now(),
  alertado_em   timestamptz
);
alter table public.wa_canal_estado enable row level security;
revoke all on public.wa_canal_estado from anon, authenticated;

-- ─── 1. Espelho WhatsApp → chamado ─────────────────────────────────────────────────────
create or replace function public.wa_espelhar_no_chamado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c        public.wa_conversas%rowtype;
  ch_id    uuid;
  ch_st    text;
  rotulo   text;
begin
  if new.chamado_msg_id is not null then return new; end if;
  select * into c from public.wa_conversas where telefone = new.telefone;
  if not found then return new; end if;

  if c.chamado_id is not null then
    select id, status into ch_id, ch_st from public.chamados where id = c.chamado_id;
  end if;
  rotulo := coalesce(nullif(c.nome, ''), case when new.telefone like '%@%' then 'contato' else '+' || new.telefone end);

  -- Sem chamado, ou o último foi finalizado → abre outro. NÓS começarmos (fila/IA) não é chamado
  -- aberto: nasce 'saudacao' (mesma regra do chat do site, 18/08) e vira 'aberto' quando a pessoa fala.
  if ch_id is null or ch_st = 'finalizado' then
    insert into public.chamados (user_id, user_nome, titulo, status, canal, origem, criado_em, atualizado_em)
    values (c.user_id, rotulo, left('WhatsApp · ' || rotulo, 80),
            case when new.autor = 'pessoa' then 'aberto' else 'saudacao' end,
            'whatsapp', 'whatsapp', now(), now())
    returning id, status into ch_id, ch_st;
    update public.wa_conversas set chamado_id = ch_id where telefone = new.telefone;
  end if;

  insert into public.chamados_mensagens (chamado_id, autor_tipo, autor_nome, conteudo, canal, criado_em)
  values (ch_id,
          case new.autor when 'pessoa' then 'cliente' when 'ia' then 'ia' else 'atendente' end,
          case new.autor when 'pessoa' then rotulo when 'ia' then 'BidPro Assistente' else 'Equipe (celular)' end,
          coalesce(nullif(new.texto, ''), '[' || coalesce(new.tipo, 'mensagem') || ']'),
          'whatsapp', coalesce(new.ocorrido_em, now()));

  update public.chamados
     set atualizado_em = now(),
         status = case when new.autor = 'pessoa' and status = 'saudacao' then 'aberto' else status end
   where id = ch_id;
  return new;
end $$;

create or replace trigger wa_mensagens_espelho_chamado after insert on public.wa_mensagens
  for each row execute function public.wa_espelhar_no_chamado();

-- Escalou (IA pediu humano) → o chamado sobe para o topo da fila da equipe. Casou com um perfil →
-- o chamado ganha o dono (aparece com nome/plano na tela e no Cliente 360).
create or replace function public.wa_conversa_sincroniza_chamado()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.chamado_id is null then return new; end if;
  if new.escalada_em is distinct from old.escalada_em and new.escalada_em is not null then
    update public.chamados set status = 'aguardando_atendente', atualizado_em = now()
     where id = new.chamado_id and status in ('saudacao', 'aberto');
  end if;
  if new.user_id is distinct from old.user_id and new.user_id is not null then
    update public.chamados set user_id = new.user_id where id = new.chamado_id and user_id is null;
  end if;
  return new;
end $$;

create or replace trigger wa_conversas_sincroniza_chamado after update on public.wa_conversas
  for each row execute function public.wa_conversa_sincroniza_chamado();

-- ─── 2. Fila ativa ─────────────────────────────────────────────────────────────────────
create table if not exists public.wa_aberturas (
  id        bigserial primary key,
  etapa     int not null default 1 check (etapa in (1, 2)),   -- 1 = abertura · 2 = lembrete
  texto     text not null,                                     -- {nome} = primeiro nome (some se não houver)
  ativo     boolean not null default true,
  criado_em timestamptz not null default now()
);

create table if not exists public.wa_disparos (
  id            bigserial primary key,
  telefone      text not null,
  nome          text,
  user_id       uuid references public.perfis(id) on delete set null,
  campanha      text not null default 'ativacao',
  etapa         int not null default 1 check (etapa in (1, 2)),
  status        text not null default 'agendado'
                check (status in ('agendado','enviando','enviado','respondido','cancelado','erro')),
  agendado_para timestamptz not null default now(),
  enviado_em    timestamptz,
  wamid         text,
  texto         text,
  erro          text,
  criado_em     timestamptz not null default now(),
  unique (telefone, campanha, etapa)
);
create index if not exists wa_disparos_fila_idx on public.wa_disparos (agendado_para) where status = 'agendado';
create index if not exists wa_disparos_enviado_idx on public.wa_disparos (enviado_em desc) where enviado_em is not null;

alter table public.wa_aberturas enable row level security;
alter table public.wa_disparos  enable row level security;
revoke all on public.wa_aberturas, public.wa_disparos from anon, authenticated;

-- Telefone BR → só dígitos com 55. Devolve null se não parece celular/fixo brasileiro.
create or replace function public.wa_tel_canonico(p text)
returns text language sql immutable as $$
  with d as (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as x)
  select case
    when length(x) in (12, 13) and left(x, 2) = '55' then x
    when length(x) in (10, 11) then '55' || x
    else null end
  from d
$$;

-- Enfileira contatos [{telefone, nome?, user_id?}]. Pula quem pediu SAIR e quem já está
-- conversando (escreveu nos últimos 7 dias). Repetido na mesma campanha = ignorado (UNIQUE).
create or replace function public.wa_disparos_enfileirar(p_contatos jsonb, p_campanha text default 'ativacao')
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with entrada as (
    select distinct on (public.wa_tel_canonico(e->>'telefone'))
           public.wa_tel_canonico(e->>'telefone') as tel,
           nullif(trim(e->>'nome'), '') as nome,
           nullif(e->>'user_id', '')::uuid as uid
      from jsonb_array_elements(coalesce(p_contatos, '[]'::jsonb)) e
  ), ok as (
    select * from entrada en
     where en.tel is not null
       and not exists (select 1 from wa_conversas c where c.telefone = en.tel and c.optout_em is not null)
       and not exists (select 1 from wa_mensagens m where m.telefone = en.tel and m.autor = 'pessoa'
                        and m.criado_em > now() - interval '7 days')
  ), ins as (
    insert into wa_disparos (telefone, nome, user_id, campanha, etapa)
    select tel, nome, uid, coalesce(nullif(p_campanha, ''), 'ativacao'), 1 from ok
    on conflict (telefone, campanha, etapa) do nothing
    returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- Segmentos prontos para a fila (o dono escolhe por nome, sem montar lista à mão):
--   'exploradores' — conta grátis com telefone, mais recentes primeiro;
--   'sdr_leads'    — leads dos links SDR que não viraram cliente.
create or replace function public.wa_disparos_enfileirar_segmento(p_segmento text, p_limite int default 50, p_campanha text default null)
returns int language plpgsql security definer set search_path = public as $$
declare lista jsonb;
begin
  if p_segmento = 'exploradores' then
    select coalesce(jsonb_agg(jsonb_build_object('telefone', telefone, 'nome', nome, 'user_id', id)), '[]')
      into lista
      from (select id, nome, telefone from perfis
             where role = 'explorador' and telefone is not null and length(regexp_replace(telefone, '\D', '', 'g')) >= 10
             order by created_at desc nulls last limit greatest(1, least(coalesce(p_limite, 50), 500))) s;
  elsif p_segmento = 'sdr_leads' then
    select coalesce(jsonb_agg(jsonb_build_object('telefone', whatsapp, 'nome', nome, 'user_id', user_id)), '[]')
      into lista
      from (select nome, whatsapp, user_id from sdr_leads
             where whatsapp is not null and coalesce(resultado, '') not in ('ganho', 'perdido')
             order by criado_em desc nulls last limit greatest(1, least(coalesce(p_limite, 50), 500))) s;
  else
    raise exception 'segmento desconhecido: % (use exploradores ou sdr_leads)', p_segmento;
  end if;
  return public.wa_disparos_enfileirar(lista, coalesce(p_campanha, 'ativacao_' || p_segmento));
end $$;

-- Lembrete (etapa 2): abertura enviada há p_dias+ e a pessoa não escreveu desde então.
create or replace function public.wa_disparos_lembretes(p_dias int default 3)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  with alvo as (
    select d.* from wa_disparos d
     where d.etapa = 1 and d.status = 'enviado' and d.enviado_em < now() - make_interval(days => p_dias)
       and not exists (select 1 from wa_mensagens m where m.telefone = d.telefone and m.autor = 'pessoa' and m.criado_em > d.enviado_em)
       and not exists (select 1 from wa_conversas c where c.telefone = d.telefone and c.optout_em is not null)
  ), ins as (
    insert into wa_disparos (telefone, nome, user_id, campanha, etapa)
    select telefone, nome, user_id, campanha, 2 from alvo
    on conflict (telefone, campanha, etapa) do nothing returning 1
  )
  select count(*) into n from ins;
  return n;
end $$;

-- Painel rápido da fila (o dono consulta pelo Claude ou pelo endpoint admin).
create or replace function public.wa_disparos_resumo()
returns table (campanha text, etapa int, status text, quantidade bigint, ultimo_envio timestamptz)
language sql stable security definer set search_path = public as $$
  select campanha, etapa, status, count(*), max(enviado_em) from wa_disparos group by 1, 2, 3 order by 1, 2, 3
$$;

revoke all on function public.wa_espelhar_no_chamado(), public.wa_conversa_sincroniza_chamado(),
  public.wa_disparos_enfileirar(jsonb, text), public.wa_disparos_enfileirar_segmento(text, int, text),
  public.wa_disparos_lembretes(int), public.wa_disparos_resumo() from public, anon, authenticated;
grant execute on function public.wa_disparos_enfileirar(jsonb, text), public.wa_disparos_enfileirar_segmento(text, int, text),
  public.wa_disparos_lembretes(int), public.wa_disparos_resumo() to service_role;

-- Perfil pelo CÓDIGO que o widget do site manda no WhatsApp ("código BP-1a2b3c4d" = 8 primeiros
-- hex do id). Só o servidor chama; devolve no máximo 1 (ambíguo = ninguém).
create or replace function public.wa_perfil_por_codigo(p_codigo text)
returns table (id uuid, nome text, role text)
language sql stable security definer set search_path = public as $$
  select p.id, p.nome, p.role from perfis p
   where length(coalesce(p_codigo, '')) = 8 and p_codigo ~ '^[0-9a-f]{8}$' and p.id::text like p_codigo || '%'
   and (select count(*) from perfis q where q.id::text like p_codigo || '%') = 1
$$;
revoke all on function public.wa_perfil_por_codigo(text) from public, anon, authenticated;
grant execute on function public.wa_perfil_por_codigo(text) to service_role;

-- Aberturas iniciais (o dono edita/adiciona na tabela). Sempre: quem somos, por que escrevemos,
-- uma pergunta aberta e a saída (SAIR). Variar o texto evita a mesma frase em massa.
insert into public.wa_aberturas (etapa, texto)
select v.etapa, v.texto from (values
  (1, 'Oi{nome}! Aqui é da BidPro Brasil, a plataforma de imóveis e veículos de leilão. Vi que você se cadastrou com a gente e queria entender: hoje você busca mais imóvel ou veículo? (Se preferir não receber mensagens, é só responder SAIR.)'),
  (1, 'Olá{nome}, tudo bem? Sou da equipe BidPro Brasil. Estamos ajudando investidores a achar boas oportunidades em leilão e queria saber qual é o seu objetivo hoje: investir para revender, alugar ou usar? (Responda SAIR se não quiser mais mensagens.)'),
  (1, 'Oi{nome}! Passando para me apresentar: sou da BidPro Brasil. Você já chegou a arrematar algo em leilão ou está começando agora? Assim consigo te indicar o melhor caminho. (Para não receber mais, responda SAIR.)'),
  (1, 'Olá{nome}! Aqui é da BidPro. Tem saído muita oportunidade boa em leilão nas últimas semanas. Qual região você mais acompanha? Posso te mostrar como filtrar por lá. (Se não quiser receber, é só mandar SAIR.)'),
  (2, 'Oi{nome}, voltando aqui rapidinho: se tiver qualquer dúvida sobre leilão de imóveis ou veículos, é só me chamar. O que mais te trava hoje para dar o primeiro lance? (Responda SAIR para não receber mais.)'),
  (2, 'Olá{nome}! Só para não deixar passar: quer que eu te mostre como encontrar oportunidades de leilão na sua região? Me diz a cidade que eu te explico. (SAIR para não receber mais mensagens.)')
) as v(etapa, texto)
where not exists (select 1 from public.wa_aberturas);
