-- 30/08 — O CASO NASCE DIZENDO "ANÁLISE SOLICITADA" E NINGUÉM VIGIA SE ALGO FOI SOLICITADO
-- ═══════════════════════════════════════════════════════════════════════════════════════
-- Vindo do `erro_na_tela_do_cliente`, que acusou 3 cliques recusados pela RLS de
-- `analise_jobs` (corrigida em 29/08 e MEDIDA hoje: o insert com RETURNING passa como o
-- próprio cliente, em transação revertida). O alarme se resolve sozinho — os 3 eventos
-- envelhecem para fora da janela de 7 dias em 01/09 e apagá-los seria adulterar registro.
--
-- O que NÃO se resolve sozinho é o que apareceu atrás dele: **8 dos 10 casos do sistema
-- estão em `analise_solicitada` com ZERO job**, um deles há 39 dias, e `analise_jobs` tem
-- 0 linhas em toda a história da tabela.
--
-- ─── A CORREÇÃO DE LEITURA, QUE É O PONTO (forma #10) ──────────────────────────────────
-- `analise_solicitada` é o **DEFAULT da coluna** (`casos.status_etapa`), gravado no
-- nascimento do caso em `Caso.jsx:653`. O rótulo diz "Análise Solicitada"; o que ele mede é
-- "caso aberto". São coisas diferentes, e a diferença muda a AÇÃO:
--
--   3 casos (23-25/08) .... o cliente CLICOU e o banco recusou → era bug, está corrigido
--   5 casos (22/07-07/08).. ninguém clicou nunca ............... → é adesão, não tem conserto em código
--
-- A sessão de 29/08 leu o `tempo_processo()` ("8 parados, mediana 29 dias, nenhum caso
-- passou desta etapa") como se os 8 fossem recusa. Vale para 3. O instrumento estava certo;
-- a leitura é que emprestou a causa dos 3 para os outros 5.
--
-- ─── POR QUE UM INVARIANTE, E POR QUE ELE CONTA OS DOIS GRUPOS JUNTOS ──────────────────
-- O `erro_na_tela_do_cliente` só enxerga quem clicou. Os 5 que nunca clicaram não deixam
-- erro_ui, não deixam linha em `erros_cliente`, não deixam nada — o silêncio deles é
-- idêntico ao de um sistema saudável sem casos. Do ponto de vista do negócio os dois grupos
-- são o MESMO fato: pagante com caso aberto e nada acontecendo. Quem separa as causas
-- depois é a consulta; o alarme tem que disparar nos dois.
--
-- 7 dias de carência: é tempo de sobra para o cliente clicar, e curto o bastante para não
-- deixar outro caso apodrecer 39 dias sem ninguém saber.
create or replace function public.qa_invariante_caso_sem_analise_iniciada()
returns bigint language sql stable set search_path to 'public' as $$
  select count(*)::bigint
    from public.casos c
    left join public.perfis p on p.id = c.cliente_id
   where c.status_etapa = 'analise_solicitada'
     and c.created_at < now() - interval '7 days'
     and coalesce(p.role, '') <> 'admin'
     and not exists (select 1 from public.analise_jobs j where j.caso_id = c.id);
$$;

do $do$
declare d text; alvo text; novo text;
begin
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'qa_invariantes';
  alvo := E'where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0)';
  if position(alvo in d) = 0 then raise exception 'ancora nao encontrada em qa_invariantes()'; end if;
  if position('caso_sem_analise_iniciada' in d) > 0 then raise notice 'ja registrado'; return; end if;
  novo := alvo || E',\n     (''caso_sem_analise_iniciada'',''Caso aberto ha 7+ dias sem NENHUM job de analise (o estado e o DEFAULT da coluna: "solicitada" nao prova pedido)'',''Atendimento'',''bug'',\n       public.qa_invariante_caso_sem_analise_iniciada(), 0)';
  execute replace(d, alvo, novo);
end $do$;
