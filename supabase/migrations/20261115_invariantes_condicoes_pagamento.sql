-- 15/11 — CLASSE BROOKLIN: invariantes sobre o que o relatório GRAVOU (arena 15/11, Fase 1).
-- Lê `analises_mercado.result->mercado->condicoesPagamento` (api/_condicoes-origem.js), que só existe nos relatórios
-- gerados depois do deploy desta mudança (CORTE abaixo). Relatórios anteriores ficam de fora (são LEGADO: abrem à vista
-- na tela, sem o objeto) — contar a ausência deles como defeito seria piso fixo que esconde o caso novo.
--   cond_pagamento_sem_prova   — cenário inicial 'financiado' sem parcela/parcelamento/financiável de prova forte
--                                (trecho do edital relido ou ficha da Caixa). Pelo código é impossível; se aparecer, regrediu.
--   cond_pagamento_ausente     — relatório concluído depois do corte SEM o objeto (a montagem falhou: "não consigo verificar").
--   cond_pagamento_sem_trecho  — campo com origem 'edital_texto' e trecho vazio (prova sem a prova).
--   pagamento_divergente_aberto — cadastro à vista × leitura parcelável, esperando conferência (fila; limite 20).
--   cond_pagamento_nunca_provada — 10+ relatórios novos em 30 dias e NENHUM com condição provada: a régua parou de
--                                ler o edital (zero absoluto é alarme, não verde).
create or replace function public.qa_cond_pagamento()
returns table(chave text, valor bigint) language sql stable set search_path = public as $$
  -- regra_negocio: pagamento_so_com_prova (vigia o que o relatório gravou; quem aplica é api/_condicoes-origem.js)
  with r as (
    select result->'mercado'->'condicoesPagamento' cp
      from analises_mercado
     where status = 'concluida' and created_at > greatest(now() - interval '30 days', '2026-11-16 00:00:00+00'::timestamptz)
  ), forte as (
    select cp, exists (select 1 from jsonb_each(coalesce(cp->'campos', '{}'::jsonb)) e
                        where e.key in ('parcelas', 'parcelamentoPermitido', 'financiavel', 'aVista')
                          and e.value->>'origem' in ('edital_texto', 'ficha_cef')) provada
      from r
  )
  select 'cond_pagamento_sem_prova', count(*) filter (where cp->>'cenarioInicial' = 'financiado'
           and not exists (select 1 from jsonb_each(coalesce(cp->'campos', '{}'::jsonb)) e
                            where e.key in ('parcelas', 'parcelamentoPermitido', 'financiavel')
                              and e.value->>'origem' in ('edital_texto', 'ficha_cef'))) from forte
  union all select 'cond_pagamento_ausente', count(*) filter (where cp is null) from forte
  union all select 'cond_pagamento_sem_trecho', count(*) filter (where exists (select 1 from jsonb_each(coalesce(cp->'campos', '{}'::jsonb)) e
           where e.value->>'origem' = 'edital_texto' and coalesce(e.value->>'trecho', '') = '')) from forte
  union all select 'cond_pagamento_nunca_provada', case when count(cp) >= 10 and count(*) filter (where provada) = 0 then 1 else 0 end from forte
  union all select 'pagamento_divergente_aberto', (select count(*) from relatorio_anomalias where tipo = 'pagamento_divergente' and not resolvido)
$$;
revoke all on function public.qa_cond_pagamento() from public, anon, authenticated;
grant execute on function public.qa_cond_pagamento() to service_role;

do $mig$
declare d text := pg_get_functiondef('public.qa_invariantes'::regproc);
        ancora text := 'public.indice_prova_parada()::bigint, 0)';
begin
  if position('cond_pagamento_sem_prova' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'âncora de qa_invariantes não encontrada — revisar a migração'; end if;
  d := replace(d, ancora, ancora || $add$,
     ('cond_pagamento_sem_prova','Pagamento (classe Brooklin): relatório abriu FINANCIADO sem parcela/financiamento provado (trecho do edital ou ficha da Caixa) — api/_condicoes-origem.js regrediu?','Relatório','bug',
       (select valor from public.qa_cond_pagamento() where chave = 'cond_pagamento_sem_prova'), 0),
     ('cond_pagamento_ausente','Pagamento: relatório mercadológico novo SEM condicoesPagamento (montagem falhou — não dá para verificar a origem das condições)','Relatório','bug',
       (select valor from public.qa_cond_pagamento() where chave = 'cond_pagamento_ausente'), 0),
     ('cond_pagamento_sem_trecho','Pagamento: condição marcada como lida no edital sem o trecho que a prova','Relatório','bug',
       (select valor from public.qa_cond_pagamento() where chave = 'cond_pagamento_sem_trecho'), 0),
     ('cond_pagamento_nunca_provada','Pagamento: 10+ relatórios em 30 dias e NENHUMA condição provada no edital — a leitura do edital parou?','Relatório','gap',
       (select valor from public.qa_cond_pagamento() where chave = 'cond_pagamento_nunca_provada'), 0),
     ('pagamento_divergente_aberto','Pagamento: lote cadastrado à vista que a leitura diz parcelável, esperando conferência (relatorio_anomalias tipo pagamento_divergente) — o relatório não reescreve mais o cadastro','Relatório','gap',
       (select valor from public.qa_cond_pagamento() where chave = 'pagamento_divergente_aberto'), 20)$add$);
  execute d;
end $mig$;

-- Regra de negócio (a auditoria_regras_negocio() exige que a função de aplicaçao/vigilância cite a chave — ver o
-- comentário no corpo de qa_cond_pagamento).
insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo)
values ('pagamento_so_com_prova', '{"cenario_padrao":"aVista","prova_forte":["edital_texto","ficha_cef"],"fgts_nao_e_parcelamento":true,"relatorio_nao_reescreve_acervo":true}'::jsonb,
 'Condição de pagamento só abre o cenário financiado com prova forte (trecho do edital relido ou ficha da Caixa); FGTS não é parcelamento; o relatório não reescreve imoveis_leilao.forma_pagamento (divergência vira relatorio_anomalias). Aplicada em api/_condicoes-origem.js e vigiada por qa_cond_pagamento() (classe Brooklin, 15/11).',
 array['qa_cond_pagamento'], true)
on conflict (chave) do nothing;
