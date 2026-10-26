-- 26/10: área impossível regravada pela coleta. O lote de Feira de Santana (comercial, terreno
-- 11 × 25 m) chega do LJUD com 18.500.000 m²; 18 dos 30 urbanos acima de 10 ha foram recoletados
-- no mesmo dia, ou seja, qualquer correção (backfill de 16:30, ajuste manual) seria desfeita na
-- próxima rodada do coletor. Cada coletor tem o seu parser de área, então a trava fica no banco:
-- apartamento/casa/comercial acima de 10 ha NUNCA substitui uma área plausível já gravada.
-- Não apaga nada nem inventa: se não havia valor plausível antes, o novo passa como veio.
create or replace function public.trg_area_urbana_preserva()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.tipo in ('apartamento', 'casa', 'comercial') and new.area_m2 > 100000
     and old.area_m2 > 0 and old.area_m2 <= 100000 then
    new.area_m2 := old.area_m2;
  end if;
  return new;
end
$function$;

create or replace trigger trg_area_urbana_preserva
  before update of area_m2 on public.imoveis_leilao
  for each row execute function public.trg_area_urbana_preserva();
