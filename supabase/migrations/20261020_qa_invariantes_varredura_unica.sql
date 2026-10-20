-- ─────────────────────────────────────────────────────────────────────────────────────────
-- #237 (20/10): qa_invariantes() passava de 12 s (alerta qa_invariantes_lenta, 13,2 s no último registro).
-- 25 invariantes faziam, cada um, a sua própria varredura de `imoveis_leilao where ativo`. Agora uma CTE só
-- (`ativos_agg`, c1..c25) faz uma varredura com `count(*) filter (...)` — cada filtro é a condição original,
-- copiada sem mudança. Ficaram fora as que agrupam ou juntam (fonte_cega, foto_repetida, selo_documento,
-- fonte_data_uniforme, editais_avaliacao_perdida, matricula_area_de_outro_lote).
-- O ganho grande veio de 20261020_bem_movel_barrado_prefiltro.sql (12 s → 4 s naquela função); juntas,
-- 17,7 s → 9,5 s. Saída conferida chave a chave contra a versão anterior antes de aplicar.
-- ─────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.qa_invariantes()
 RETURNS TABLE(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
 SET work_mem TO '16MB'
AS $function$
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
      left join public.imoveis_leilao i on i.id = (case when a.imovel_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then a.imovel_id::uuid end)
  ),
  ativos_agg as (
    -- 20/10 (#237): UMA varredura de imoveis_leilao where ativo para todas as contagens simples — eram 25
    -- varreduras separadas (5,7 s quente / 20 s com cache frio). Cada coluna é a condição original do invariante.
    select
      count(*) filter (where link_edital is not null and link_edital = link_matricula) as c1,
      count(*) filter (where link_matricula is not null and link_matricula = url_lote) as c2,
      count(*) filter (where valor_avaliacao>0 and valor_minimo>0 and valor_avaliacao > valor_minimo*10) as c3,
      count(*) filter (where (valor_minimo in (999999999,99999999,9999999999,111111111,123456789) or valor_avaliacao in (999999999,99999999,9999999999,111111111,123456789))) as c4,
      count(*) filter (where i.pontos_proximos = '{}'::jsonb
          and coalesce(i.cidade,'') <> ''
          and exists (select 1 from imoveis_leilao v
                       where v.ativo and v.cidade = i.cidade and v.estado is not distinct from i.estado
                         and v.pontos_proximos is not null and v.pontos_proximos <> '{}'::jsonb)) as c5,
      count(*) filter (where titulo ~ 'Lance Inicial:\s*R\$\s*[\d.]+,\d{2}'
           and abs(coalesce(valor_minimo,0) - replace(regexp_replace(
                 (regexp_match(titulo, 'Lance Inicial:\s*R\$\s*([\d.]+,\d{2})'))[1],
                 '[^0-9,]', '', 'g'), ',', '.')::numeric) > 1) as c6,
      count(*) filter (where public.leilao_ja_encerrado(i.data_leilao, i.data_leilao_2, i.data_fim, i.modalidade)
          and not coalesce(i.resultado_leilao = 'sem_lance' and i.resultado_apurado_em > now() - interval '15 days', false)) as c7,
      count(*) filter (where coalesce(valor_avaliacao,0)=0
          and ((case when jsonb_typeof(anexos)='array' then jsonb_array_length(anexos) else 0 end) > 0 or coalesce(link_edital,'') ~* '\.pdf')) as c8,
      count(*) filter (where desconto_percentual >= 90) as c9,
      count(*) filter (where coalesce(link_foto,'')='' and fonte <> 'EDITAL_DJEN') as c10,
      count(*) filter (where coalesce(cidade,'')='') as c11,
      count(*) filter (where public.bem_movel_barrado(titulo, descricao)) as c12,
      count(*) filter (where fonte in ('LEILAOBRASIL','LUTHERO','LEILAOPRO','EMILIOMATOS','SUPERBID','LJUD','VIP','BAYIT','LEILOTECH','KRONLEILOES','SBID9','GRUPOLANCE','FRAZAO','ALBERTOMACEDOLEILOES','EDITAL_DJEN','VLANCE')
          and public.fora_do_acervo_imovel_veiculo(titulo, descricao)) as c13,
      count(*) filter (where coalesce(valor_avaliacao, valor_minimo_ref, 0) > 0
          and (
            coalesce((doc_fatos->'custos'->>'iptuDebito')::numeric, 0) > coalesce(valor_avaliacao, valor_minimo_ref)
            or coalesce((doc_fatos->'custos'->>'condominioDebito')::numeric, 0) > coalesce(valor_avaliacao, valor_minimo_ref)
          )
          and not exists (select 1 from qa_invariante_explicada x where x.chave = 'doc_debito_maior_que_avaliacao'
                            and x.imovel_id = i.id and x.explicado_ate >= current_date)) as c14,
      count(*) filter (where modalidade ilike '%venda%direta%' and data_leilao is not null and fonte not in ('COMPREI', 'SHIOKAWA', 'ZACCARINO', 'CUNHA')) as c15,
      count(*) filter (where resultado_leilao is null and data_fim < (now() at time zone 'America/Sao_Paulo')::date - 2) as c16,
      count(*) filter (where coalesce(area_m2,0)=0
          and not coalesce(tem_matricula_doc, false)
          and link_matricula is null and anexos::text !~* 'matricula') as c17,
      count(*) filter (where coalesce(area_m2,0) > 0 and area_m2 < 1000
            and strpos(coalesce(titulo,'') || ' ' || coalesce(descricao,''), '.' || to_char(floor(area_m2)::int, 'FM000')) > 0
            and (coalesce(titulo,'') || ' ' || coalesce(descricao,'')) ~ ('\d{1,2}\.' || to_char(floor(area_m2)::int, 'FM000') || '([,.]\d{1,2})?\s*m[²2]')) as c18,
      count(*) filter (where (estado is null or estado !~ '^[A-Za-z]{2}$')
           and not exists (select 1 from qa_invariante_explicada x where x.chave = 'estado_fora_do_padrao'
                             and x.imovel_id = i.id and x.explicado_ate >= current_date)) as c19,
      count(*) filter (where data_leilao ~ '^\d{4}-\d{2}-\d{2}' and data_leilao_2 is not null
           and (data_leilao_2 at time zone 'America/Sao_Paulo')::date <= (data_leilao)::date) as c20,
      count(*) filter (where ((praca1_fim is not null and data_leilao ~ '^\d{4}-\d{2}-\d{2}' and praca2_fim is null and data_leilao_2 is null and (praca1_fim at time zone 'America/Sao_Paulo')::date < (data_leilao)::date)
            or (praca2_fim is not null and data_leilao_2 is not null and (praca2_fim at time zone 'America/Sao_Paulo')::date < (data_leilao_2 at time zone 'America/Sao_Paulo')::date))) as c21,
      count(*) filter (where geocod_nivel in ('cidade','falhou') and coalesce(geocod_tentativas,0) > 3) as c22,
      count(*) filter (where tipo = 'casa' and titulo ~* '^\s*(lote|terreno)\M'
          and coalesce(titulo,'') || ' ' || coalesce(descricao,'') !~* '(casa|sobrado|\mresid[eê]ncias?\M|[aá]rea constru[ií]da|edifica[cç][aã]o|edificad|benfeitoria|pr[eé]dios?|barrac[aã]o|galp[aã]o)' and public.tipo_construido_pelo_titulo(titulo) is null) as c23,
      count(*) filter (where tipo = 'terreno' and public.tipo_construido_pelo_titulo(titulo) is not null) as c24,
      count(*) filter (where i.link_matricula like '%/storage/v1/object/%/documentos/%'
          and not exists (select 1 from storage.objects o where o.bucket_id = 'documentos'
                and o.name = substring(i.link_matricula from '/object/(?:sign|public)/documentos/([^?]+)'))) as c25
      from imoveis_leilao i
     where i.ativo
  ),
  anexos_agg as (
    select a.imovel_id,
           bool_or((a.tipo ilike '%edital%' or a.nome ilike '%edital%') and (public.doc_arquivo(a.url) or a.storage_path is not null)) as tem_edital_anexo,
           bool_or((a.tipo ilike '%matricula%' or a.nome ilike '%matr%') and (public.doc_arquivo(a.url) or a.storage_path is not null)) as tem_matricula_anexo
      from public.imovel_anexos a
     where exists (select 1 from public.imoveis_leilao il where il.id = a.imovel_id and il.ativo)
     group by a.imovel_id
  ),
  inv(chave, titulo, categoria, gravidade, valor, limite) as (
    values
     ('edital_eq_matricula','Botão Edital abre a Matrícula','Documentos','bug',
       (select c1 from ativos_agg), 8),
     ('matricula_eq_lote','Matrícula aponta p/ a página do lote','Documentos','bug',
       (select c2 from ativos_agg), 8),
     ('aval_incoerente','Avaliação > 10× o lance (mis-read)','Relatório','bug',
       (select c3 from ativos_agg), 30),
     ('valor_sentinela','Valor sentinela gravado','Relatório','bug',
       (select c4 from ativos_agg), 0),
     ('nome_fontes_divergentes','Nome do cliente diferente entre perfis e o metadata do auth','Conta','bug',
       public.qa_invariante_nome_fontes_divergentes(), 0),
     ('nome_sem_sobrenome','Cliente cadastrado com um nome so (antes da regra de 18/08)','Conta','gap',
       (select count(*) from perfis
         where array_length(regexp_split_to_array(btrim(coalesce(nome,'')), '\s+'), 1) < 2), 2),
     ('perfil_sem_role','Perfil sem role definido','Conta','bug',
       (select count(*) from perfis where coalesce(role,'')=''), 0),
     ('indicacao_ciclica','Indicacao circular (A indica B e B indica A) trava a arvore de MinhaRede','Conta','bug',
       public.qa_invariante_indicacao_ciclica(), 0),
     ('cadastro_barrado','Cadastro recusado na tela de criar conta (7d)','Conta','bug',
       (select count(*) from eventos_atividade where tipo='api_erro' and alvo='cadastro_falha'
          and criado_em > now() - interval '7 days'), 7),
     ('proximidades_vazio_falso','Proximidades vazias em cidade já mapeada','Relatório','bug',
       (select c5 from ativos_agg), 300),
     ('bd_teto_saturado','Bright Data: cota semanal perto do teto','Captura','bug',
       (select coalesce(requests,0) from brightdata_uso where semana = date_trunc('week', now())::date),
       coalesce((select round(coalesce(teto,450) * 0.9)::int from brightdata_uso where semana = date_trunc('week', now())::date), 405)),
     ('fonte_cega_no_monitor','Fonte com acervo ativo e sem histórico de saúde','Captura','bug',
       (select count(*) from (select distinct i.fonte from imoveis_leilao i
          where i.ativo and i.fonte <> 'EDITAL_DJEN' and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0),
     ('cadastro_duplicado','Mesma pessoa cadastrada 2x (telefone identico em 30 dias) — sinal de que o 1o cadastro nao concluiu','Atendimento','bug',
       public.qa_invariante_cadastro_duplicado(), 0),
     ('cadastro_sem_origem','Cadastro dos ultimos 7 dias sem NENHUMA origem registrada (nem payload nem visita_origem) — verba gasta sem saber de onde veio','Marketing','bug',
       public.qa_invariante_cadastro_sem_origem(), 0),
     ('job_analise_sem_motor','Job de analise passou do prazo que o proprio sistema prometeu (48h) sem ninguem processar','Atendimento','bug',
       public.qa_invariante_job_analise_sem_motor(), 0),
     ('caso_sem_analise_iniciada','Caso aberto ha 7+ dias sem NENHUM job de analise (o estado e o DEFAULT da coluna: "solicitada" nao prova pedido)','Atendimento','bug',
       public.qa_invariante_caso_sem_analise_iniciada(), 0),
     ('anexo_de_espelho_purgado','Anexo publicado aponta para arquivo do espelho que a retencao ja apagou (ponteiro morto que parece documento)','Documentos','bug',
       public.qa_invariante_anexo_de_espelho_purgado(), 0),
     ('praca_fim_sem_produtor','Colunas praca1_fim/praca2_fim em producao sem NENHUM produtor gravando (schema chegou, produtor nao)','Captura','bug',
       public.qa_invariante_praca_fim_sem_produtor(), 0),
     ('canal_sem_conversao_apurada','Canal de anuncio gastando com conversao NUNCA apurada (campo nao pedido a API / mapper cravando null)','Marketing','bug',
       public.qa_invariante_canal_sem_conversao_apurada(), 0),
     ('pagante_sem_ancora_cdc','Pagante com cobranca aprovada e plano_pago_em nulo — reembolso de 7 dias (CDC art. 49) negado por falta de dado','Financeiro','critico',
       public.qa_invariante_pagante_sem_ancora_cdc(), 0),
     ('erro_na_tela_do_cliente','Cliente clicou e recebeu erro NA TELA (eventos_atividade.erro_ui) — canal fora do erros_cliente','Atendimento','bug',
       public.qa_invariante_erro_na_tela_do_cliente(), 0),
     ('rls_escreve_sem_ler','Tabela em que o usuario pode INSERIR e nao pode LER (insert().select() falha com 42501)','Infra','bug',
       public.qa_invariante_rls_escreve_sem_ler(), 0),
     ('fonte_orcamento_como_falha','Recusa de orcamento gravada como falha da fonte (manda consertar parser intacto)','Captura','bug',
       public.qa_invariante_fonte_orcamento_como_falha(), 0),
     ('valor_diverge_do_titulo','Lance gravado diverge do lance no título','Relatório','bug',
       (select c6 from ativos_agg), 0),
     ('leilao_vencido_ativo','Lote ativo com todas as praças já vencidas (achado 22/09: exclui sem_lance retido 15 dias; indeterminado sai desde 14/10 — retenção intencional pra alimentar o filtro "Sem lance" da Busca, ver desativar_leiloes_encerrados)','Captura','bug',
       (select c7 from ativos_agg), 0),
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
     ('relatorio_yield_sem_x100','Rentabilidade gravada como razão (falta ×100)','Relatório','bug',
       (select count(*) from analises_mercado
         where status='concluida' and (result->'mercado'->>'aluguelMedio')::numeric >= 300
           and (result->'mercado'->>'yieldBruto')::numeric between 0.0001 and 0.5), 0),
     ('relatorio_lote_com_aluguel','Terreno/lote com aluguel no relatório','Relatório','bug',
       (select count(*) from analises_mercado
         where status='concluida' and lower(coalesce(imovel->>'tipo','')) ~ 'terreno|lote'
           and (result->'mercado'->>'aluguelMedio')::numeric > 0), 0),
     ('relatorio_area_nao_confirmada','Mercado calculado sobre area que a matricula CONTRADIZ (>5%)','Relatório','bug',
       (select count(*) from analises_mercado a
          join analises_documental d on d.imovel_id::text = a.imovel_id::text
                                    and d.user_id = a.user_id and d.status = 'concluida'
         where a.status = 'concluida' and a.created_at > now() - interval '7 days'
           and coalesce(a.result->'mercado'->'metodologia'->'area'->>'fonte','') <> 'matricula'
           and public.num_seguro(a.result->'mercado'->'metodologia'->'area'->>'valor') is not null
           and coalesce(nullif(public.num_seguro(d.result->'extracao'->>'areaPrivativaM2'), 0),
                        nullif(public.num_seguro(d.result->'extracao'->>'areaTotalM2'), 0)) is not null
           and abs(public.num_seguro(a.result->'mercado'->'metodologia'->'area'->>'valor')
                 - coalesce(nullif(public.num_seguro(d.result->'extracao'->>'areaPrivativaM2'), 0),
                            nullif(public.num_seguro(d.result->'extracao'->>'areaTotalM2'), 0)))
               / coalesce(nullif(public.num_seguro(d.result->'extracao'->>'areaPrivativaM2'), 0),
                          nullif(public.num_seguro(d.result->'extracao'->>'areaTotalM2'), 0)) > 0.05), 0),
     ('backup_sem_arquivo_cliente','Backup off-region não varreu o manifesto inteiro','Infra','bug',
       (select greatest(0, coalesce(b.arquivos_total,0) - coalesce(b.arquivos_novos,0) - coalesce(b.arquivos_iguais,0))
          from backup_execucoes b where not b.dormante order by b.executado_em desc limit 1), 0),
     ('fila_sem_cliente_falar','Chamado na fila sem uma mensagem do cliente','Atendimento','bug',
       (select count(*) from chamados c
         where c.status in ('aberto','aguardando_atendente','em_atendimento')
           and not exists (select 1 from chamados_mensagens m
                            where m.chamado_id = c.id and m.autor_tipo = 'cliente')), 0),
     ('reuniao_solicitada_parada','Pedido de reunião do CLIENTE sem reunião marcada há mais de 3 dias','Atendimento','bug',
       (select count(*) from solicitacoes s
          join perfis p on p.id = s.user_id
         where s.reuniao_em is null
           and coalesce(s.status,'') not in ('cancelado','concluido','recusado')
           and coalesce(p.role,'') not in ('admin','analista','juridico')
           and s.created_at < now() - interval '3 days'), 0),
     ('aval_ausente_com_doc','Lote com edital/anexo mas SEM avaliação','Captura','gap',
       (select c8 from ativos_agg), 4000),
     ('desconto_ge90','Desconto ≥ 90% (suspeito de mis-read)','Relatório','gap',
       (select c9 from ativos_agg), 200),
     ('foto_repetida_como_lote','Fonte servindo a MESMA foto para 10%+ do acervo (placeholder disfarcado de foto)','Captura','bug',
       (select count(distinct fonte) from (
          select fonte, link_foto, count(*) c, sum(count(*)) over (partition by fonte) tot
            from imoveis_leilao
           where ativo and coalesce(link_foto,'') <> ''
           group by fonte, link_foto
        ) z where z.tot >= 20 and z.c::numeric / z.tot > 0.10), 0),
     ('alerta_acima_do_capital','Lote enviado por e-mail acima do teto de capital que o cliente declarou na triagem','Atendimento','bug',
       (select count(*) from alertas_enviados ae
          join perfis p on p.id = ae.user_id
          join imoveis_leilao i on i.id = ae.imovel_id
          join (values ('ate_150k',200000),('150_400k',520000),('400k_1mi',1300000)) t(f,v)
            on t.f = p.faixa_capital
         where ae.enviado_em > now() - interval '7 days'
           and ae.valor_ref_enviado > t.v), 0),
     ('receita_sem_cliente','Pagamento contado como VENDA sem nenhum cliente vinculado (despesa da conta virando faturamento)','Financeiro','bug',
       (select count(*) from mp_pagamentos
         where origem in ('avulso','recorrente') and user_id is null), 0),
     ('sem_foto','Lote ativo sem foto (fora EDITAL_DJEN, que não tem foto por natureza)','Captura','gap',
       (select c10 from ativos_agg), 1600),
     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select c11 from ativos_agg), 30),
     ('bem_movel_no_acervo','Bem movel (veiculo/aeronave) ativo numa plataforma de imoveis','Captura','bug',
       (select c12 from ativos_agg), 0),
     ('acervo_fora_de_escopo','Lote ativo (nas fontes já filtradas na ingestão) que nao e nem imovel nem veiculo — baseline de titulo ambiguo em SUPERBID/LJUD tolerada, so o crescimento alem da folga e achado','Captura','gap',
       (select c13 from ativos_agg), 15),
     ('pino_generico_como_rua','Coordenada compartilhada por vias diferentes ainda marcada como precisa','Captura','bug',
       coalesce((select case when m.medido_em < now() - interval '3 days' then 9999 else m.valor end
                   from public.qa_medida_externa m where m.chave = 'pino_generico_como_rua'), 9999), 25),
     ('uf_cef_congelada','UF da CEF que parou de ser atualizada enquanto as outras seguiram','Captura','bug',
       (select count(*) from public.ufs_cef_congeladas()), 0),
     ('qa_invariantes_lenta','Painel de invariantes: ultima rodada FALHOU, sumiu ha 3+ dias, ou o PAINEL (nao a rede) passou de 12s (custo de cache frio conhecido: 5-10s)','Infra','bug',
       coalesce((select case when e.executado_em < now() - interval '3 days' then 9999
                      when not e.ok then 9999
                      else coalesce(e.ms_servidor, e.ms) end
                   from public.qa_invariantes_execucao e
                  order by e.executado_em desc limit 1), 9999), 12000),
     ('limpeza_encerrados_pulada','Fonte cuja limpeza de lotes encerrados e pulada pelo teto','Captura','bug',
       (select count(*) from public.fontes_com_limpeza_pulada()), 0),
     ('selo_documento_dessincronizado','Sinal de edital/matricula-arquivo fora de sincronia com o acervo','Documentos','bug',
       (select count(*) from imoveis_leilao i
          left join anexos_agg aa on aa.imovel_id = i.id
         where i.ativo
           and (i.tem_edital_doc is distinct from (
                  public.doc_arquivo(i.link_edital)
                  or exists (select 1 from jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) x
                              where (x->>'tipo' ilike '%edital%' or x->>'nome' ilike '%edital%')
                                and public.doc_arquivo(x->>'url'))
                  or coalesce(aa.tem_edital_anexo, false))
             or i.tem_matricula_doc is distinct from (
                  (i.fonte ~* 'caixa|cef'
                     and regexp_replace(coalesce(i.fonte_id,''), '\D', '', 'g') <> ''
                     and length(trim(coalesce(i.estado,''))) = 2)
                  or (public.doc_arquivo(i.link_matricula) and i.link_matricula !~* 'matricula\.asp')
                  or exists (select 1 from jsonb_array_elements(coalesce(i.anexos,'[]'::jsonb)) x
                              where (x->>'tipo' ilike '%matricula%' or x->>'nome' ilike '%matr%')
                                and public.doc_arquivo(x->>'url'))
                  or coalesce(aa.tem_matricula_anexo, false))
                )), 0),
     ('doc_debito_maior_que_avaliacao','Débito de IPTU/condomínio extraído do documento maior que o valor do próprio imóvel (contaminação entre lotes do mesmo PDF)','Documentos','bug',
       (select c14 from ativos_agg), 0),
     ('contrato_texto_truncado','Contrato com texto cortado num teto de sanitização (achado de 21/09 — sanitizeText limitava o contrato inteiro, não só texto curto de prompt)','Documentos','critico',
       (select count(*) from contratos_link where conteudo is not null and length(conteudo) in (20000, 500000)), 0),
     ('socio_ingestao_parcial','Censo: cidade com 1 a 3 das 4 colunas (pop/area/domicilios/nascimentos)','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade'
          and (case when populacao   is not null then 1 else 0 end
             + case when area_km2    is not null then 1 else 0 end
             + case when domicilios  is not null then 1 else 0 end
             + case when nascimentos is not null then 1 else 0 end) between 1 and 3), 0),
     ('socio_moradores_por_domicilio','Censo: moradores por domicilio absurdo (>8) — rotulo trocado','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade' and coalesce(domicilios,0)>0 and coalesce(populacao,0)>0
          and populacao::numeric/domicilios > 8), 0),
     ('socio_nascimentos_implausivel','Censo: nascimentos fora de 0,1%-15% da populacao — colisao de rotulo','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade' and coalesce(populacao,0)>0 and nascimentos is not null
          and (nascimentos < populacao*0.001 or nascimentos > populacao*0.15)), 0),
     ('socio_densidade_incoerente','Censo: densidade nao bate com populacao/area (>10%) — separador decimal','Ingestao','bug',
       (select count(*) from cidade_socio where nivel='cidade' and coalesce(area_km2,0)>0 and coalesce(populacao,0)>0
          and abs(densidade_hab_km2 - populacao::numeric/area_km2) > 0.10*(populacao::numeric/area_km2)), 0),
     ('socio_ancora_fora_da_faixa','Censo: cidade-ancora (SP/RJ/DF) fora da faixa publicada','Ingestao','bug',
       (select count(*) from (values
           ('saopaulo','SP',10000000,13000000,1400,1650),
           ('riodejaneiro','RJ',5500000,7000000,1100,1300),
           ('brasilia','DF',2500000,3200000,5200,6100)
         ) a(cn,uf,pmin,pmax,amin,amax)
         join cidade_socio c on c.cidade_norm=a.cn and c.uf=a.uf and c.nivel='cidade'
         where c.populacao not between a.pmin and a.pmax or c.area_km2 not between a.amin and a.amax), 0),
     ('fonte_data_leilao_uniforme','Fonte com 100+ lotes ativos e 1-2 datas de leilao (data em massa errada, ex.: PESTANA 26/10)','Captura','bug',
       (select count(*) from (
          select fonte, array_agg(distinct data_leilao::date) as datas
            from imoveis_leilao
           where ativo and data_leilao is not null
           group by fonte
          having count(*) >= 100 and count(distinct data_leilao::date) <= 2
        ) u
         where exists (
           select 1 from unnest(u.datas) d(data_leilao)
            where not exists (select 1 from public.fonte_data_uniforme_verificada v
                                where v.fonte = u.fonte and v.data_leilao = d.data_leilao)
         )
        ), 0),
     ('venda_direta_com_praca','Modalidade venda_direta com praça datada (classificação errada)','Captura','bug',
       (select c15 from ativos_agg), 0),
     ('data_edital_recuou_prazo','Divergencia de data entre edital e acervo em aberto','Relatorio','bug',
       (select count(*) from relatorio_anomalias
         where tipo = 'data_divergente_edital' and not resolvido
           and atualizado_em > now() - interval '30 days'), 0),
     ('live_numeros_congelados','Números da vitrine da live parados (cron horário não recalcula)','Infra','bug',
       public.qa_invariante_live_numeros_congelados(), 0),
     ('radar_editais_sem_pull','Radar de Editais (DJEN) sem nenhum pull bem-sucedido - captura parada em silencio','Captura','bug',
       public.qa_invariante_radar_editais_sem_pull(), 2),
     ('editais_cruzamento_cego','Edital com leiloeiro nomeado que nao pode ser cruzado com o acervo','Captura','bug',
       public.qa_invariante_editais_cruzamento_cego(), 0),
     ('mp_liberacao_atrasada','Pagamento MP aprovado com liberacao de dinheiro atrasada (>1 dia) vs. padrao observado de 0h (achado 21/09)','Financeiro','critico',
       (select count(*) from mp_pagamentos where status='approved' and coalesce(dados_mp->>'payment_type_id','') <> 'ticket' and coalesce(dados_mp->>'payment_method_id','') !~ '^bol' and dados_mp ? 'money_release_date' and dados_mp ? 'date_approved' and criado_em > now() - interval '30 days' and ((dados_mp->>'money_release_date')::timestamptz - (dados_mp->>'date_approved')::timestamptz) > interval '1 day'), 0),
     ('pagamento_sem_conferencia','Pagamento aprovado no gateway que o webhook nao aplicou (excedente ou ja quitado) aguardando conferencia/devolucao','Financeiro','critico',
       (select count(*) from public.pagamentos_conferencia where conferido_em is null), 0),
     ('resultado_leilao_atrasado','Imovel/veiculo ativo com leilao encerrado ha mais de 2 dias e resultado_leilao ainda nao apurado (achado 21/09: cron ficava preso processando backlog ja inativo, 0% dos imoveis ativos apurados)','Captura','critico',
       ((select c16 from ativos_agg)
        + (select count(*) from veiculos_leilao where ativo and resultado_leilao is null and data_leilao < now() - interval '2 days' and fonte not in ('SODRE', 'EDITAL_DJEN'))), 0),
     ('anexo_email_nao_arquivado','Anexo da caixa de e-mail com mais de 3 dias sem copia no nosso storage (o Resend apaga em 30 dias — ver api/arquivar-anexos-email-cron.js)','Atendimento','critico',
       (select count(*) from email_caixa c, jsonb_array_elements(coalesce(c.anexos,'[]'::jsonb)) a
         where c.resend_email_id is not null and a->>'arquivo' is null and coalesce(a->>'enviado', 'true') <> 'false' and c.criado_em < now() - interval '3 days' and coalesce(c.categoria,'') <> 'spam'), 0),
     ('editais_avaliacao_perdida','Lote EDITAL_DJEN ativo sem avaliacao OU lance minimo que o edital de origem tem (achado 22/09: 39 casos — backfill aplicado, causa completa da promoção nao 100% isolada)','Captura','bug',
       (select count(*) from imoveis_leilao i join editais_leilao e on e.imovel_id = i.id
          where i.fonte='EDITAL_DJEN' and i.ativo
            and ((coalesce(i.valor_avaliacao,0)=0 and coalesce(e.valor_avaliacao,0)>0) or (coalesce(i.valor_minimo,0)=0 and coalesce(e.lance_minimo,0)>0))), 0),
     ('lote_sem_area_nem_matricula','Lote sem metragem E sem matricula para recupera-la','Captura','gap',
       (select c17 from ativos_agg), 400),
     ('area_truncada_no_milhar','Área gravada é o resto de milhar de um número maior no título/descrição (regex sem grupo de milhar)','Captura','bug',
       (select c18 from ativos_agg), 0),
     ('estado_fora_do_padrao','Lote ativo com estado que nao e sigla de 2 letras (some de /leiloes)','Captura','bug',
       (select c19 from ativos_agg), 0),
     ('praca2_antes_da_praca1','2a praca datada ANTES da 1a (leitura de data trocada)','Captura','bug',
       (select c20 from ativos_agg), 0),
     ('praca_fim_antes_do_inicio','Encerramento de praca anterior a abertura','Captura','bug',
       (select c21 from ativos_agg), 0),
     ('brightdata_proposito_sem_teto','Proposito do Bright Data consumindo sem teto cadastrado','Captura','bug',
       (select count(*) from brightdata_uso_proposito p
         where p.semana = date_trunc('week', now())::date
           and not exists (select 1 from brightdata_reserva r where r.proposito = p.proposito)), 0),
     ('geocode_pago_no_mes','Chamadas de geocode do Google JA PAGAS no mes (acima das 10.000 gratuitas)','Captura','gap',
       (select greatest(0, coalesce(sum(requests),0) - 10000)::bigint
          from uso_integracoes
         where provedor = 'google_geocode' and dia >= date_trunc('month', now())::date), 200),
     ('geocode_retentativa_infinita','Imovel re-geocodificado 3+ vezes e ainda impreciso (teto de tentativas furado)','Captura','bug',
       (select c22 from ativos_agg), 0),
     ('geocode_sem_preco','LocationIQ consumindo com preco nao configurado (defina LOCATIONIQ_USD_POR_1000)','Ingestao','gap',
       (select case when coalesce(sum(requests),0) > 0 and coalesce(sum(custo_usd_micro),0) = 0
                    then coalesce(sum(requests),0) else 0 end::bigint
          from uso_integracoes
         where provedor = 'locationiq' and dia >= date_trunc('month', now())::date
           and not exists (select 1 from integracao_preco ip where ip.provedor = 'locationiq')), 0),
     ('mkt_ingestao_atrasada','Marketing: ingestao de algum CANAL parada (ultimo dia < D-2; D-1 chega ~10h50 UTC)','Ingestao','bug',
       (select count(*)::bigint from (
            select canal, max(data) as ult from marketing_metricas_dia group by canal
          ) c where c.ult < current_date - 2 and c.ult >= current_date - 60 and not exists (select 1 from marketing_canal_pausa p where p.canal = c.canal and p.retomado_em is null and p.pausado_em <= c.ult + 1)), 0),
     ('mkt_gasto_implausivel','Marketing: dia com gasto >20x a mediana 28d — separador decimal/escala','Ingestao','bug',
       (select count(*) from marketing_metricas_dia m
         where m.data > current_date - 28
           and m.gasto > 20 * greatest((select percentile_cont(0.5) within group (order by gasto)
                                          from marketing_metricas_dia where data > current_date - 28 and gasto > 0), 1)), 0),
     ('mkt_conversoes_maior_que_cliques','Marketing: conversoes > cliques no mesmo dia/canal — coluna trocada','Ingestao','bug',
       (select count(*) from marketing_metricas_dia where conversoes > cliques and (cliques > 0 or gasto > 0)), 0),
     ('mkt_valor_negativo','Marketing: gasto/cliques/conversoes negativo — parse quebrado','Ingestao','bug',
       (select count(*) from marketing_metricas_dia where gasto < 0 or cliques < 0 or conversoes < 0), 0),
     ('mkt_clique_pago_sem_rastreio','Marketing: canal pago com 50+ chegadas em 8d e <20% de visitas com o ID do canal (Google: gclid · Meta: fbclid sobre landing_page_view) — rastreador perdendo','Ingestao','bug',
       (select (case when exists (
           select 1 from (
             select canal,
                    sum(case when canal ilike 'meta%' then coalesce(
                          (conversoes_detalhe->'por_tipo'->>'landing_page_view')::numeric,
                          (conversoes_detalhe->'por_tipo'->>'link_click')::numeric, cliques)
                        else cliques end) as chegadas
               from marketing_metricas_dia
              where data > current_date - 8 and (canal ilike 'google%' or canal ilike 'meta%')
              group by canal) m
            where m.chegadas >= 50
              and (select count(*) from visita_origem v
                    where v.primeira_em > now() - interval '8 days'
                      and case when m.canal ilike 'google%'
                               then (v.gclid is not null or v.gbraid is not null or v.wbraid is not null)
                               else v.fbclid is not null end) < 0.2 * m.chegadas)
         then 1 else 0 end)::bigint), 0),
     ('atribuicao_paga_perdida','Cliente com visita paga cujo gclid nao chegou ao perfil','Ingestao','bug',
       public.qa_invariantes_atribuicao_perdida(), 0),
     ('email_para_endereco_suprimido','E-mail enviado para endereco na lista de supressao (o gate furou)','Atendimento','bug',
       public.qa_invariantes_supressao(), 0),
     ('lead_alavancagem_sem_dono_3d','Comercial: aplicacao de consorcio/home equity ha 3+ dias sem consultor atribuido','Comercial','gap',
       (select count(*) from sdr_leads l
         where l.origem like 'alavancagem_%' and l.consultor_id is null and l.finalizado_em is null
           and l.criado_em < now() - interval '3 days'), 0),
     ('lead_recebido_parado_2d','Comercial: lead recebido sem nenhum registro novo ha 2+ dias — consultor sumiu','Comercial','gap',
       (select count(*) from sdr_leads l
         where l.recebido_em is not null and l.finalizado_em is null
           and coalesce((select max(e.criado_em) from sdr_lead_eventos e where e.lead_id = l.id), l.recebido_em)
               < now() - interval '2 days'), 0),
     ('lead_finalizado_sem_comentario','Comercial: lead finalizado sem o evento de comentario — alguem contornou a RPC','Comercial','bug',
       (select count(*) from sdr_leads l
         where l.finalizado_em is not null
           and not exists (select 1 from sdr_lead_eventos e
                            where e.lead_id = l.id and e.tipo = 'finalizado'
                              and length(coalesce(e.comentario, '')) >= 5)), 0),
     ('nps_contradiz_resultado','Comercial: NPS do cliente contradiz o resultado do consultor (perdido x contratou / ganho x nao contratou)','Comercial','bug',
       (select count(*) from sdr_lead_nps n join sdr_leads l on l.id = n.lead_id
         where n.respondido_em is not null and l.resultado is not null
           and ((l.resultado = 'perdido' and n.contratou is true)
             or (l.resultado = 'ganho' and n.contratou is false))), 0),
     ('nps_vencido_nao_enviado','Comercial: atendimento confirmado ha 17+ dias com e-mail e SEM NPS enviado — cron do NPS parado','Comercial','bug',
       (select count(distinct l.id) from sdr_leads l
         where l.email is not null
           and exists (select 1 from sdr_lead_eventos e
                        where e.lead_id = l.id and e.tipo = 'atendimento_confirmado'
                          and e.criado_em <= now() - interval '17 days')
           and not exists (select 1 from sdr_lead_nps n
                            where n.lead_id = l.id and n.enviado_em is not null)), 0)
