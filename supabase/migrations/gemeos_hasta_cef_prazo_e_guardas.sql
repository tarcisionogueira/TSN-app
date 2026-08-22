-- 22/08 — CONSERTA a reconciliação de gêmeos HASTA×CEF antes do penhasco de 28/08.
-- Achados do bug bounty de abertura (todos confirmados; hoje LATENTES porque nenhuma praça
-- HASTA venceu ainda). Contexto crítico: os 579 lotes HASTA têm data_leilao = '2026-08-28'
-- (praça única gravada) e data_leilao_2 = null. Sob a função original, em 29/08 o `alvo`
-- esvaziava para TODOS de uma vez e os 539 gêmeos CEF voltavam à vitrine em bloco, com o
-- preço divergente — o mesmo imóvel 2×.
--
-- A1 — REATIVAÇÃO sem guarda ressuscitava gêmeo morto. O `rea` só exigia "saiu do alvo" e
--      punha ativo=true, sem olhar o próprio lote CEF: arrematado/vencido voltava à vitrine.
--      Agora só reativa lote CEF ainda VENDÁVEL: status 'disponivel' E praça própria não
--      passada (espelha a guarda de cef_reativar_lotes_do_csv).
-- A2 — "praça passou" lia só a 1ª praça (data_leilao), descartando a 2ª. Agora o `alvo` trata
--      o lote como vivo enquanto a ÚLTIMA praça não passou: data_leilao_2 quando conhecida,
--      senão a 1ª + 45 dias de folga (cobre o intervalo entre praças até a recoleta residencial
--      preencher data_leilao_2 — ver o conserto do parser em scripts/lib/hasta-parse.mjs).
-- A3 — count honesto: com a guarda de A1, o `rea` não reativa lote que o gatilho
--      zz_desativa_leilao_encerrado voltaria a desativar, então `reativados` deixa de inflar.
-- A5 — regex ancorado `(?![0-9])` (um id de 17+ dígitos não é mais truncado nos 16 primeiros,
--      o que casaria com o lote CEF errado) e `regexp_matches(...,'g')` captura TODOS os
--      "IMOVEL <id>" da descrição (lote multi-unidade não deixa mais o 2º gêmeo duplicado).
-- Idempotente.

create or replace function public.reconciliar_gemeos_hasta_cef()
returns jsonb language sql volatile security definer set search_path = public, pg_temp as $$
  with alvo as materialized (
    select distinct m[1] as caixa_id
      from public.imoveis_leilao h
      cross join lateral regexp_matches(coalesce(h.descricao,''), 'IMOVEL[[:space:]]+([0-9]{10,16})(?![0-9])', 'g') as m
     where h.fonte = 'HASTA' and h.ativo
       and (
         case
           when h.data_leilao_2 is not null then h.data_leilao_2 >= now()
           when h.data_leilao ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
             then substring(h.data_leilao, 1, 10)::date + 45 >= current_date
           else true   -- data ausente/estranha = trata como vivo (não reativa à toa)
         end
       )
  ),
  sup as (
    update public.imoveis_leilao c
       set ativo = false, suprimido_motivo = 'gemeo_hasta'
     where c.fonte in ('CEF','caixa') and c.ativo and c.suprimido_motivo is null
       and regexp_replace(c.fonte_id, '\D', '', 'g') in (select caixa_id from alvo where caixa_id is not null)
    returning 1
  ),
  rea as (
    update public.imoveis_leilao c
       set ativo = true, suprimido_motivo = null
     where c.fonte in ('CEF','caixa') and c.suprimido_motivo = 'gemeo_hasta'
       and regexp_replace(c.fonte_id, '\D', '', 'g') not in (select caixa_id from alvo where caixa_id is not null)
       -- A1: só volta à vitrine o gêmeo CEF ainda vendável (não ressuscita arrematado/vencido).
       and coalesce(c.status, 'disponivel') = 'disponivel'
       and (c.data_leilao is null
            or c.data_leilao !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            or substring(c.data_leilao, 1, 10)::date >= current_date)
    returning 1
  )
  select jsonb_build_object(
    'suprimidos',   (select count(*) from sup),
    'reativados',   (select count(*) from rea),
    'gemeos_vivos', (select count(distinct caixa_id) from alvo where caixa_id is not null),
    'em', now());
$$;
revoke all on function public.reconciliar_gemeos_hasta_cef() from public, anon, authenticated;
