-- TEMPO ENTRE DESPACHOS — "este processo está andando rápido?" (15/08, pedido do dono).
--
-- O QUE FALTAVA, medido antes de escrever qualquer linha:
--   1. A chave. 1.782 lotes JUDICIAIS ativos e **3** com `numero_processo` (0,17%). O número
--      está no edital de todos eles; só era lido pela IA dentro do relatório documental, que
--      roda quando um cliente paga — e foram 17 documentais na história do sistema.
--   2. A série. O `cnj-monitor-cron` já consultava o DataJud e recebia os movimentos COM DATA,
--      mas gravava no snapshot apenas `total_mov` e `ultima_data`. **Guardar só o último
--      movimento torna o intervalo entre despachos incalculável por construção** — dá para
--      saber que mexeu, nunca em que ritmo.
--   3. A conta. Não existia.
--
-- Esta migração resolve 2 e 3. A 1 é código (`extrairNumeroProcessoTexto`, custo zero).
--
-- ⚠️ RESSALVA QUE PRECISA VIAJAR JUNTO COM O NÚMERO: o DataJud **não é tempo real** e o
-- `formatarProcesso` traz os **20 movimentos mais recentes**. Logo a mediana daqui é a
-- cadência RECENTE, não a história inteira do processo — que é justamente o que a pergunta
-- "está rápido AGORA?" quer. Um processo de 1998 com 400 movimentos não terá os 400 aqui, e
-- `movimentos_conhecidos` diz quantos entraram na conta para ninguém confundir os dois.

create table if not exists public.processo_movimentos (
  id             bigserial primary key,
  numero_processo text not null,
  data           date not null,
  codigo         integer,
  descricao      text,
  risco          text,
  criado_em      timestamptz not null default now()
);
-- Idempotência: o cron reconsulta todo dia e reencontra os mesmos movimentos. Sem esta
-- unicidade cada rodada duplicaria a série e a mediana de intervalo iria a zero — um número
-- de "processo muito ágil" fabricado pelo próprio coletor.
create unique index if not exists processo_movimentos_unico
  on public.processo_movimentos (numero_processo, data, coalesce(codigo, -1), coalesce(descricao, ''));
create index if not exists processo_movimentos_num_data
  on public.processo_movimentos (numero_processo, data desc);

alter table public.processo_movimentos enable row level security;
-- Sem policy de leitura para anon/authenticated: a série é operacional, consumida pelo
-- servidor (service_role ignora RLS). Quem precisa ver lê pela RPC abaixo.

comment on table public.processo_movimentos is
  'Série de movimentos processuais vinda do DataJud/CNJ. Alimenta processo_cadencia().';

-- CADÊNCIA: o intervalo entre despachos, e se o processo está mais lento que ELE MESMO.
--
-- A régua é auto-aprendida do próprio histórico, como já se faz com os leiloeiros em
-- `fonte_baseline_aprendida()`: não existe "rápido" universal — execução fiscal e inventário
-- têm ritmos incomparáveis. O que se pode afirmar é que um processo está mais devagar do que
-- vinha, e é isso que `veredito` diz.
create or replace function public.processo_cadencia(p_numero text default null)
returns table (
  numero_processo        text,
  movimentos_conhecidos  bigint,
  primeiro               date,
  ultimo                 date,
  dias_desde_ultimo      integer,
  mediana_dias_entre     numeric,
  media_dias_entre       numeric,
  maior_intervalo        integer,
  veredito               text
)
language sql
stable
security definer
set search_path = public
as $fn$
with base as (
  select m.numero_processo, m.data,
         lag(m.data) over (partition by m.numero_processo order by m.data) as anterior
    from processo_movimentos m
   where p_numero is null or m.numero_processo = p_numero),
intervalos as (
  select numero_processo, (data - anterior) as dias from base where anterior is not null),
agg as (
  select b.numero_processo,
         count(*) as n, min(b.data) as pri, max(b.data) as ult,
         (current_date - max(b.data))::int as parado_ha
    from base b group by 1)
select a.numero_processo, a.n, a.pri, a.ult, a.parado_ha,
       round((percentile_cont(0.5) within group (order by i.dias))::numeric, 1),
       round(avg(i.dias)::numeric, 1),
       max(i.dias)::int,
       case
         -- Menos de 3 intervalos não sustenta mediana; dizer "ágil" aqui seria inventar.
         when count(i.dias) < 3 then 'sem base'
         when a.parado_ha > greatest(90, 3 * percentile_cont(0.5) within group (order by i.dias)) then 'parado'
         when a.parado_ha >     greatest(30, 1.5 * percentile_cont(0.5) within group (order by i.dias)) then 'lento'
         else 'andando'
       end
  from agg a left join intervalos i on i.numero_processo = a.numero_processo
 group by a.numero_processo, a.n, a.pri, a.ult, a.parado_ha;
$fn$;

revoke all on function public.processo_cadencia(text) from public, anon;
grant execute on function public.processo_cadencia(text) to service_role, authenticated;

-- SEMEIA O MONITOR com o que já temos de número de processo: os editais judiciais capturados
-- pelos scrapers (153) e os lotes que já tinham a chave. Sem isto a tabela de monitorados
-- seguiria VAZIA — que é como ela estava hoje, com o cron rodando e não tendo o que checar.
insert into public.processos_monitorados (numero_processo, uf, imovel_id, rotulo, ativo)
select distinct on (regexp_replace(e.numero_processo, '\D', '', 'g'))
       e.numero_processo,
       nullif(substring(e.tribunal from 'TJ(..)'), ''),
       null,
       coalesce('Edital ' || nullif(e.comarca, ''), 'Edital'),
       true
  from public.editais_leilao e
 where e.numero_processo is not null and e.numero_processo <> ''
   and length(regexp_replace(e.numero_processo, '\D', '', 'g')) = 20
on conflict (numero_processo) do nothing;

insert into public.processos_monitorados (numero_processo, uf, imovel_id, rotulo, ativo)
select distinct on (regexp_replace(i.numero_processo, '\D', '', 'g'))
       i.numero_processo, i.estado, i.id, 'Lote ' || i.id, true
  from public.imoveis_leilao i
 where i.ativo and i.numero_processo is not null and i.numero_processo <> ''
   and length(regexp_replace(i.numero_processo, '\D', '', 'g')) = 20
on conflict (numero_processo) do nothing;
