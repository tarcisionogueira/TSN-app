-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CADÊNCIA DE E-MAIL POR SEGMENTO (pedido do dono, 24/09) — números como DADO, não código.
--
-- Medido (60 d, e-mail de oportunidades): gratuito NOVO clica 10%, ATIVO no site 8,5%,
-- INATIVO 0,5% (1 clique em 204). Assessorado 0% de abertura em 10. E cada usuário recebia
-- 8-10 e-mails/mês SOMANDO campanhas — oportunidades eram só ~1/4 disso. Mandar a quem não
-- abre degrada a reputação do domínio e empurra para o spam o e-mail de QUEM PAGA.
--
-- app_config.cadencia_email (JSON, editável sem deploy):
--   dias por segmento: pagante 7 · assessorado 14 · novo (<14 d de conta) 7 · ativo (site ou
--   clique em 30 d) 14 · inativo 28 · pausado 60 (inativo com 7 envios seguidos sem abrir =
--   4 semanais + 3 mensais) · itens para gratuito ativo 6 · alerta imediato do pagante: até 2
--   por semana, só lote NOVO (36 h) com nota ≥ 80 · campanhas: gratuito 1/semana e no máximo 2
--   e-mails/semana somando oportunidades; pagante 2 campanhas/semana.
-- ─────────────────────────────────────────────────────────────────────────────────────────
insert into public.app_config (key, value, updated_at) values ('cadencia_email',
  '{"pagante":7,"assessorado":14,"novo":7,"ativo":14,"inativo":28,"pausado":60,"novo_dias_conta":14,"ativo_janela_dias":30,"pausa_apos_sem_abrir":7,"itens_padrao":12,"itens_gratuito_ativo":6,"imediato_max_semana":2,"imediato_piso_pontos":80,"imediato_janela_horas":36,"campanhas_semana_gratuito":1,"emails_semana_gratuito":2,"campanhas_semana_pagante":2}',
  now())
on conflict (key) do nothing;

-- Sinais por cliente para o cron de oportunidades (uma chamada por LOTE, não por cliente).
create or replace function public.alertas_sinais_lote(p_user_ids uuid[])
returns table(user_id uuid, ultima_atividade timestamptz, ultimo_clique timestamptz,
              imediatos_7d integer, enviados_ult7 integer, abertos_ult7 integer)
language sql stable security definer set search_path to 'public' as $$
  with ids as (select unnest(p_user_ids) as uid)
  select ids.uid,
    (select max(e.criado_em) from public.eventos_atividade e
      where e.user_id = ids.uid and e.criado_em > now() - interval '90 days'),
    (select max(l.clicado_em) from public.emails_log l
      where l.user_id = ids.uid and l.clicado_em is not null),
    (select count(*)::int from public.emails_log l
      where l.user_id = ids.uid and l.tipo = 'oportunidade_imediata' and l.enviado_em > now() - interval '7 days'),
    coalesce(u.env, 0), coalesce(u.abr, 0)
  from ids
  left join lateral (
    select count(*)::int env, count(x.aberto_em)::int abr from (
      select l.aberto_em from public.emails_log l
       where l.user_id = ids.uid and l.tipo = 'oportunidades'
       order by l.enviado_em desc limit 7) x
  ) u on true;
$$;
revoke all on function public.alertas_sinais_lote(uuid[]) from public, anon, authenticated;
grant execute on function public.alertas_sinais_lote(uuid[]) to service_role;

-- Limite semanal de CAMPANHA por cliente (chamado por api/_email.js antes de reservar orçamento).
-- Campanha = tipo que casa '^(ativacao|divulgacao_|convite_live|live_reforco|campanha_|lancamento_)'
-- (MESMA regex de api/_email.js). Transacional (boas-vindas, contrato, pagamento, lembrete de
-- live a quem se inscreveu) não passa por aqui. Oportunidades CONTAM no total do gratuito — é
-- a prioridade dele; a campanha é que cede.
create or replace function public.email_campanha_permitida(p_user_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with cfg as (
    select coalesce((select value::jsonb from public.app_config where key = 'cadencia_email'), '{}'::jsonb) c
  ), p as (
    select role from public.perfis where id = p_user_id
  ), e as (
    select count(*) filter (where tipo ~ '^(ativacao|divulgacao_|convite_live|live_reforco|campanha_|lancamento_)') camp,
           count(*) filter (where tipo in ('oportunidades', 'oportunidade_imediata')) oport
      from public.emails_log
     -- SAIU de fato = qualquer status fora de represado/barrado/falho. ⚠️ Não é só 'enviado': o
     -- webhook do Resend troca para 'entregue' (1.816 de ~1.980 linhas em 24/09) — contar só
     -- 'enviado' mediria quase nada e o limite nunca bateria (forma nº 10).
     where user_id = p_user_id and enviado_em > now() - interval '7 days'
       and coalesce(status, '') not in ('enfileirado', 'suprimido', 'falha', 'limitado')
  )
  select case
    when (select role from p) in ('top2', 'top2_anual', 'clube', 'assessorado', 'admin')
      then e.camp < coalesce((cfg.c->>'campanhas_semana_pagante')::int, 2)
    else e.camp < coalesce((cfg.c->>'campanhas_semana_gratuito')::int, 1)
     and e.camp + e.oport < coalesce((cfg.c->>'emails_semana_gratuito')::int, 2)
  end
  from e, cfg;
$$;
revoke all on function public.email_campanha_permitida(uuid) from public, anon, authenticated;
grant execute on function public.email_campanha_permitida(uuid) to service_role;
