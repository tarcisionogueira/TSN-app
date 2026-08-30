-- 30/08 — O MOTOR DA ANÁLISE: REIVINDICAR COM TRAVA, CONCLUIR COM PROVA
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Decisão do dono: as 4 análises do caso (mercadológica, financeira, fluxo de caixa,
-- jurídica preliminar) são geradas por IA. Até hoje `analise_jobs` tinha UMA escrita em todo
-- o código — o clique do cliente — e nada consumia a fila: 8 casos parados, 0 linhas na
-- tabela em toda a história, e o botão prometendo 48 h.
--
-- ─── POR QUE A FILA MORA NO BANCO, E NÃO NO WORKER ────────────────────────────────────────
-- (1) REIVINDICAR SEM DUPLICAR. O cron da Vercel pode sobrepor execuções (uma rodada lenta e
--     a seguinte disparando). Sem `for update skip locked`, duas invocações leem 'aguardando'
--     ao mesmo tempo e geram o MESMO relatório duas vezes — custo de IA dobrado e duas
--     versões concorrendo. A trava é do Postgres, não do JavaScript.
-- (2) CONCLUIR COM PROVA. `concluir_analise_job` só carimba 'concluido' se o INSERT do
--     relatório de fato produziu linha. É a regra que `coleta_cliente_concluir` já aplica na
--     captura: um coletor jamais pode dizer que terminou sem ter gravado. Aqui o estrago
--     seria pior — job verde, relatório inexistente, e o cliente vendo "4 de 4 concluídas"
--     sobre nada.
--
-- ─── RETOMADA DE JOB ÓRFÃO (o que trava fila calada) ─────────────────────────────────────
-- Um worker que morre no meio (timeout da Vercel, deploy, erro não tratado) deixa o job em
-- 'processando' para sempre: ele não está na fila de 'aguardando' e ninguém o pega de novo.
-- Por isso `reivindicar` também aceita 'processando' com `iniciado_em` mais velho que 20 min
-- — mais que o dobro do teto de execução (300 s), então nunca rouba um job vivo.
--
-- ─── A COTA JÁ FOI COBRADA NO CLIQUE ────────────────────────────────────────────────────
-- `Caso.jsx` incrementa `cotas_analise` depois do insert do job. O worker NÃO cobra de novo:
-- a re-tentativa de um job que falhou é conserto nosso, não consumo do cliente.

-- ── 1. REIVINDICAR ─────────────────────────────────────────────────────────────────────
create or replace function public.reivindicar_analise_jobs(p_limite int default 2)
returns table (job_id uuid, caso_id uuid, tipo text, tentativas int, max_tentativas int,
               input_json jsonb, imovel_id text, imovel_endereco text, imovel_valor numeric,
               tipo_leilao text, cliente_id uuid, prazo_limite_em timestamptz)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with alvo as (
    select j.id
      from public.analise_jobs j
     where j.tentativas < j.max_tentativas
       and (
         (j.status = 'aguardando'
           and (j.proxima_tentativa_em is null or j.proxima_tentativa_em <= now()))
         -- Job órfão: worker morreu com ele em 'processando'. 20 min > 2× o teto de execução.
         or (j.status = 'processando' and j.iniciado_em < now() - interval '20 minutes')
       )
     order by j.created_at
     limit greatest(1, least(coalesce(p_limite, 2), 10))
     for update skip locked
  ), tomados as (
    update public.analise_jobs j
       set status = 'processando', iniciado_em = now(), tentativas = j.tentativas + 1
      from alvo
     where j.id = alvo.id
    returning j.id, j.caso_id, j.tipo, j.tentativas, j.max_tentativas, j.input_json, j.prazo_limite_em
  )
  select t.id, t.caso_id, t.tipo, t.tentativas, t.max_tentativas, t.input_json,
         c.imovel_id, c.imovel_endereco, c.imovel_valor, c.tipo_leilao, c.cliente_id, t.prazo_limite_em
    from tomados t
    join public.casos c on c.id = t.caso_id;
end $$;

