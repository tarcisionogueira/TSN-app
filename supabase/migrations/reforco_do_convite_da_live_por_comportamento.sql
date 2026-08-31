-- ============================================================================
-- REFORÇO DO CONVITE DA AULA — segmentado por COMPORTAMENTO (31/08)
--
-- O QUE O NÚMERO DIZIA. Edição de 02/09: convite disparado domingo 30/08 11h,
-- 74 tentativas → 73 entregues · 21 aberturas (28,8%, taxa saudável) · **0
-- cliques**. E o rastreador funciona (o tipo `convite_live` tem clique
-- registrado em 29/08), então o zero é real: 21 pessoas leram o convite e
-- nenhuma foi até a página. Nenhum dos 4 inscritos veio do e-mail.
--
-- Um reenvio ÚNICO para a base inteira responderia errado às três situações,
-- que são diferentes e pedem peças diferentes:
--   52 pessoas não abriram   → o problema é o ASSUNTO. Reenviar o mesmo texto
--                              com o mesmo assunto é repetir o que falhou.
--   21 abriram e não clicaram→ o assunto funcionou, a PROMESSA não converteu.
--    0 clicaram sem inscrever→ é o mais quente que existe: só falta a vaga.
--
-- ⚠️ "NÃO ABRIU" PODE SER "AINDA NÃO SEI". `aberto_em` chega por webhook, e
-- tratar a ausência dele como desinteresse é entregar atraso de instrumentação
-- como se fosse comportamento do cliente — a forma #1 desta base, aplicada a
-- marketing. MEDIDO no histórico (149 e-mails com abertura): mediana 6 min,
-- p80 5,7 h, **p90 17,2 h**, p95 26,7 h. Por isso o corte é 18 HORAS depois da
-- ENTREGA, e não do envio: antes disso ninguém é chamado de "não abriu". O
-- número é argumento, não gosto — se a entregabilidade mudar, remeça o p90.
--
-- POR QUE UMA RPC E NÃO TRÊS LEITURAS NO CRON. Os alvos saem de perfis ×
-- inscrições × convites × emails_log cruzados por pessoa. Ler as quatro
-- separadamente e cruzar em JS é exatamente a forma #9 (janela de cache virando
-- janela de dado); e uma delas voltando vazia por erro não lançado viraria
-- "ninguém é alvo" — silêncio com cara de decisão. Aqui é uma consulta só.
-- ============================================================================

create table if not exists public.live_reforco_envio (
  id          uuid primary key default gen_random_uuid(),
  evento_id   uuid not null references public.eventos_live(id) on delete cascade,
  edicao      date not null,
  user_id     uuid not null references public.perfis(id) on delete cascade,
  etapa       text not null check (etapa in ('assunto','prova','ultima')),
  email_ok    boolean,
  criado_em   timestamptz not null default now()
);

-- O CLAIM. Mesmo padrão de `live_convite_envio`: a linha nasce ANTES do envio e
-- é ela que impede o segundo e-mail se o cron repetir, se uma execução morrer no
-- meio, ou se duas rodadas se cruzarem. `email_ok` recebe o desfecho REAL depois
-- — sem isso, "reforçado" significaria apenas "tentei".
create unique index if not exists live_reforco_envio_unico
  on public.live_reforco_envio (evento_id, user_id, edicao, etapa);
create index if not exists live_reforco_envio_edicao_idx
  on public.live_reforco_envio (evento_id, edicao);

alter table public.live_reforco_envio enable row level security;

comment on table public.live_reforco_envio is
  'Dedup e prova de entrega do reforço do convite da aula. Uma linha por pessoa/etapa/edição, '
  'criada ANTES do envio (claim) e fechada com o desfecho real em email_ok.';

