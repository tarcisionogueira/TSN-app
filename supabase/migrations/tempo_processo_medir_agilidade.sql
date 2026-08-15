-- TEMPO MÉDIO DE EVOLUÇÃO DO PROCESSO (15/08, pedido do dono: "saber se ele está sendo ágil").
--
-- ⚠️ A ARMADILHA QUE ESTA FUNÇÃO EXISTE PARA EVITAR, e que quase entrou no relatório:
-- a primeira medição do tempo de resposta em chamado deu **0,0 h de mediana, 22 de 22
-- respondidos** — um número de agilidade excelente. Era falso. Das 34 mensagens de chamado
-- no sistema, **33 são `autor_tipo='ia'`** (a saudação proativa do robô, disparada no mesmo
-- segundo da abertura) e 1 é do cliente. **Nunca houve uma única resposta humana.** Contar
-- "qualquer mensagem que não seja do cliente" como resposta transforma o bot em SLA.
--
-- Por isso a régua aqui separa os dois relógios, que neste produto são opostos:
--   · MÁQUINA — o que a IA gera sozinha. É rápido, e a medida confirma.
--   · HUMANO  — o que depende de alguém atender. É onde o processo para.
--
-- Misturar os dois produz a média que não descreve ninguém. Toda linha declara qual é.
--
-- Convenções: `mediana` é a medida principal (a média de tempo de processo é dominada por
-- poucos casos extremos — no funil mercadológico→documental a média deu 73,7 h contra 0,3 h
-- de mediana, porque a maioria segue na mesma sessão e alguns voltam dias depois).
-- `pior` é o caso mais extremo em aberto — é ele que vira reclamação.
create or replace function public.tempo_processo()
returns table (
  relogio     text,   -- 'maquina' | 'humano'
  etapa       text,
  unidade     text,
  n           bigint,
  mediana     numeric,
  media       numeric,
  pior        numeric,
  observacao  text
)
language sql
stable
security definer
set search_path = public
as $$
with m as (select user_id, imovel_id, min(created_at) t from analises_mercado   group by 1,2),
     d as (select user_id, imovel_id, min(created_at) t from analises_documental group by 1,2),
     l as (select user_id, imovel_id, min(created_at) t from analises_laudo      group by 1,2),
cadeia as (
  select m.t t_merc, d.t t_doc, l.t t_laudo
    from m left join d on d.user_id=m.user_id and d.imovel_id=m.imovel_id
           left join l on l.user_id=m.user_id and l.imovel_id=m.imovel_id),
-- Chamado: só conta como DÍVIDA nossa aquele em que o CLIENTE falou. O proativo da IA sem
-- retorno não é fila (mesma regra do ritual de abertura em CLAUDE.md).
-- E o `status='finalizado'` NÃO pode filtrar aqui. A primeira versão desta função excluía os
-- finalizados e devolveu **0** para "cliente sem resposta" — número verde e errado. O único
-- chamado do sistema em que um cliente de fato escreveu ("Deu erro no meu relatório", 06/07)
-- tem 1 mensagem dele, 1 da IA, **zero de humano**, e foi marcado FINALIZADO 9 dias depois.
-- Fechar não é responder: filtrar por status apaga justamente o caso pior.
cham as (
  select c.id, c.criado_em, c.status, c.atualizado_em,
    (select min(x.criado_em) from chamados_mensagens x where x.chamado_id=c.id and x.autor_tipo='cliente') t_cli,
    (select min(x.criado_em) from chamados_mensagens x where x.chamado_id=c.id
       and x.autor_tipo not in ('cliente','ia')) t_hum
  from chamados c)

select 'maquina', 'Geração: mercadológico → documental', 'horas',
       count(*) filter (where t_doc is not null),
       round(((percentile_cont(0.5) within group (order by extract(epoch from t_doc - t_merc)))/3600)::numeric,1),
       round((avg(extract(epoch from t_doc - t_merc))/3600)::numeric,1),
       round((max(extract(epoch from t_doc - t_merc))/3600)::numeric,1),
       'quanto o cliente leva para pedir o próximo relatório depois do primeiro'
  from cadeia
