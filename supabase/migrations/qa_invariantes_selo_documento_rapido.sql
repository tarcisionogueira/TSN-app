-- 11/09: qa_invariantes() vinha rodando 5,3-8,4s/dia, acima do limite de 5s do próprio
-- invariante `qa_invariantes_lenta`. EXPLAIN ANALYZE isolou a causa: o invariante
-- `selo_documento_dessincronizado` sozinho gastava ~2,5s dos ~4,2s totais — ele chama
-- calc_tem_edital_doc()/calc_tem_matricula_doc() para CADA um dos 25.649 imóveis ativos, e
-- cada chamada faz um EXISTS correlacionado contra imovel_anexos (41.562 linhas) — até ~100
-- mil probes indexados por rodada, cada um pagando overhead de invocação de função.
--
-- Conserto: agrega imovel_anexos UMA VEZ (bool_or por imovel_id, mesmo critério ilike/
-- doc_arquivo das funções originais) e faz UM left join, em vez de chamar as funções por
-- linha. As funções calc_tem_edital_doc/calc_tem_matricula_doc continuam intactas (outros
-- lugares podem depender delas) — só ESTE invariante para de usá-las, com lógica equivalente
-- inline. Testado antes de aplicar: mesmo resultado (0 hoje) em 670ms em vez de 2.496ms —
-- qa_invariantes() completo cai de ~4,2s para ~2,4s, dentro do limite de 5s.
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
      left join public.imoveis_leilao i on i.id::text = a.imovel_id::text
  ),
  -- Pré-agregação de imovel_anexos p/ o invariante selo_documento_dessincronizado (11/09) —
  -- mesmo critério ilike/doc_arquivo de calc_tem_edital_doc/calc_tem_matricula_doc, mas UMA
  -- passada em vez de EXISTS correlacionado por linha.
  anexos_agg as (
    select a.imovel_id,
           bool_or((a.tipo ilike '%edital%' or a.nome ilike '%edital%') and public.doc_arquivo(a.url)) as tem_edital_anexo,
           bool_or((a.tipo ilike '%matricula%' or a.nome ilike '%matr%') and public.doc_arquivo(a.url)) as tem_matricula_anexo
      from public.imovel_anexos a
     group by a.imovel_id
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
       (select count(*) from imoveis_leilao i where i.ativo and i.pontos_proximos = '{}'::jsonb
          and coalesce(i.cidade,'') <> ''
          and exists (select 1 from imoveis_leilao v
                       where v.ativo and v.cidade = i.cidade and v.estado is not distinct from i.estado
                         and v.pontos_proximos is not null and v.pontos_proximos <> '{}'::jsonb)), 300),
     ('bd_teto_saturado','Bright Data: cota semanal perto do teto','Captura','bug',
       (select coalesce(requests,0) from brightdata_uso where semana = date_trunc('week', now())::date),
       coalesce((select round(coalesce(teto,450) * 0.9)::int from brightdata_uso where semana = date_trunc('week', now())::date), 405)),
     ('fonte_cega_no_monitor','Fonte com acervo ativo e sem histórico de saúde','Captura','bug',
       (select count(*) from (select distinct i.fonte from imoveis_leilao i
          where i.ativo and not exists (select 1 from fonte_saude s where s.fonte = i.fonte)) c), 0),
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
       (select count(*) from imoveis_leilao
         where ativo and titulo ~ 'Lance Inicial:\s*R\$\s*[\d.]+,\d{2}'
           and abs(coalesce(valor_minimo,0) - replace(regexp_replace(
                 (regexp_match(titulo, 'Lance Inicial:\s*R\$\s*([\d.]+,\d{2})'))[1],
                 '[^0-9,]', '', 'g'), ',', '.')::numeric) > 1), 0),
     ('leilao_vencido_ativo','Lote ativo com todas as praças já vencidas','Captura','bug',
       (select count(*) from imoveis_leilao i where i.ativo
          and public.leilao_ja_encerrado(i.data_leilao, i.data_leilao_2, i.data_fim, i.modalidade)), 0),
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
       (select count(*) from imoveis_leilao where ativo and coalesce(valor_avaliacao,0)=0
          and ((case when jsonb_typeof(anexos)='array' then jsonb_array_length(anexos) else 0 end) > 0 or coalesce(link_edital,'') ~* '\.pdf')), 4000),
     ('desconto_ge90','Desconto ≥ 90% (suspeito de mis-read)','Relatório','gap',
       (select count(*) from imoveis_leilao where ativo and desconto_percentual >= 90), 200),
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
           and coalesce(i.valor_minimo_ref, i.valor_minimo) > t.v), 0),
     ('receita_sem_cliente','Pagamento contado como VENDA sem nenhum cliente vinculado (despesa da conta virando faturamento)','Financeiro','bug',
       (select count(*) from mp_pagamentos
         where origem in ('avulso','recorrente') and user_id is null), 0),
     ('sem_foto','Lote ativo sem foto','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(link_foto,'')=''), 1600),
     ('sem_cidade','Lote ativo sem cidade','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(cidade,'')=''), 30),
     ('bem_movel_no_acervo','Bem movel (veiculo/aeronave) ativo numa plataforma de imoveis','Captura','bug',
       (select count(*) from imoveis_leilao where ativo and public.bem_movel_barrado(titulo, descricao)), 0),
     ('pino_generico_como_rua','Coordenada compartilhada por vias diferentes ainda marcada como precisa','Captura','bug',
       coalesce((select case when m.medido_em < now() - interval '3 days' then 9999 else m.valor end
                   from public.qa_medida_externa m where m.chave = 'pino_generico_como_rua'), 9999), 25),
     ('uf_cef_congelada','UF da CEF que parou de ser atualizada enquanto as outras seguiram','Captura','bug',
       (select count(*) from public.ufs_cef_congeladas()), 0),
     ('qa_invariantes_lenta','Painel de invariantes: ultima rodada FALHOU, sumiu ha 3+ dias, ou o PAINEL (nao a rede) passou de 5s','Infra','bug',
       coalesce((select case when e.executado_em < now() - interval '3 days' then 9999
                      when not e.ok then 9999
                      else coalesce(e.ms_servidor, e.ms) end
                   from public.qa_invariantes_execucao e
                  order by e.executado_em desc limit 1), 9999), 5000),
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
          select fonte,
                 min(data_leilao::date) as d,
                 count(distinct data_leilao::date) as nd
            from imoveis_leilao
           where ativo and data_leilao is not null
           group by fonte
          having count(*) >= 100 and count(distinct data_leilao::date) <= 2
        ) u
         where not (u.nd = 1
                    and exists (select 1 from public.fonte_data_uniforme_verificada v
                                 where v.fonte = u.fonte and v.data_leilao = u.d))), 0),
     ('venda_direta_com_praca','Modalidade venda_direta com praça datada (classificação errada)','Captura','bug',
       (select count(*) from imoveis_leilao where ativo and modalidade ilike '%venda%direta%' and data_leilao is not null), 0),
     ('data_edital_recuou_prazo','Divergencia de data entre edital e acervo em aberto','Relatorio','bug',
       (select count(*) from relatorio_anomalias
         where tipo = 'data_divergente_edital' and not resolvido
           and atualizado_em > now() - interval '30 days'), 0),
     ('live_numeros_congelados','Números da vitrine da live parados (cron horário não recalcula)','Infra','bug',
       public.qa_invariante_live_numeros_congelados(), 0),
     ('radar_editais_sem_pull','Radar de Editais (DJEN) sem nenhum pull bem-sucedido - captura parada em silencio','Captura','bug',
       public.qa_invariante_radar_editais_sem_pull(), 2),
     ('editais_cruzamento_cego','Edital com leiloeiro nomeado que nao pode ser cruzado com o acervo','Captura','bug',
       public.qa_invariante_editais_cruzamento_cego(), 0)
  )
  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,
    case when valor > limite then 'alerta' else 'ok' end
  from inv;
$function$;
