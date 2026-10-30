-- 29/10 — "LEILOEIROS" DA PÁGINA INICIAL = LEILOEIROS OFICIAIS COM LOTE À VENDA. Pedido do dono (confuso com 648 na
-- página × 949 cobertos): o número contava NOMES distintos escritos nos lotes ativos — "Caixa Econômica Federal",
-- "Superbid", portais e duas grafias do mesmo leiloeiro valiam um cada. Agora conta leiloeiros ATIVOS das juntas
-- (`leiloeiro_junta`) com ao menos um lote ativo (imóvel ou veículo), casados pelo NOME no lote ou pelo SITE de onde o lote
-- vem (escritório com vários leiloeiros no mesmo domínio — Leilão Brasil 13, Rico 11, Destak 9 — conta todos).
-- 29/10: 798 (era 648 nomes). Custo medido: 0,37 s (os nomes são normalizados DEPOIS do distinct — 50 mil linhas → 650
-- nomes); a função inteira levava 2,7 s dentro dos 8 s do statement_timeout do PostgREST.
create or replace function public.landing_leiloeiros_oficiais()
returns integer language sql stable security definer set search_path to 'public' as $function$
  with brutos as (
    select distinct leiloeiro l, lower(substring(url_lote from '://(?:www\.)?([^/:]+)')) h from imoveis_leilao where ativo
    union
    select distinct leiloeiro, lower(substring(link_lote from '://(?:www\.)?([^/:]+)')) from veiculos_leilao where ativo),
  nomes as (select distinct public.sem_acento(lower(trim(regexp_replace(l, '\s*\(.*$', '')))) n
              from (select distinct l from brutos) x where coalesce(l, '') <> ''),
  hosts as (select distinct h from brutos where coalesce(h, '') <> '')
  select count(*)::int from leiloeiro_junta j
   where j.situacao = 'ATIVO'
     and (public.sem_acento(lower(trim(regexp_replace(j.nome, '\s*\(.*$', '')))) in (select n from nomes)
          or lower(regexp_replace(j.dominio, '^www\.', '')) in (select h from hosts));
$function$;

-- Troca SÓ o trecho de leiloeiros dentro de landing_numeros_atualizar() (vitrine e demais números intocados). Aborta se
-- o trecho antigo não estiver lá — melhor falhar a migração que gravar a função pela metade.
do $migra$
declare d text; novo text;
begin
  d := pg_get_functiondef('public.landing_numeros_atualizar'::regproc);
  novo := regexp_replace(d, $re$'leiloeiros', \(select count\(distinct lower\(trim\(l\)\)\).*?trim\(l\) <> ''\),$re$,
                         $n$'leiloeiros', public.landing_leiloeiros_oficiais(),$n$);
  if novo = d then raise exception 'landing_numeros_atualizar: trecho antigo de leiloeiros não encontrado'; end if;
  execute novo;
end $migra$;

-- Recalcula agora (a página e o histórico do dia passam a mostrar o número novo).
select public.landing_numeros_atualizar();
