-- Moderador: o insight `fonte:saude` passa a medir o que o nome diz (forma nº 10).
--
-- Caso (16/11): o relatório semanal saiu "CRÍTICO" com 293 fontes listadas, e a IA escreveu
-- "98% das fontes estão vazias, operação paralisada". No banco, no mesmo dia: 440 fontes ok
-- com 38.164 lotes ativos; 268 'vazio' (leiloeiro sem leilão aberto AGORA — estado normal por
-- desenho, ver `_saude-fonte.mjs` e `motor/runner.mjs`) com 58 lotes; 17 'falhou' com 35 lotes;
-- 8 'degradado' (coleta parcial) com 1.628 lotes.
-- Três defeitos: (1) `status <> 'ok'` tratava 'vazio' e 'sem_cota' como problema; (2) não havia
-- denominador nenhum — só nomes, e a IA inventou o percentual; (3) fonte não medida há meses
-- (APABRF desde 29/08) ficava "falhou" para sempre, sem idade.
-- Agora: contagem por estado com lotes ativos de cada um, só medições dos últimos 14 dias
-- entram na saúde (as mais velhas viram uma linha "sem medição recente"), e a lista nominal é só
-- de falhou/degradado, com lotes ativos e motivo. Severidade pelo PESO no acervo, não pela
-- quantidade de nomes: crítico quando falhou+degradado carregam >= 10% dos lotes ativos ou
-- quando alguma fonte com >= 100 lotes ativos falhou; atenção quando há qualquer falha/degradação.
-- O corpo das outras seções é o vigente em produção (conferido por pg_get_functiondef em 16/11).

