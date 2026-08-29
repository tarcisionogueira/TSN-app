-- 29/08 — O BOTÃO "SOLICITAR" DO /caso NUNCA FUNCIONOU PARA NENHUM CLIENTE
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Encontrado pela pergunta "por que os pagantes não têm entrega?". Não era churn: dois
-- clientes PAGANTES clicaram em Solicitar e o banco recusou.
--
--   eventos_atividade · tipo=erro_ui · alvo="Solicitar"
--   "new row violates row-level security policy for table \"analise_jobs\""
--     6b35b390 (assessorado) · 23/08 22:19 e 24/08 14:18
--     9c35b10e (top2)        · 25/08 13:41
--
-- `analise_jobs` tem **0 linhas em toda a história da tabela**.
--
-- ─── A CAUSA, E ELA NÃO É A QUE O ERRO SUGERE ──────────────────────────────────────────
-- A mensagem aponta para a política de INSERT, e ela está CERTA. Medido por impersonação
-- do JWT do cliente, numa transação revertida:
--
--   INSERT puro ................................. RLS PASSOU
--   INSERT ... ON CONFLICT DO NOTHING RETURNING .. 42501 (o erro do cliente)
--
-- É o **RETURNING**. No Postgres, INSERT com RETURNING também aplica as políticas de
-- SELECT — e `analise_jobs` era a ÚNICA das 8 tabelas do fluxo do caso sem política de
-- SELECT para participante (só `jobs_admin_all`, restrita a `is_admin()`). O
-- `rls_fluxo_caso_analise.sql` criou o INSERT e o par de leitura ficou de fora.
--
-- ─── A IRONIA, QUE É A PARTE QUE VALE GUARDAR ──────────────────────────────────────────
-- O `.select()` que dispara o RETURNING foi acrescentado em 19/08 para CORRIGIR outro bug
-- (o 2º clique devolvia `error: null` com zero linhas e queimava cota à toa) — obedecendo
-- à forma nº 3 do CLAUDE.md: *"só `.select()` prova o que mudou"*. Correto, e foi ele que
-- transformou uma leitura vazia numa escrita impossível. **Provar a escrita exige poder
-- LER de volta**: onde o app escreve client-side e confere, INSERT sem SELECT não é meia
-- política, é uma escrita que não funciona.
--
-- ─── O SEGUNDO SINTOMA, QUE ESTAVA À VISTA E CALADO ────────────────────────────────────
-- `Caso.jsx:638` faz `from('analise_jobs').select('*')`. Sem política de SELECT isso não dá
-- erro: a RLS FILTRA e devolve lista vazia (forma nº 3). Então o painel do cliente dizia
-- "0 de 4 concluídas" para sempre, com cara de trabalho ainda não começado.
-- E um instrumento independente já gritava isso sem que ninguém ligasse os pontos:
-- `tempo_processo()` reporta **8 casos parados em `analise_solicitada`, mediana 29 dias,
-- "nenhum caso passou desta etapa até hoje"**. Ninguém passou porque o pedido era recusado.
--
-- Cota NÃO foi queimada indevidamente: em `Caso.jsx` o incremento vem DEPOIS do
-- `if (error) throw error`, então o lançamento impediu a cobrança. Os 8 casos só precisam
-- que o cliente clique de novo.

-- Espelha exatamente a política de INSERT que já existe (mesmos três participantes).
drop policy if exists analise_jobs_participante_select on public.analise_jobs;
create policy analise_jobs_participante_select on public.analise_jobs
  for select to public
  using (exists (
    select 1 from public.casos c
    where c.id = caso_id
      and (c.cliente_id = auth.uid() or c.analista_id = auth.uid() or c.advogado_id = auth.uid())
  ));

-- ─────────────────────────────────────────────────────────────────────────────────────
-- A TRAVA: escrita client-side sem leitura de volta
-- ─────────────────────────────────────────────────────────────────────────────────────
-- O health-check já vigia o inverso ("RLS mas SEM escrita do usuário"). Faltava ESTE lado,
-- que é o que morde quando o código obedece à forma nº 3: tabela onde o participante pode
-- INSERIR e não pode LER. Todo `.insert().select()` nessas tabelas falha com 42501, e todo
-- `.select()` devolve vazio sem erro — as duas metades do mesmo silêncio.
create or replace function public.qa_invariante_rls_escreve_sem_ler()
returns bigint language sql stable set search_path to 'public' as $$
  with pol as (
    select c.oid, c.relname,
      bool_or(p.polcmd in ('a','*') and coalesce(pg_get_expr(p.polwithcheck, p.polrelid),
              pg_get_expr(p.polqual, p.polrelid), '') not ilike '%is_admin%') as escreve,
      bool_or(p.polcmd in ('r','*') and coalesce(pg_get_expr(p.polqual, p.polrelid), '')
              not ilike '%is_admin%') as le
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
      join pg_policy p on p.polrelid = c.oid
     where c.relrowsecurity
     group by c.oid, c.relname)
  select count(*)::bigint from pol where escreve and not le;
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('rls_escreve_sem_ler' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''rls_escreve_sem_ler'',''Tabela em que o usuario pode INSERIR e nao pode LER (insert().select() falha com 42501)'',''Infra'',''bug'',\n       public.qa_invariante_rls_escreve_sem_ler(), 0)';
  execute replace(d, alvo, novo);
end $do$;