-- ── 2. CONCLUIR (com prova) ────────────────────────────────────────────────────────────
create or replace function public.concluir_analise_job(
  p_job_id uuid, p_conteudo_md text, p_conteudo_json jsonb, p_modelo text,
  p_incompleto boolean default false, p_secoes_faltando text[] default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_caso uuid; v_tipo text; v_versao int; v_rel uuid; v_prontos int;
begin
  select caso_id, tipo into v_caso, v_tipo from public.analise_jobs where id = p_job_id;
  if v_caso is null then return jsonb_build_object('ok', false, 'motivo', 'job inexistente'); end if;
  -- Conteúdo vazio NÃO conclui nada: seria o relatório em branco carimbado como pronto.
  if coalesce(length(btrim(p_conteudo_md)), 0) < 200 then
    return jsonb_build_object('ok', false, 'motivo', 'conteudo insuficiente', 'chars', coalesce(length(btrim(p_conteudo_md)), 0));
  end if;

  select coalesce(max(versao), 0) + 1 into v_versao
    from public.analise_relatorios where caso_id = v_caso and tipo = v_tipo;

  insert into public.analise_relatorios (caso_id, tipo, versao, conteudo_md, conteudo_json,
                                         gerado_por_modelo, incompleto, secoes_faltando)
  values (v_caso, v_tipo, v_versao, p_conteudo_md, p_conteudo_json, p_modelo,
          coalesce(p_incompleto, false), p_secoes_faltando)
  returning id into v_rel;

  -- A PROVA: sem linha de relatório, o job não vira 'concluido'.
  if v_rel is null then
    return jsonb_build_object('ok', false, 'motivo', 'relatorio nao gravado');
  end if;

  update public.analise_jobs
     set status = case when coalesce(p_incompleto, false) then 'falha_parcial' else 'concluido' end,
         concluido_em = now(), erro_msg = null,
         resultado_json = jsonb_build_object('relatorio_id', v_rel, 'versao', v_versao)
   where id = p_job_id;

  -- Caso inteiro pronto? Os 4 tipos concluídos movem a etapa. `falha_parcial` NÃO conta:
  -- meio relatório não é entrega, e deixar passar aqui daria ao cliente uma reunião marcada
  -- sobre material incompleto.
  select count(*) into v_prontos from public.analise_jobs
   where caso_id = v_caso and status = 'concluido';
  if v_prontos >= 4 then
    update public.casos set status_etapa = 'analises_prontas', updated_at = now()
     where id = v_caso and status_etapa = 'analise_solicitada';
  end if;

  return jsonb_build_object('ok', true, 'relatorio_id', v_rel, 'versao', v_versao,
                            'prontos', v_prontos, 'caso', v_caso);
end $$;

-- ── 3. FALHAR (com backoff, e sem esconder a exaustão) ─────────────────────────────────
create or replace function public.falhar_analise_job(p_job_id uuid, p_erro text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_t int; v_max int; v_final boolean;
begin
  select tentativas, max_tentativas into v_t, v_max from public.analise_jobs where id = p_job_id;
  if v_t is null then return jsonb_build_object('ok', false, 'motivo', 'job inexistente'); end if;
  v_final := v_t >= v_max;
  update public.analise_jobs
     set status = case when v_final then 'falha' else 'aguardando' end,
         erro_msg = left(coalesce(p_erro, 'erro sem mensagem'), 500),
         -- Backoff quadrático: 10 min, 40 min, 90 min. Erro de fornecedor costuma passar;
         -- martelar de minuto em minuto só gasta cota.
         proxima_tentativa_em = case when v_final then null else now() + (v_t * v_t * interval '10 minutes') end
   where id = p_job_id;
  return jsonb_build_object('ok', true, 'definitivo', v_final, 'tentativas', v_t, 'max', v_max);
end $$;

revoke all on function public.reivindicar_analise_jobs(int) from public, anon, authenticated;
revoke all on function public.concluir_analise_job(uuid, text, jsonb, text, boolean, text[]) from public, anon, authenticated;
revoke all on function public.falhar_analise_job(uuid, text) from public, anon, authenticated;
