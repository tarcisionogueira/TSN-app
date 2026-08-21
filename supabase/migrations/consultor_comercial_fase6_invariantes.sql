-- =====================================================================================
-- CONSULTOR COMERCIAL — FASE 6: invariantes de vigilância (o rastro no banco grita se
-- qualquer engrenagem do comercial parar — mesma filosofia do 1b do ritual).
--
-- Cinco invariantes, categoria 'Comercial', todos LIMITE 0:
--   · lead_alavancagem_sem_dono_3d — aplicação de consórcio/home equity há 3+ dias sem
--       consultor: cliente pediu contato e ninguém é responsável (o pior silêncio).
--   · lead_recebido_parado_2d — recebido, não finalizado e sem NENHUM evento novo há
--       2+ dias: o consultor pegou o cliente e sumiu (SLA da decisão em aberto nº 3;
--       ajuste o prazo aqui se o dono definir outro).
--   · lead_finalizado_sem_comentario — estruturalmente impossível pela RPC
--       (comercial_registrar_evento exige comentário ≥5); o invariante vigia a porta
--       dos fundos (update direto por service/admin).
--   · nps_contradiz_resultado — o CRUZAMENTO-CHAVE do rastreio: consultor marcou
--       'perdido' e o cliente respondeu que CONTRATOU (provável fechamento por fora),
--       ou 'ganho' com cliente dizendo que NÃO contratou (registro inflado).
--   · nps_vencido_nao_enviado — atendimento confirmado há 17+ dias (15 da regra + 2 de
--       folga do cron diário) com e-mail e sem NPS enviado: o cron do NPS parou.
--
-- Idempotente; cirurgia de string sobre o prosrc VIVO (mesmo idioma de
-- qa_invariantes_ingestao_marketing.sql), âncora no lote_sem_area_nem_matricula.
-- Conferir depois: select * from qa_invariantes() where categoria='Comercial' → 5 linhas.
-- =====================================================================================
do $outer$
declare corpo text; novo text; bloco text;
begin
  select prosrc into corpo from pg_proc where proname = 'qa_invariantes';
  if corpo is null then raise exception 'qa_invariantes nao existe'; end if;

  -- Já aplicado? (idempotência)
  if position('nps_contradiz_resultado' in corpo) > 0 then return; end if;

  if position('(''lote_sem_area_nem_matricula''' in corpo) = 0 then
    raise exception 'ancora (lote_sem_area_nem_matricula) nao encontrada em qa_invariantes';
  end if;

  bloco := $blk$     ('lead_alavancagem_sem_dono_3d','Comercial: aplicacao de consorcio/home equity ha 3+ dias sem consultor atribuido','Comercial','gap',
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
                            where n.lead_id = l.id and n.enviado_em is not null)), 0),
$blk$;

  novo := replace(corpo, '(''lote_sem_area_nem_matricula''', bloco || '     (''lote_sem_area_nem_matricula''');
  if novo = corpo then raise exception 'NAO SUBSTITUIU — replace nao alterou o corpo'; end if;
  if position('nps_contradiz_resultado' in novo) = 0 then raise exception 'invariantes novos nao entraram'; end if;
  if position('(''lote_sem_area_nem_matricula''' in novo) = 0 then raise exception 'comeu o invariante seguinte'; end if;

  execute 'create or replace function public.qa_invariantes() returns table(chave text, titulo text, categoria text, gravidade text, valor bigint, limite bigint, status text) language sql stable as $corpo$' || novo || '$corpo$';
end $outer$;