-- ─── Quem é alvo de cada etapa, numa consulta só ─────────────────────────────
-- `p_horas_espera` é o corte de "já dá para chamar de não-abriu" (18h, medido).
-- Devolve nome e e-mail para o cron não precisar de uma segunda ida ao banco.
create or replace function public.live_reforco_alvos(
  p_evento        uuid,
  p_edicao        date,
  p_etapa         text,
  p_horas_espera  int default 18,
  p_teto_pessoa   int default 2
)
returns table (user_id uuid, nome text, email text)
language sql
stable
security definer
set search_path = public
as $$
  with marco as (
    -- Só se reforça o que foi convidado: o instante do convite desta edição delimita
    -- a janela de e-mails que contam. Sem convite, não há o que reforçar (e a função
    -- devolve vazio, que aqui é a resposta certa, não uma falha).
    select min(criado_em) as desde
      from public.live_convite_envio
     where evento_id = p_evento and edicao = p_edicao
  ),
  cliente as (
    select p.id, p.nome
      from public.perfis p
     where p.ativo
       and p.role in ('explorador','top2','top2_anual','assessorado',
                      'assessorado_anual','clube','clube_anual')
  ),
  -- Desfecho de leitura AGREGADO por pessoa, sobre o convite E os reforços já
  -- mandados nesta edição: quem abriu o reforço de segunda conta como "abriu".
  leitura as (
    select l.user_id,
           bool_or(l.aberto_em  is not null) as abriu,
           bool_or(l.clicado_em is not null) as clicou,
           bool_or(l.entregue_em is not null
                   and l.entregue_em < now() - make_interval(hours => p_horas_espera)) as entregue_ha_tempo
      from public.emails_log l, marco m
     where l.user_id is not null
       and m.desde is not null
       and l.enviado_em >= m.desde
       and l.tipo in ('convite_live','live_reforco_assunto','live_reforco_prova','live_reforco_ultima')
     group by l.user_id
  )
  select c.id, c.nome, u.email
    from cliente c
    join leitura le on le.user_id = c.id
    join auth.users u on u.id = c.id
   where u.email is not null
     -- nunca para quem já está dentro
     and not exists (select 1 from public.live_inscricoes i
                      where i.evento_id = p_evento and i.user_id = c.id)
     -- nunca para quem pediu para não receber
     and not exists (select 1 from public.alertas_email a
                      where a.user_id = c.id and a.ativo = false)
     -- nunca para endereço suprimido: insistir em quem já deu bounce queima o domínio
     and not exists (select 1 from public.emails_supressao s
                      where lower(s.destinatario) = lower(u.email) and s.suprimido)
     -- teto de reforços por pessoa/edição: 2. Uma base de ~86 pessoas não aguenta
     -- mais que isso numa semana, e a terceira peça converte menos do que custa.
     and (select count(*) from public.live_reforco_envio r
           where r.evento_id = p_evento and r.edicao = p_edicao and r.user_id = c.id) < p_teto_pessoa
     -- e nunca duas vezes a MESMA etapa (o índice único é a trava; isto evita a ida)
     and not exists (select 1 from public.live_reforco_envio r
                      where r.evento_id = p_evento and r.edicao = p_edicao
                        and r.user_id = c.id and r.etapa = p_etapa)
     and case p_etapa
           -- não abriu, e já esperou tempo suficiente para o webhook ter chegado
           when 'assunto' then (not le.abriu) and le.entregue_ha_tempo
           -- abriu e não clicou: o assunto funcionou, a promessa não
           when 'prova'   then le.abriu and not le.clicou
           -- clicou e não se inscreveu: o mais quente que existe
           when 'ultima'  then le.clicou
           else false
         end;
$$;

-- Lê `auth.users` (o e-mail mora lá), então é SECURITY DEFINER por necessidade:
-- `service_role` não enxerga o schema `auth`. É a mesma regra que o conserto do
-- painel de invariantes desta manhã estabeleceu.
--
-- ⚠️ Revogar dos TRÊS. O Supabase concede EXECUTE a `anon` e `authenticated` por
-- default privilege em toda função nova de `public`, e `revoke ... from public`
-- NÃO tira grant de papel. Uma DEFINER que lê e-mail de cliente aberta ao anônimo
-- seria vazamento de PII. Confira `pg_proc.proacl` depois de aplicar: o esperado
-- é {postgres=X/postgres,service_role=X/postgres}.
revoke all on function public.live_reforco_alvos(uuid, date, text, int, int) from public, anon, authenticated;
grant execute on function public.live_reforco_alvos(uuid, date, text, int, int) to service_role;
