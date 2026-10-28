-- #375 (28/10): ÁREA NA ESCALA ERRADA (×10, ×100, ×1000 ou o inverso) — leitura de decimal com ponto/vírgula.
-- "195.66 m2" virava 19.566 m² (SUPERBID, 127 ativos: o leitor apagava todo ponto), "Apto 47,835m²" virava 47.835
-- (PICELLI, atributo da API em formato americano), fazendas da MERCADOLEIL 1.000× maiores, "Área 127,18m²" gravada 12,71.
-- O R$/m² e o relatório saíam distorcidos na mesma escala.
--
-- Rede de segurança (como local_do_texto): o TÍTULO é a prova independente. Só corrige quando a área gravada NÃO bate com
-- nenhuma metragem escrita no título E bate, a menos de 1%, com uma delas × 10ⁿ (n = ±1, ±2, ±3). "Casa 98m² com terreno
-- 320m²" não dispara (nenhuma razão é potência de 10); "Cobertura 242,98m² – Box 24m²" com 242,98 gravado não dispara
-- (bate com o título). Gravada MAIOR: divide a gravada (guarda as casas que o título arredonda: "Apto 60m²" 6.018 → 60,18);
-- gravada MENOR: vale a do título (a gravada perdeu dígitos). Medido em 28/10: 124 ativos (SUPERBID 114, MERCADOLEIL 5,
-- BARRETO, HASTAPUBLICA, INOVALEILAO, LEILOTECH, PICELLI 1 cada), todos conferidos.
create or replace function public.numero_area(p text) returns numeric language plpgsql immutable
as $$
declare s text := regexp_replace(coalesce(p, ''), '[^\d.,]', '', 'g');
begin
  -- mesma regra de api/_texto-imovel.js `numeroArea`: ponto é milhar só em grupo EXATO de 3 dígitos ou com vírgula
  if s = '' then return 0; end if;
  if s ~ '^\d{1,3}(\.\d{3})+\.\d{1,2}$' then return regexp_replace(s, '\.(?=\d{3}\.)', '', 'g')::numeric; end if;
  if s ~ ',' then return nullif(replace(replace(s, '.', ''), ',', '.'), '')::numeric; end if;
  if s ~ '^\d{1,3}(\.\d{3})+$' then return replace(s, '.', '')::numeric; end if;
  if s ~ '^\d+(\.\d+)?$' then return s::numeric; end if;
  return 0;
exception when others then return 0;
end $$;

create or replace function public.area_na_escala_do_titulo(p_titulo text, p_area numeric) returns numeric
 language sql immutable set search_path to 'public'
as $$
  with at as (select public.numero_area(m[1]) a from regexp_matches(coalesce(p_titulo, ''), '(\d[\d.,]*)\s*m[²2]', 'gi') m),
  hit as (
    select a, f from at, unnest(array[0.001, 0.01, 0.1, 10, 100, 1000]::numeric[]) f
     where a >= 8 and p_area > 0 and abs(p_area / (a * f) - 1) < 0.01
     order by abs(p_area / (a * f) - 1) limit 1)
  select case
    when p_area is null or p_area <= 0 then p_area
    when exists (select 1 from at where a > 0 and abs(p_area / a - 1) < 0.02) then p_area  -- já bate com o título
    when (select f from hit) > 1 then round(p_area / (select f from hit), 4)
    when (select f from hit) < 1 then (select a from hit)
    else p_area end
$$;

create or replace function public.trg_area_escala_titulo()
 returns trigger language plpgsql set search_path to 'public'
as $function$
begin
  new.area_m2 := public.area_na_escala_do_titulo(new.titulo, new.area_m2);
  return new;
end $function$;

-- `trg_zx_` roda depois de trg_preservar_area_e_avaliacao / trg_area_urbana_preserva (que decidem QUAL área fica) e antes
-- dos que usam a área.
drop trigger if exists trg_zx_area_escala_titulo on public.imoveis_leilao;
create trigger trg_zx_area_escala_titulo before insert or update of area_m2, titulo on public.imoveis_leilao
  for each row when (new.area_m2 > 0 and new.titulo ~* '\d\s*m[²2]')
  execute function public.trg_area_escala_titulo();

-- Backfill com backup. Os gatilhos de preservação de área desligados só aqui: eles podem recusar BAIXAR uma área
-- "plausível" — e 19.566 m² numa casa passava por plausível.
create table if not exists public._bkp_area_escala_20261028 as
  select id, fonte, fonte_id, titulo, area_m2 from public.imoveis_leilao
   where area_m2 > 0 and titulo ~* '\d\s*m[²2]' and public.area_na_escala_do_titulo(titulo, area_m2) is distinct from area_m2;
alter table public._bkp_area_escala_20261028 enable row level security;

set local session_replication_role = replica;
update public.imoveis_leilao i set area_m2 = public.area_na_escala_do_titulo(i.titulo, i.area_m2)
  from public._bkp_area_escala_20261028 b where b.id = i.id;
set local session_replication_role = origin;
-- 2º passo com os gatilhos ligados (score/viabilidade recalculados sobre a área certa).
update public.imoveis_leilao i set atualizado_em = i.atualizado_em from public._bkp_area_escala_20261028 b where b.id = i.id;
