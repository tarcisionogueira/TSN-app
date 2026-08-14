-- qa_invariantes(): duas travas novas sobre o RASTRO dos relatórios emitidos (14/08).
--
-- Contexto em `regras_locacao_lote_e_yield.sql`. Estas duas regras são aplicadas em
-- `api/gerar-analise.js`, não no banco — então `auditoria_regras_negocio()` não consegue
-- verificá-las (ela procura o nome em `pg_proc` e a chave no corpo da função). Registrá-las em
-- `regra_negocio` criava críticos permanentes numa auditoria que estava em 0: alarme falso, não
-- garantia. A guarda que FUNCIONA para regra aplicada no app é o rastro que ela deixa no dado.
--
--  • relatorio_yield_sem_x100  — yield entre 0 e 0,5% a.a. COM aluguel real (>= R$300) é, na
--    prática, sempre unidade errada: aluguel de verdade não rende 0,1% ao ano. Limite 0.
--  • relatorio_lote_com_aluguel — terreno/lote com aluguel > 0 no relatório. Limite 0.
--
-- Estado após o reparo do acervo: lote_com_aluguel = 0 ✅; yield_sem_x100 = 1 (o relatório
-- `e0d7ea4c…` de Vila Velha, 31/07, com `valorEstimadoImovel: 0` — sem denominador, não dá para
-- recalcular; precisa ser REGERADO). O alerta fica de pé de propósito até isso acontecer.
--
-- ⚠️ NOTA DE PROCESSO (a lição 7b do CLAUDE.md, quase repetida aqui): ao escrever esta
-- migração eu parti do último arquivo de `qa_invariantes` do repositório — e ele estava
-- ATRASADO em relação ao banco: faltavam `analise_sem_mercadologico`, `analise_vencida_nao_limpa`,
-- `cadastro_barrado` e `laudo_sem_base`, aplicados direto no banco em algum momento. Replicar
-- aquele arquivo teria APAGADO os quatro. Esta versão foi escrita a partir da definição VIVA
-- (`pg_get_functiondef`) e conferida chave a chave contra `select chave from qa_invariantes()`.
-- Ao mexer nesta função de novo: parta do banco, não do último .sql.
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
     -- 14/08: o yield vinha do MODELO e saía como RAZÃO (0,09) onde o certo era 11,16% a.a.
     -- Metade dos relatórios emitidos (25 de 56) estava assim. Agora o servidor calcula, e
     -- este invariante vigia o desfecho: yield abaixo de 0,5% a.a. COM aluguel é, na prática,
     -- sempre unidade errada — aluguel de verdade não rende 0,1% ao ano.
     ('relatorio_yield_sem_x100','Rentabilidade gravada como razão (falta ×100)','Relatório','bug',
       (select count(*) from analises_mercado
         where status='concluida' and (result->'mercado'->>'aluguelMedio')::numeric >= 300
           and (result->'mercado'->>'yieldBruto')::numeric between 0.0001 and 0.5), 0),
     -- 14/08: "lote não se aluga" era regra de 03/08 aplicada só num caminho. Um lote em
     -- condomínio saiu com "aluguel médio R$ 3.000/mês" — preço de casa, não de terreno vazio.
     ('relatorio_lote_com_aluguel','Terreno/lote com aluguel no relatório','Relatório','bug',
       (select count(*) from analises_mercado
         where status='concluida' and lower(coalesce(imovel->>'tipo','')) ~ 'terreno|lote'
           and (result->'mercado'->>'aluguelMedio')::numeric > 0), 0),
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
