-- 30/10 (dono): "informe na página inicial os leiloeiros conectados, independente de terem lotes ou não. caso venham a
-- ter lotes aparecerá no sistema". O número da landing passa de "com lote ativo agora" para CONECTADOS: o placar das
-- Juntas (leiloeiro_junta.coletado_status = coletado | codigo_sem_lote | agregador) somado a quem aparece em lote ativo
-- por nome ou host (o critério antigo — leiloeiro coletado que o placar ainda não cruzou não some da conta).
-- O rótulo na tela vira "leiloeiros conectados" (src/pages/Landing.jsx), para não prometer lote no ar.
CREATE OR REPLACE FUNCTION public.landing_leiloeiros_oficiais()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with brutos as (
    select distinct leiloeiro l, lower(substring(url_lote from '://(?:www\.)?([^/:]+)')) h from imoveis_leilao where ativo
    union
    select distinct leiloeiro, lower(substring(link_lote from '://(?:www\.)?([^/:]+)')) from veiculos_leilao where ativo),
  nomes as (select distinct public.sem_acento(lower(trim(regexp_replace(l, '\s*\(.*$', '')))) n
              from (select distinct l from brutos) x where coalesce(l, '') <> ''),
  hosts as (select distinct h from brutos where coalesce(h, '') <> '')
  select count(*)::int from leiloeiro_junta j
   where j.situacao = 'ATIVO'
     and (j.coletado_status in ('coletado', 'codigo_sem_lote', 'agregador')
          or public.sem_acento(lower(trim(regexp_replace(j.nome, '\s*\(.*$', '')))) in (select n from nomes)
          or lower(regexp_replace(j.dominio, '^www\.', '')) in (select h from hosts));
$function$;

-- Retrato da landing já com o número novo.
select public.landing_numeros_atualizar();
