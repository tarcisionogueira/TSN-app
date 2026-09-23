-- ─────────────────────────────────────────────────────────────────────────────────────────
-- 21 VIGIAS SUMIRAM DE qa_invariantes() E NINGUÉM PERCEBEU — 23/09/2026
--
-- Achado indo atrás de "por que a ingestão de marketing parada há 9 dias não gritou?".
-- A resposta: `mkt_ingestao_atrasada` NÃO EXISTIA MAIS na função de produção — nem ele, nem
-- outros 20. Comparei toda chave declarada em supabase/migrations/ (padrão
-- `('chave','titulo','Categoria','gravidade'`) contra `select chave from qa_invariantes()`:
-- 21 ausentes (fora os 2 substituídos DE PROPÓSITO: `doc_link_sem_documento` →
-- `selo_documento_dessincronizado` e `geocode_acima_da_cota` → `geocode_pago_no_mes`).
--
-- CAUSA: as migrações que REESCREVEM A FUNÇÃO INTEIRA (a partir de
-- qa_invariante_venda_direta_com_praca.sql, depois doc_debito_…, contrato_texto_truncado,
-- acervo_fora_de_escopo…, editais_avaliacao_perdida, leilao_vencido_ativo_exclui…) partiram
-- de um SNAPSHOT que já não tinha estes vigias. Cada reescrita seguinte copiou a anterior —
-- a perda virou permanente. É a forma 7b do CLAUDE.md, e ela não dá erro: um vigia a
-- menos é SILÊNCIO, que é exatamente o "verde" do painel.
--
-- Rodado EM SECO sobre o dado real antes de aplicar (as 21 expressões compilaram). Sete já
-- acusariam hoje: mkt_ingestao_atrasada=2 (os dois canais — o achado que puxou o fio),
-- estado_fora_do_padrao=96, praca_fim_antes_do_inicio=20, lote_sem_area_nem_matricula=526
-- (limite 400), geocode_sem_preco=73, brightdata_proposito_sem_teto=1,
-- area_truncada_no_milhar=1. Cada bloco é a ÚLTIMA versão da migração de origem (inclui a
-- correção por canal de ingestao_de_marketing_vigiada_por_canal.sql).
--
-- ⚠️ REGRA PARA A PRÓXIMA REESCRITA COMPLETA DA FUNÇÃO: parta de
-- `pg_get_functiondef('public.qa_invariantes()'::regprocedure)` (o banco), NUNCA de um
-- .sql antigo do repo — e confira `select count(*) from qa_invariantes()` antes e depois.
-- Idempotente: se `mkt_ingestao_atrasada` já estiver presente, não faz nada.
-- ─────────────────────────────────────────────────────────────────────────────────────────

