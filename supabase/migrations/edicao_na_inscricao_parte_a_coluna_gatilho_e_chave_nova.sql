-- ══════════════════════════════════════════════════════════════════════════════════════
-- A EDIÇÃO ENTRA NA INSCRIÇÃO — parte A (compatível com o código VELHO ainda no ar).
-- ══════════════════════════════════════════════════════════════════════════════════════
-- DECISÃO DO DONO (03/09): "Cada lead faz parte. Não é para ficar mudo até que se torne
-- pagante." O critério de exclusão NÃO é "já se inscreveu alguma vez" — é "já está inscrito
-- NA EDIÇÃO CORRENTE". A edição serve para REINCLUIR o lead, não para excluí-lo melhor.
--
-- O QUE ESTAVA ACONTECENDO: a aula é semanal e o evento recorrente REUSA O MESMO `id`. Toda
-- exclusão de "já inscrito" comparava só `evento_id`, então os 5 inscritos de 02/09 ficariam
-- MUDOS em 09/09 — sem convite, sem reforço, fora da fila de WhatsApp. E o pior: o UNIQUE
-- `live_lembretes (evento_id, email, etapa)` faria a gravação do lembrete da véspera de
-- 09/09 colidir com a de 02/09, e quem ESTÁ inscrito não receberia o link da sala.
--
-- `live_convite_envio` e `live_reforco_envio` já tinham `edicao` desde que nasceram — esta
-- migração leva a mesma unidade para as duas tabelas que ficaram para trás.
--
-- ⚠️ POR QUE ISTO ESTÁ PARTIDO EM DUAS MIGRAÇÕES, e a ordem importa:
-- o código que está em produção AGORA faz upsert com `on_conflict=evento_id,email`. Se esta
-- migração já derrubasse esse UNIQUE, toda inscrição feita entre o SQL e o deploy tomaria
-- 400 — e a rota devolve 500 "não conseguimos concluir a sua inscrição". Então aqui a chave
-- NOVA é ADICIONADA e a velha FICA; a parte B derruba a velha e fecha o NOT NULL, depois
-- que o deploy estiver READY. Nenhum instante com inscrição quebrada.

-- ── 1. A coluna, nas duas tabelas ──────────────────────────────────────────────────────
alter table public.live_inscricoes add column if not exists edicao date;
alter table public.live_lembretes  add column if not exists edicao date;

comment on column public.live_inscricoes.edicao is
  'Data local (America/Bahia) da edição da aula em que a pessoa se inscreveu. Preenchida pelo gatilho quando o cliente não manda. É a unidade que o cliente enxerga — a mesma de live_convite_envio.edicao.';
comment on column public.live_lembretes.edicao is
  'Edição a que este lembrete pertence. Sem ela o UNIQUE (evento_id, email, etapa) impediria o lembrete da semana seguinte de ser gravado, e quem está inscrito ficaria sem o link da sala.';

-- ── 2. O gatilho que garante a coluna, venha de onde vier a linha ──────────────────────
-- Preencher no gatilho e não só no aplicativo é deliberado: o código velho continua no ar
-- durante o deploy, o `/admin` pode inserir à mão, e um `insert` de suporte não pode gravar
-- linha sem edição. "Regra que depende de todo mundo lembrar" é a que apodrece.
create or replace function public.live_edicao_preencher()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_slug text; v_prox jsonb; v_data timestamptz;
begin
  if new.edicao is not null then return new; end if;

  select e.slug, e.data_hora into v_slug, v_data
    from public.eventos_live e where e.id = new.evento_id;

  -- A recorrência vem de `live_proxima`, a mesma fonte da landing e dos crons. A coluna
  -- `data_hora` só entra como último recurso (evento inativo, que `live_proxima` recusa):
  -- ela guarda a ocorrência ANTERIOR até `live_rolar_recorrentes()` avançá-la, e foi
  -- exatamente essa leitura crua que mandou "sua vaga está garantida — 02 de setembro"
  -- para quem se inscreveu depois da aula de 02/09.
  v_prox := public.live_proxima(v_slug);
  if v_prox ? 'data_hora' then
    v_data := (v_prox->>'data_hora')::timestamptz;
  end if;

  if v_data is null then
    raise exception 'live_edicao_preencher: evento % sem data para deduzir a edição', new.evento_id;
  end if;

  new.edicao := (v_data at time zone 'America/Bahia')::date;
  return new;
end $$;

drop trigger if exists live_inscricoes_edicao on public.live_inscricoes;
create trigger live_inscricoes_edicao before insert on public.live_inscricoes
  for each row execute function public.live_edicao_preencher();

drop trigger if exists live_lembretes_edicao on public.live_lembretes;
create trigger live_lembretes_edicao before insert on public.live_lembretes
  for each row execute function public.live_edicao_preencher();

-- ── 3. Backfill do acervo ──────────────────────────────────────────────────────────────
-- Toda linha existente nasceu ANTES da aula de 02/09 22:00 UTC (conferido: a inscrição mais
-- recente é de 02/09 19:41, e o último lembrete "agora" de 20:03) — ou seja, todas pertencem
-- à edição que `data_hora` ainda aponta. Vale AGORA, e é por isso que o passo 4 confere em
-- vez de confiar: se esta migração for aplicada depois de a coluna rolar, a conta muda.
update public.live_inscricoes i
   set edicao = (e.data_hora at time zone 'America/Bahia')::date
  from public.eventos_live e
 where e.id = i.evento_id and i.edicao is null and i.criado_em <= e.data_hora;

