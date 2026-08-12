-- ─────────────────────────────────────────────────────────────────────────────
-- QA — três invariantes novos para a família que apareceu em 12/08 no print do dono:
-- "os relatórios mercadológicos sumiram". (Acrescenta a qa_invariantes(); nada é removido.)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- POR QUE ESTES TRÊS, e por que no BANCO e não numa varredura de código:
-- os dois defeitos do dia não apareceriam em leitura de código nenhuma. O código estava
-- sintaticamente correto nos dois casos — a retenção apagava por tabela (e o mercadológico
-- vencia sozinho, deixando o cliente com meia análise) e a lista lia 12 linhas de cada
-- tabela. O que denunciava os dois era o RASTRO NO BANCO: análise sem a metade que a
-- acompanha, e análise vencida que continuava lá. É esse rastro que passa a ser vigiado.
--
--   analise_sem_mercadologico  → limite 4 = o que existe HOJE (anterior ao gate de ordem
--                                em gerar-documental.js). É ratchet: só alerta se CRESCER,
--                                ou seja, se o gate parar de valer.
--   laudo_sem_base             → limite 0. O laudo é síntese dos outros dois; existir sem
--                                eles significa que alguém apagou metade por baixo dele.
--   cadastro_barrado           → limite 7 = as ocorrencias dos ultimos 7 dias (5 delas de UMA
--                                pessoa so, em 12/08, que desistiu). Vigia a porta de entrada:
--                                se o cadastro voltar a barrar gente, o numero sobe e o monitor
--                                diario avisa — em vez de a gente descobrir por acaso.
--   analise_vencida_nao_limpa  → limite 0, com 2 dias de folga sobre a janela de 15 (o cron
--                                é diário). Este é o que teria gritado: 4 imóveis venceram e
--                                ficaram, um deles com praça em 21/07, porque o branch por
--                                leilão exigia `data_leilao` na PRÓPRIA linha e o acervo não
--                                era consultado. A retenção pode voltar a falhar em silêncio
--                                — ela é um DELETE que não deu erro; só a contagem denuncia.
create or replace function public.qa_invariantes()
returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text)
language sql
set search_path to 'public'
as $function$
  with analises_por_imovel as (
    select user_id, imovel_id,
           bool_or(t='m' and status='concluida') as tem_mercado,
           bool_or(t='d' and status='concluida') as tem_documental,
           bool_or(t='l' and status='concluida') as tem_laudo,
           max(data_leilao) as praca_analise,
           min(created_at)  as criada_em,
           bool_or(arrematado) as arrematado
      from (select 'm' t, user_id, imovel_id, status, data_leilao, created_at, arrematado from public.analises_mercado
            union all
            select 'd',   user_id, imovel_id, status, data_leilao, created_at, arrematado from public.analises_documental
            union all
            select 'l',   user_id, imovel_id, status, data_leilao, created_at, arrematado from public.analises_laudo) z
     group by 1, 2
  ),
  analises_datadas as (
    select a.*,
           greatest(
             coalesce((select max(x) from (values
                ((nullif(i.data_leilao, ''))::timestamptz),
                (i.data_leilao_2),
                (i.data_fim::timestamptz + interval '1 day' - interval '1 second')
              ) v(x)), '-infinity'::timestamptz),
             coalesce(a.praca_analise, '-infinity'::timestamptz)) as ultima_praca
      from analises_por_imovel a
      left join public.imoveis_leilao i on i.id::text = a.imovel_id::text
  ),
  inv(chave, titulo, categoria, gravidade, valor, limite) as (
    values
     ('edital_eq_matricula','Botão Edital abre a Matrícula','Documentos','bug',
       (select count(*) from imoveis_leilao where ativo and link_edital is not null and link_edital = link_matricula), 8),
     ('matricula_eq_lote','Matrícula aponta p/ a página do lote','Documentos','bug',
       (select count(*) from imoveis_leilao where ativo and link_matricula is not null and link_matricula = url_lote), 8),
     ('aval_incoerente','Avaliação > 10× o lance (mis-read)','Relatório','bug',
       (select count(*) from imoveis_leilao where ativo and valor_avaliacao>0 and valor_minimo>0 and valor_avaliacao > valor_minimo*10), 30),
     ('valor_sentinela','Valor sentinela gravado','Relatório','bug',
       (select count(*) from imoveis_leilao where ativo and (valor_minimo in (999999999,99999999,9999999999,111111111,123456789) or valor_avaliacao in (999999999,99999999,9999999999,111111111,123456789))), 0),
     ('perfil_sem_role','Perfil sem role definido','Conta','bug',
       (select count(*) from perfis where coalesce(role,'')=''), 0),
     ('cadastro_barrado','Cadastro recusado na tela de criar conta (7d)','Conta','bug',
       (select count(*) from eventos_atividade where tipo='api_erro' and alvo='cadastro_falha'
          and criado_em > now() - interval '7 days'), 7),
     ('proximidades_vazio_falso','Proximidades vazias em cidade já mapeada','Relatório','bug',
       (select count(*) from imoveis_leilao i where i.ativo and i.pontos_proximos = '{}'::jsonb
          and coalesce(i.cidade,'') <> ''
          and exists (select 1 from imoveis_leilao v
                       where v.ativo and v.cidade = i.cidade and v.estado is not distinct from i.estado
                         and v.pontos_proximos is not null and v.pontos_proximos <> '{}'::jsonb)), 300),
     ('bd_teto_saturado','Bright Data: cota semanal perto do teto','Captura','bug',
       (select coalesce(requests,0) from brightdata_uso where semana = date_trunc('week', now())::date), 405),
     ('fonte_cega_no_monitor','Fonte com acervo ativo e sem histórico de saúde','Captura','bug',
       (select count(*) from (select distinct i.fonte from imoveis_leilao i
          where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0),
     ('valor_diverge_do_titulo','Lance gravado diverge do lance no título','Relatório','bug',
       (select count(*) from imoveis_leilao
         where ativo and titulo ~ 'Lance Inicial:\s*R\$\s*[\d.]+,\d{2}'
           and abs(coalesce(valor_minimo,0) - replace(regexp_replace(
                 (regexp_match(titulo, 'Lance Inicial:\s*R\$\s*([\d.]+,\d{2})'))[1],
                 '[^0-9,]', '', 'g'), ',', '.')::numeric) > 1), 0),
     ('leilao_vencido_ativo','Lote ativo com todas as praças já vencidas','Captura','bug',
       (select count(*) from imoveis_leilao i where i.ativo
          and public.leilao_encerrado(i.modalidade, i.data_leilao, i.data_leilao_2)), 0),
     -- ── novos em 12/08: análise pela metade ───────────────────────────────────
     ('analise_sem_mercadologico','Análise com documental/laudo e SEM mercadológico','Relatório','bug',
       (select count(*) from analises_datadas where (tem_documental or tem_laudo) and not tem_mercado), 4),
     ('laudo_sem_base','Laudo concluído sem os dois relatórios que ele consolida','Relatório','bug',
       (select count(*) from analises_datadas where tem_laudo and not (tem_mercado and tem_documental)), 0),
     ('analise_vencida_nao_limpa','Análise vencida que a retenção não apagou','Relatório','bug',
       (select count(*) from analises_datadas
         where not coalesce(arrematado, false)
           and criada_em < now() - interval '17 days'
           and ultima_praca > '-infinity'::timestamptz
           and ultima_praca < now() - interval '17 days'), 0),
     -- ── gaps vigiados (não são defeito; backlog com teto) ─────────────────────
     ('aval_ausente_com_doc','Lote com edital/anexo mas SEM avaliação','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(valor_avaliacao,0)=0
          and ((case when jsonb_typeof(anexos)='array' then jsonb_array_length(anexos) else 0 end) > 0 or coalesce(link_edital,'') ~* '\.pdf')), 4000),
     ('desconto_ge90','Desconto ≥ 90% (suspeito de mis-read)','Relatório','gap',
       (select count(*) from imoveis_leilao where ativo and desconto_percentual >= 90), 200),
     ('sem_foto','Lote ativo sem foto','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(link_foto,'')=''), 1600),
     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30)
  )
  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,
    case when valor > limite then 'alerta' else 'ok' end
  from inv;
$function$;

revoke execute on function public.qa_invariantes() from public, anon, authenticated;
grant  execute on function public.qa_invariantes() to service_role;