do $do$
declare
  d      text := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  ancora text := E'\n  )\n  select chave, titulo, categoria, gravidade,';
  antes  int;
  bloco  text := $blk$,
     ('lote_sem_area_nem_matricula','Lote sem metragem E sem matricula para recupera-la','Captura','gap',
       (select count(*) from imoveis_leilao where ativo and coalesce(area_m2,0)=0
          and link_matricula is null and anexos::text !~* 'matricula'), 400),
     ('area_truncada_no_milhar','Área gravada é o resto de milhar de um número maior no título/descrição (regex sem grupo de milhar)','Captura','bug',
       (select count(*) from imoveis_leilao
          where ativo and coalesce(area_m2,0) > 0 and area_m2 < 1000
            and (coalesce(titulo,'') || ' ' || coalesce(descricao,'')) ~ ('\d{1,2}\.' || to_char(floor(area_m2)::int, 'FM000') || '([,.]\d{1,2})?\s*m[²2]')
       ), 0),
     ('estado_fora_do_padrao','Lote ativo com estado que nao e sigla de 2 letras (some de /leiloes)','Captura','bug',
       (select count(*) from imoveis_leilao
         where ativo and (estado is null or estado !~ '^[A-Za-z]{2}$')), 0),
     ('praca2_antes_da_praca1','2a praca datada ANTES da 1a (leitura de data trocada)','Captura','bug',
       (select count(*) from imoveis_leilao
         where data_leilao ~ '^\d{4}-\d{2}-\d{2}' and data_leilao_2 is not null
           and (data_leilao_2 at time zone 'America/Sao_Paulo')::date <= (data_leilao)::date), 0),
     ('praca_fim_antes_do_inicio','Encerramento de praca anterior a abertura','Captura','bug',
       (select count(*) from imoveis_leilao
         where (praca1_fim is not null and data_leilao ~ '^\d{4}-\d{2}-\d{2}' and praca1_fim < (data_leilao)::timestamptz)
            or (praca2_fim is not null and data_leilao_2 is not null and praca2_fim < data_leilao_2)), 0),
     ('brightdata_proposito_sem_teto','Proposito do Bright Data consumindo sem teto cadastrado','Captura','bug',
       (select count(*) from brightdata_uso_proposito p
         where p.semana = date_trunc('week', now())::date
           and not exists (select 1 from brightdata_reserva r where r.proposito = p.proposito)), 0),
     ('geocode_pago_no_mes','Chamadas de geocode do Google JA PAGAS no mes (acima das 10.000 gratuitas)','Captura','gap',
       (select greatest(0, coalesce(sum(requests),0) - 10000)::bigint
          from uso_integracoes
         where provedor = 'google_geocode' and dia >= date_trunc('month', now())::date), 200),
     ('geocode_retentativa_infinita','Imovel re-geocodificado 3+ vezes e ainda impreciso (teto de tentativas furado)','Captura','bug',
       (select count(*) from imoveis_leilao
         where ativo and geocod_nivel in ('cidade','falhou') and coalesce(geocod_tentativas,0) > 3), 0),
     ('geocode_sem_preco','LocationIQ consumindo com preco nao configurado (defina LOCATIONIQ_USD_POR_1000)','Ingestao','gap',
       (select case when coalesce(sum(requests),0) > 0 and coalesce(sum(custo_usd_micro),0) = 0
                    then coalesce(sum(requests),0) else 0 end::bigint
          from uso_integracoes
         where provedor = 'locationiq' and dia >= date_trunc('month', now())::date), 0),
     ('mkt_ingestao_atrasada','Marketing: ingestao de algum CANAL parada (ultimo dia < D-2; D-1 chega ~10h50 UTC)','Ingestao','bug',
       (select count(*)::bigint from (
            select canal, max(data) as ult from marketing_metricas_dia group by canal
          ) c where c.ult < current_date - 2 and c.ult >= current_date - 10), 0),
     ('mkt_gasto_implausivel','Marketing: dia com gasto >20x a mediana 28d — separador decimal/escala','Ingestao','bug',
       (select count(*) from marketing_metricas_dia m
         where m.data > current_date - 28
           and m.gasto > 20 * greatest((select percentile_cont(0.5) within group (order by gasto)
                                          from marketing_metricas_dia where data > current_date - 28 and gasto > 0), 1)), 0),
     ('mkt_conversoes_maior_que_cliques','Marketing: conversoes > cliques no mesmo dia/canal — coluna trocada','Ingestao','bug',
       (select count(*) from marketing_metricas_dia where conversoes > cliques), 0),
     ('mkt_valor_negativo','Marketing: gasto/cliques/conversoes negativo — parse quebrado','Ingestao','bug',
       (select count(*) from marketing_metricas_dia where gasto < 0 or cliques < 0 or conversoes < 0), 0),
     ('mkt_clique_pago_sem_rastreio','Marketing: 7d com 50+ cliques pagos e <20% de visitas com gclid — rastreador perdendo','Ingestao','bug',
       (select (case when coalesce((select sum(cliques) from marketing_metricas_dia where data > current_date - 8), 0) >= 50
           and (select count(*) from visita_origem
                  where primeira_em > now() - interval '8 days'
                    and (gclid is not null or gbraid is not null or wbraid is not null))
               < 0.2 * (select sum(cliques) from marketing_metricas_dia where data > current_date - 8)
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
$blk$;
begin
  if position('''mkt_ingestao_atrasada''' in d) > 0 then
    raise notice 'vigias ja presentes — nada a fazer'; return;
  end if;
  if (length(d) - length(replace(d, ancora, ''))) / length(ancora) <> 1 then
    raise exception 'ancora nao encontrada exatamente 1x em qa_invariantes() — abortando';
  end if;
  select count(*) into antes from public.qa_invariantes();
  execute replace(d, ancora, rtrim(bloco, E'\n') || ancora);
  if (select count(*) from public.qa_invariantes()) <> antes + 21 then
    raise exception 'esperava % + 21 invariantes depois da restauracao', antes;
  end if;
end
$do$;