update public.live_lembretes l
   set edicao = (e.data_hora at time zone 'America/Bahia')::date
  from public.eventos_live e
 where e.id = l.evento_id and l.edicao is null and l.enviado_em <= e.data_hora;

-- ── 4. A conferência que RECUSA em vez de seguir ───────────────────────────────────────
-- "Não consegui preencher" não pode passar como "preenchi": linha com edição nula sairia da
-- lista de todo mundo em silêncio, que é exatamente a família de defeito que esta migração
-- vem consertar.
do $$
declare n_ins int; n_lem int;
begin
  select count(*) into n_ins from public.live_inscricoes where edicao is null;
  select count(*) into n_lem from public.live_lembretes  where edicao is null;
  if n_ins > 0 or n_lem > 0 then
    raise exception 'backfill incompleto: % inscrição(ões) e % lembrete(s) sem edição — investigar antes de seguir para a parte B', n_ins, n_lem;
  end if;
end $$;

-- ── 5. As chaves NOVAS (as velhas ficam até a parte B) ─────────────────────────────────
create unique index if not exists live_inscricoes_evento_email_edicao_key
  on public.live_inscricoes (evento_id, email, edicao);
create unique index if not exists live_lembretes_evento_email_etapa_edicao_key
  on public.live_lembretes (evento_id, email, etapa, edicao);

-- ── 6. As duas exclusões que deixariam o lead mudo ─────────────────────────────────────
-- Mudam AGORA e não na parte B porque são seguras nos dois sentidos: o acervo já está
-- backfillado, e o código velho não passa a depender de nada novo.

-- `live_reforco_alvos`: idêntica à anterior, exceto por `and i.edicao = p_edicao` na
-- exclusão de inscritos — quem se inscreveu em 02/09 volta a ser alvo do reforço de 09/09.
create or replace function public.live_reforco_alvos(p_evento uuid, p_edicao date, p_etapa text, p_horas_espera integer default 18, p_teto_pessoa integer default 2)
 returns table(user_id uuid, nome text, email text)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with marco as (
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
     and not exists (select 1 from public.live_inscricoes i
                      where i.evento_id = p_evento and i.user_id = c.id
                        and i.edicao = p_edicao)
     and not exists (select 1 from public.alertas_email a
                      where a.user_id = c.id and a.ativo = false)
     and not exists (select 1 from public.emails_supressao s
                      where lower(s.destinatario) = lower(u.email) and s.suprimido)
     and (select count(*) from public.live_reforco_envio r
           where r.evento_id = p_evento and r.edicao = p_edicao and r.user_id = c.id) < p_teto_pessoa
     and not exists (select 1 from public.live_reforco_envio r
                      where r.evento_id = p_evento and r.edicao = p_edicao
                        and r.user_id = c.id and r.etapa = p_etapa)
     and case p_etapa
           when 'assunto' then (not le.abriu) and le.entregue_ha_tempo
           when 'prova'   then le.abriu and not le.clicou
           when 'ultima'  then le.clicou
           else false
         end;
$function$;

-- `whatsapp_fila_live`: mesma mudança, na mesma exclusão.
create or replace function public.whatsapp_fila_live(p_evento uuid, p_edicao date)
 returns table(user_id uuid, nome text, cidade text, uf text, role text, telefone_wa text, prioridade integer, motivo text, publico text, tratamento text, nunca_analisou boolean)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with base as (
    select p.id, p.nome, p.endereco_cidade as cidade, p.endereco_uf as uf, p.role, p.created_at,
           regexp_replace(p.telefone, '\D', '', 'g') as dig,
           pc.publico, pc.tratamento,
           not (exists (select 1 from public.analises_mercado    a where a.user_id = p.id)
             or exists (select 1 from public.analises_documental a where a.user_id = p.id)
             or exists (select 1 from public.analises_laudo      a where a.user_id = p.id)) as nunca,
           exists(select 1 from public.emails_log l
                   where l.user_id = p.id
                     and l.tipo in ('convite_live','live_reforco_assunto','live_reforco_prova')
                     and l.aberto_em is not null) as abriu
      from public.perfis p
      left join public.planos_config pc on pc.plano_key = p.role
     where p.ativo
       and coalesce(p.role,'') <> 'admin'
       and p.telefone is not null
       and not exists (select 1 from public.live_inscricoes i
                        where i.evento_id = p_evento and i.user_id = p.id
                          and i.edicao = p_edicao)
       and not exists (select 1 from public.alertas_email a
                        where a.user_id = p.id and a.ativo = false)
       and not exists (select 1 from public.whatsapp_disparo_log w
                        where w.evento_id = p_evento and w.edicao = p_edicao and w.user_id = p.id)
  )
  select b.id, b.nome, b.cidade, b.uf, b.role,
         case when length(b.dig) in (10, 11) then '55' || b.dig else b.dig end,
         case b.publico when 'cliente' then 1 when 'parceiro' then 2 when 'equipe' then 4
                        else case when b.abriu then 3 else 5 end end,
         case b.publico when 'cliente' then 'cliente' when 'parceiro' then 'parceiro'
                        when 'equipe' then 'equipe'
                        else case when b.abriu then 'abriu o e-mail' else 'nao abriu o e-mail' end end,
         b.publico, b.tratamento, b.nunca
    from base b
   where length(b.dig) between 10 and 13
   order by 7, b.created_at desc;
$function$;
