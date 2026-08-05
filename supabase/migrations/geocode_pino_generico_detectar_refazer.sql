-- ─────────────────────────────────────────────────────────────────────────────
-- PINO GENÉRICO ROTULADO COMO PRECISO — detecção + correção (05/08/2026)
--
-- Gatilho: lote do Rafael (zuk_37094-231508). O endereço passou a existir (derivado
-- do título em 04/08), o re-geocode rodou… e gravou a MESMA coordenada genérica de
-- Guarulhos com geocod_nivel='rua'. Causa-raiz no código: o Nominatim, quando não
-- encontra a rua no OSM, devolve o NÓ DA CIDADE — e a cascata rotulava pelo INPUT
-- ("pedi rua+número"), não pelo que foi ENCONTRADO. Corrigido em api/_geo.js
-- (nivelNominatim + capNivel em todos os retornos da cascata).
--
-- O SINAL que identifica o pino genérico no ACERVO (independente do provedor):
-- a MESMA coordenada exata (7 casas decimais) compartilhada por LOGRADOUROS
-- DIFERENTES. Duas ruas distintas não têm o mesmo ponto; um prédio com N aptos tem
-- N lotes no MESMO logradouro e não dispara. Medido em 05/08: 685 grupos, 3.458
-- lotes ativos rotulados 'rua'/'endereco' — que por estarem rotulados precisos
-- NUNCA entravam na fila de refazer (o dano ficava invisível).
--
-- Esta migração:
--   1. cria a função de detecção (usada pelo monitor-dados-cron como backstop
--      permanente — se o padrão voltar, o dono é avisado);
--   2. re-enfileira (geocod_nivel='refazer') os lotes presos no padrão — a cascata
--      CORRIGIDA re-geocodifica com rótulo honesto (vazão ~23k/dia; drena em <1 dia).
-- Idempotente: rodar de novo re-detecta e re-enfileira só o que ainda estiver preso.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Detecção. Conta lotes ativos rotulados precisos ('rua'/'endereco') cuja
-- coordenada exata é compartilhada por 2+ logradouros distintos (1º segmento do
-- endereço, normalizado). SECURITY INVOKER; EXECUTE só para service_role — segue a
-- regra do hardening de 24/07 (rpc_definer_revogar_anon).
create or replace function public.geocode_pinos_genericos()
returns table (latitude numeric, longitude numeric, lotes_precisos bigint, vias bigint)
language sql
stable
set search_path = public
as $$
  select i.latitude::numeric, i.longitude::numeric,
         count(*) filter (where i.geocod_nivel in ('rua','endereco')) as lotes_precisos,
         count(distinct lower(btrim(split_part(i.endereco, ',', 1)))) as vias
  from public.imoveis_leilao i
  where i.ativo
    and i.latitude is not null and i.latitude::numeric <> 0
    and coalesce(btrim(i.endereco), '') <> ''
  group by i.latitude::numeric, i.longitude::numeric
  having count(distinct lower(btrim(split_part(i.endereco, ',', 1)))) > 1
     and count(*) filter (where i.geocod_nivel in ('rua','endereco')) > 0
$$;

revoke execute on function public.geocode_pinos_genericos() from public, anon, authenticated;
grant execute on function public.geocode_pinos_genericos() to service_role;

-- Total agregado para o monitor (uma chamada, um número).
create or replace function public.geocode_pinos_genericos_total()
returns bigint
language sql
stable
set search_path = public
as $$
  select coalesce(sum(lotes_precisos), 0) from public.geocode_pinos_genericos()
$$;

revoke execute on function public.geocode_pinos_genericos_total() from public, anon, authenticated;
grant execute on function public.geocode_pinos_genericos_total() to service_role;

-- 2) Re-enfileira TODO lote ativo rotulado preciso numa coordenada genérica —
-- inclusive os de endereço vazio que caíram no mesmo ponto: se duas ruas diferentes
-- reivindicam a coordenada, qualquer rótulo 'rua'/'endereco' ali é mentira.
-- geocod_reproc_em carimbado para respeitar o guard de 14 dias do regeocod.
with genericas as (
  select latitude, longitude from public.geocode_pinos_genericos()
)
update public.imoveis_leilao i
set geocod_nivel = 'refazer', geocod_reproc_em = now()
from genericas g
where i.ativo
  and i.geocod_nivel in ('rua','endereco')
  and i.latitude::numeric = g.latitude
  and i.longitude::numeric = g.longitude;