create or replace function public.moderador_gerar_insights()
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n int;
begin
  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'calibracao:'||coalesce(modalidade,'na')||':'||coalesce(tipo_aquisicao,'na'),'calibracao',
    case when abs(avg((assertividade->>'valor_delta_pct')::numeric))>=15 then 'critico'
         when abs(avg((assertividade->>'valor_delta_pct')::numeric))>=8 then 'atencao' else 'info' end,
    'analise-mercadologica','Calibração '||coalesce(modalidade,'?')||' / '||coalesce(tipo_aquisicao,'?'),
    'Desvio médio previsto×realizado: '||round(avg((assertividade->>'valor_delta_pct')::numeric),1)||'% (n='||count(*)||').',
    jsonb_build_object('n',count(*),'valor_delta_pct_med',round(avg((assertividade->>'valor_delta_pct')::numeric),1))
  from arremate_aprendizado where assertividade is not null and assertividade ? 'valor_delta_pct'
  group by modalidade, tipo_aquisicao
  on conflict (chave) do update set severidade=excluded.severidade,detalhe=excluded.detalhe,dados=excluded.dados,gerado_em=now();

  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'custo:pago','custo',case when count(*)>=5 then 'atencao' else 'info' end,'scraper',
    'Leiloeiros no caminho PAGO (Bright Data)',
    count(*)||' fonte(s): '||string_agg(fonte,', ' order by fonte)||'. Revalidar se há via grátis.',
    jsonb_build_object('fontes',jsonb_agg(fonte order by fonte))
  from leiloeiro_conhecimento where custo='pago' having count(*)>0
  on conflict (chave) do update set severidade=excluded.severidade,detalhe=excluded.detalhe,dados=excluded.dados,gerado_em=now();

  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'cobertura:a_confirmar','cobertura','info','scraper','Leiloeiros sem plataforma mapeada',
    count(*)||' fonte(s): '||string_agg(fonte,', ' order by fonte)||'. Mapear acelera integrações.',
    jsonb_build_object('fontes',jsonb_agg(fonte order by fonte))
  from leiloeiro_conhecimento where plataforma='a_confirmar' having count(*)>0
  on conflict (chave) do update set severidade=excluded.severidade,detalhe=excluded.detalhe,dados=excluded.dados,gerado_em=now();

  -- SAÚDE DAS FONTES com denominador (16/11).
  with ult as (
    select distinct on (fonte) fonte, status, executado_em, motivo
      from fonte_saude order by fonte, executado_em desc
  ), at as (
    select fonte, count(*) n from imoveis_leilao where ativo group by 1
  ), u as (
    select ult.fonte, ult.status, ult.motivo, coalesce(at.n,0) ativos,
           ult.executado_em > now() - interval '14 days' as recente
      from ult left join at using (fonte)
  ), tot as (
    select
      count(*) filter (where recente)                                         as medidas,
      count(*) filter (where recente and status='ok')                         as ok_f,
      coalesce(sum(ativos) filter (where recente and status='ok'),0)          as ok_l,
      count(*) filter (where recente and status in ('vazio','sem_cota','parcial_cota')) as calm_f,
      count(*) filter (where recente and status='falhou')                     as fal_f,
      coalesce(sum(ativos) filter (where recente and status='falhou'),0)      as fal_l,
      count(*) filter (where recente and status='degradado')                  as deg_f,
      coalesce(sum(ativos) filter (where recente and status='degradado'),0)   as deg_l,
      count(*) filter (where not recente)                                     as velhas_f,
      coalesce(sum(ativos) filter (where not recente),0)                      as velhas_l,
      (select count(*) from imoveis_leilao where ativo)                       as acervo,
      bool_or(recente and status='falhou' and ativos >= 100)                  as grande_caiu
    from u
  ), lista as (
    select string_agg(fonte||' ('||status||', '||ativos||' lote(s) — '||left(coalesce(motivo,'?'),70)||')',
                      '; ' order by ativos desc, fonte) as txt,
           jsonb_agg(jsonb_build_object('fonte',fonte,'status',status,'ativos',ativos) order by ativos desc) as js
      from (select * from u where recente and status in ('falhou','degradado')
             order by ativos desc, fonte limit 15) x
  )
  insert into moderador_insights (chave, categoria, severidade, agente, titulo, detalhe, dados)
  select 'fonte:saude','fonte',
    case when tot.grande_caiu or (tot.fal_l + tot.deg_l) >= 0.10 * greatest(tot.acervo,1) then 'critico'
         when tot.fal_f + tot.deg_f > 0 then 'atencao' else 'info' end,
    'scraper','Saúde das fontes de coleta',
    tot.medidas||' fontes medidas em 14 dias, acervo de '||tot.acervo||' lotes ativos: '
      ||tot.ok_f||' ok ('||tot.ok_l||' lotes) · '
      ||tot.calm_f||' sem leilão aberto agora ou sem cota (normal) · '
      ||tot.fal_f||' falharam ('||tot.fal_l||' lotes) · '
      ||tot.deg_f||' com coleta parcial ('||tot.deg_l||' lotes). '
      ||round(100.0*(tot.fal_l+tot.deg_l)/greatest(tot.acervo,1),1)||'% do acervo em fonte com problema.'
      ||case when tot.velhas_f > 0 then ' Sem medição há 14+ dias: '||tot.velhas_f||' fonte(s), '||tot.velhas_l||' lote(s).' else '' end
      ||coalesce(' Principais: '||lista.txt||'.',''),
    jsonb_build_object('acervo',tot.acervo,'medidas_14d',tot.medidas,'ok',tot.ok_f,'ok_lotes',tot.ok_l,
      'sem_leilao_ou_cota',tot.calm_f,'falhou',tot.fal_f,'falhou_lotes',tot.fal_l,
      'degradado',tot.deg_f,'degradado_lotes',tot.deg_l,'sem_medicao_14d',tot.velhas_f,
      'problemas',coalesce(lista.js,'[]'::jsonb))
  from tot, lista
  on conflict (chave) do update set severidade=excluded.severidade,detalhe=excluded.detalhe,dados=excluded.dados,gerado_em=now();

  select count(*) into n from moderador_insights; return n;
end $function$;