,
     ('tipo_casa_titulo_lote','Captura: lote/terreno sem nenhuma edificação no texto classificado como casa — mercadológico compara com casa','Captura','bug',
       (select c23 from ativos_agg), 0),
     ('matricula_area_de_outro_lote','Documental: mesma área de matrícula em 3+ lotes da mesma fonte e 2+ cidades — fato de outro lote do edital','Documental','bug',
       (select coalesce(sum(n),0) from (select count(*) n from imoveis_leilao
          where ativo and (doc_fatos->'matricula'->>'areaTerrenoM2') is not null
          group by fonte, doc_fatos->'matricula'->>'areaTerrenoM2'
          having count(*) >= 3 and count(distinct lower(cidade)) >= 2) g), 0)
,
     ('tipo_terreno_com_construcao','Captura: lote com casa/prédio/galpão no TÍTULO gravado como terreno — mercadológico ignora a construção (trigger trg_tipo_construido_pelo_titulo sumiu?)','Captura','bug',
       (select c24 from ativos_agg), 0)
,
     ('veiculo_cidade_fora_do_ibge','Captura: veículo ativo com cidade do pátio que não casa com município do IBGE — some do filtro de cidade (fonte nova com formato novo?)','Captura','gap',
       (select count(*) from veiculos_leilao where ativo and local_ibge = false), 30),
     ('veiculo_uf_invalida','Captura: veículo ativo com UF que não existe (título MARCA/MODELO lido como Cidade/UF, sigla de "sem informação") — some do filtro por estado','Captura','bug',
       (select count(*) from veiculos_leilao where ativo and estado is not null
          and estado !~ '^(AC|AL|AP|AM|BA|CE|DF|ES|GO|MA|MT|MS|MG|PA|PB|PR|PE|PI|RJ|RN|RS|RO|RR|SC|SP|SE|TO)$'), 0),
     ('link_matricula_morto','Documental: link_matricula aponta para arquivo do NOSSO Storage que não existe mais — selo verde de matrícula sem documento (limpeza apagou o arquivo e não zerou o link?)','Documental','bug',
       (select c25 from ativos_agg), 0)
  )
  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,
    case when valor > limite then 'alerta' else 'ok' end
  from inv;
$function$
;