union all
select 'maquina', 'Geração: documental → laudo', 'horas',
       count(*) filter (where t_laudo is not null),
       round(((percentile_cont(0.5) within group (order by extract(epoch from t_laudo - t_doc)))/3600)::numeric,1),
       round((avg(extract(epoch from t_laudo - t_doc))/3600)::numeric,1),
       round((max(extract(epoch from t_laudo - t_doc))/3600)::numeric,1),
       'idem, do documental para o parecer final'
  from cadeia
union all
select 'humano', 'Funil: parado no mercadológico', 'dias',
       count(*), round((percentile_cont(0.5) within group (order by extract(epoch from now()-t_merc)/86400))::numeric,1),
       round((avg(extract(epoch from now()-t_merc))/86400)::numeric,1),
       round((max(extract(epoch from now()-t_merc))/86400)::numeric,1),
       'gerou o 1º relatório e nunca pediu o documental'
  from cadeia where t_doc is null
union all
select 'humano', 'Funil: parado no documental', 'dias',
       count(*), round((percentile_cont(0.5) within group (order by extract(epoch from now()-t_doc)/86400))::numeric,1),
       round((avg(extract(epoch from now()-t_doc))/86400)::numeric,1),
       round((max(extract(epoch from now()-t_doc))/86400)::numeric,1),
       'tem documental e nunca pediu o parecer final'
  from cadeia where t_doc is not null and t_laudo is null
union all
select 'humano', 'Atendimento: cliente falou e ninguém humano respondeu', 'dias',
       count(*) filter (where t_cli is not null and t_hum is null),
       round((percentile_cont(0.5) within group (order by extract(epoch from now()-t_cli)/86400)
              filter (where t_cli is not null and t_hum is null))::numeric,1),
       round((avg(extract(epoch from now()-t_cli)) filter (where t_cli is not null and t_hum is null)/86400)::numeric,1),
       round((max(extract(epoch from now()-t_cli)) filter (where t_cli is not null and t_hum is null)/86400)::numeric,1),
       'ainda aberto. Mensagem da IA NÃO conta como resposta — ver o comentário no topo'
  from cham where coalesce(status,'') <> 'finalizado'
union all
select 'humano', 'Atendimento: FECHADO sem nenhuma resposta humana', 'dias',
       count(*) filter (where t_cli is not null and t_hum is null),
       round((percentile_cont(0.5) within group (order by extract(epoch from atualizado_em-t_cli)/86400)
              filter (where t_cli is not null and t_hum is null))::numeric,1),
       round((avg(extract(epoch from atualizado_em-t_cli)) filter (where t_cli is not null and t_hum is null)/86400)::numeric,1),
       round((max(extract(epoch from atualizado_em-t_cli)) filter (where t_cli is not null and t_hum is null)/86400)::numeric,1),
       'o cliente escreveu, ninguém respondeu, e o chamado foi dado por encerrado'
  from cham where coalesce(status,'') = 'finalizado'
union all
select 'humano', 'Reunião: pedida e não marcada', 'dias',
       count(*), round((percentile_cont(0.5) within group (order by extract(epoch from now()-created_at)/86400))::numeric,1),
       round((avg(extract(epoch from now()-created_at))/86400)::numeric,1),
       round((max(extract(epoch from now()-created_at))/86400)::numeric,1),
       'mesma população do invariante reuniao_solicitada_parada'
  from solicitacoes
 where reuniao_em is null and coalesce(status,'') not in ('cancelado','concluido','recusado')
union all
select 'humano', 'Caso: tempo na etapa atual (' || status_etapa || ')', 'dias',
       count(*), round((percentile_cont(0.5) within group (order by extract(epoch from now()-coalesce(iniciado_em,created_at))/86400))::numeric,1),
       round((avg(extract(epoch from now()-coalesce(iniciado_em,created_at)))/86400)::numeric,1),
       round((max(extract(epoch from now()-coalesce(iniciado_em,created_at)))/86400)::numeric,1),
       'nenhum caso passou desta etapa até hoje'
  from casos where concluido_em is null group by status_etapa;
$$;

revoke all on function public.tempo_processo() from public, anon;
grant execute on function public.tempo_processo() to service_role, authenticated;
