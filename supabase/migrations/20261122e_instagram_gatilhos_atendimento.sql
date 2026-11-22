-- Instagram no estilo ManyChat (22/11): "comenta PATRIMÔNIO que eu te mando o material".
--
-- 1. GATILHOS POR PALAVRA-CHAVE. O dono cadastra a palavra (opcionalmente presa a um post), a
--    mensagem do direct e as respostas públicas. Comentário que casa → private reply (DM) na hora
--    + resposta pública curta sob o comentário. Quem casa e envia é api/instagram-gatilhos.js.
-- 2. LOG DE DISPAROS com `comment_mid` UNIQUE: duas rodadas (webhook + cron de reserva) nunca
--    mandam duas vezes pelo mesmo comentário. É o claim, não um relatório.
-- 3. A CONVERSA de direct/story vira chamado canal 'instagram' na tela de Atendimento (mesmo
--    desenho do WhatsApp). Comentário público NÃO vira chamado: são centenas e a resposta a eles é
--    o gatilho ou a caixa /admin/instagram; quando a pessoa responde o direct, aí sim é conversa.

alter table public.ig_mensagens
  add column if not exists media_id text,            -- post do comentário (escopo do gatilho)
  add column if not exists chamado_msg_id uuid;      -- veio da tela de Atendimento: NÃO espelhar de volta

alter table public.ig_conversas
  add column if not exists chamado_id uuid references public.chamados(id) on delete set null,
  add column if not exists ia_pausada_ate timestamptz;

create table if not exists public.ig_gatilhos (
  id                 bigint generated always as identity primary key,
  palavra            text not null,                         -- como o dono escreveu ("Patrimônio")
  media_id           text,                                  -- null = vale em qualquer post
  media_legenda      text,                                  -- só para a tela mostrar qual post
  mensagem_dm        text not null,                         -- {nome} = @ da pessoa; {link}
  link               text,
  respostas_publicas text[] not null default array[
    'Te mandei no direct! 📩', 'Enviado no seu direct 😉', 'Já está no seu direct!',
    'Confere o direct que mandei pra você 📬'],
  ativo              boolean not null default true,
  valido_ate         timestamptz,
  disparos           integer not null default 0,
  criado_em          timestamptz not null default now(),
  atualizado_em      timestamptz not null default now()
);
alter table public.ig_gatilhos enable row level security;   -- sem política: só o servidor (service key) lê e escreve

create table if not exists public.ig_gatilho_disparos (
  id            bigint generated always as identity primary key,
  gatilho_id    bigint not null references public.ig_gatilhos(id) on delete cascade,
  comment_mid   text not null unique,                       -- claim: 1 disparo por comentário
  ig_user_id    text not null,
  status        text not null default 'enviando' check (status in ('enviando','enviado','repetido','falhou')),
  dm_ok         boolean,
  publica_ok    boolean,
  erro          text,
  criado_em     timestamptz not null default now()
);
create index if not exists ig_gatilho_disparos_pessoa on public.ig_gatilho_disparos (gatilho_id, ig_user_id, criado_em desc);
alter table public.ig_gatilho_disparos enable row level security;

-- Contador na própria linha do gatilho (a tela mostra sem agregar o log).
create or replace function public.ig_gatilho_conta_disparo()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'enviado' and old.status is distinct from 'enviado' then
    update public.ig_gatilhos set disparos = disparos + 1 where id = new.gatilho_id;
  end if;
  return new;
end $$;
create or replace trigger ig_gatilho_disparos_conta after update on public.ig_gatilho_disparos
  for each row execute function public.ig_gatilho_conta_disparo();

-- ─── Espelho Instagram (direct/story) → chamado ────────────────────────────────────────
create or replace function public.ig_espelhar_no_chamado()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  c      public.ig_conversas%rowtype;
  ch_id  uuid;
  ch_st  text;
  rotulo text;
begin
  if new.chamado_msg_id is not null then return new; end if;
  if new.origem not in ('dm', 'story') then return new; end if;
  select * into c from public.ig_conversas where ig_user_id = new.ig_user_id;
  if not found then return new; end if;

  if c.chamado_id is not null then
    select id, status into ch_id, ch_st from public.chamados where id = c.chamado_id;
  end if;
  rotulo := coalesce('@' || nullif(c.username, ''), 'perfil ' || right(new.ig_user_id, 6));

  if ch_id is null or ch_st = 'finalizado' then
    insert into public.chamados (user_nome, titulo, status, canal, origem, criado_em, atualizado_em)
    values (rotulo, left('Instagram · ' || rotulo, 80),
            case when new.autor = 'pessoa' then 'aberto' else 'saudacao' end,
            'instagram', 'instagram', now(), now())
    returning id, status into ch_id, ch_st;
    update public.ig_conversas set chamado_id = ch_id where ig_user_id = new.ig_user_id;
  end if;

  insert into public.chamados_mensagens (chamado_id, autor_tipo, autor_nome, conteudo, canal, criado_em)
  values (ch_id,
          case new.autor when 'pessoa' then 'cliente' when 'bot' then 'ia' else 'atendente' end,
          case new.autor when 'pessoa' then rotulo when 'bot' then 'BidPro (automação)' else 'Equipe (app do Instagram)' end,
          case when new.origem = 'story' then '[respondeu ao story] ' else '' end
            || coalesce(nullif(new.texto, ''), '[mídia ou reação — ver no app]'),
          'instagram', coalesce(new.ocorrido_em, now()));

  update public.chamados
     set atualizado_em = now(),
         status = case when new.autor = 'pessoa' and status = 'saudacao' then 'aberto' else status end
   where id = ch_id;
  return new;
end $$;

create or replace trigger ig_mensagens_espelho_chamado after insert on public.ig_mensagens
  for each row execute function public.ig_espelhar_no_chamado();

-- Badge "respostas não lidas" do chat do site: conversa de WhatsApp/Instagram continua no canal dela.
create or replace function public.suporte_respostas_nao_lidas()
 returns integer language sql security definer set search_path to 'public' as $function$
  select coalesce(count(distinct c.id), 0)::int
    from public.chamados c
    join public.chamados_mensagens m on m.chamado_id = c.id
   where c.user_id = auth.uid()
     and c.canal not in ('whatsapp', 'instagram')
     and m.autor_tipo <> 'cliente'
     and m.criado_em > coalesce(c.cliente_visto_em, c.criado_em);
$function$;
