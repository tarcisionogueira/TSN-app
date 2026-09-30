-- 30/09: invariante `tipo_casa_titulo_lote` com 24 lotes ("Lote, Residencial, Moreira Sales",
-- "TERRENO COM 926 m² NO RESIDENCIAL…") gravados como CASA — "Residencial" é o zoneamento/nome do
-- loteamento, não uma casa, e o mercadológico comparava lote vazio com casas. Vinha de vários
-- coletores (CALIL/VEGAS no SOLEON, LANCEJA, PURCENA, SUPERBID), por isso a regra mora no banco,
-- com a MESMA condição do invariante: título começa com lote/terreno, nenhuma edificação no texto
-- e tipo_construido_pelo_titulo() não reconhece construção.
create or replace function public.trg_tipo_lote_sem_construcao() returns trigger
language plpgsql set search_path = public as $f$
begin
  if new.tipo = 'casa' and coalesce(new.titulo, '') ~* '^\s*(lote|terreno)\M'
     and coalesce(new.titulo, '') || ' ' || coalesce(new.descricao, '') !~* '(casa|sobrado|\mresid[eê]ncias?\M|[aá]rea constru[ií]da|edifica[cç][aã]o|edificad|benfeitoria|pr[eé]dios?|barrac[aã]o|galp[aã]o)'
     and public.tipo_construido_pelo_titulo(new.titulo) is null then
    new.tipo := 'terreno';
  end if;
  return new;
end $f$;

drop trigger if exists trg_tipo_lote_sem_construcao on public.imoveis_leilao;
create trigger trg_tipo_lote_sem_construcao before insert or update of tipo, titulo, descricao
  on public.imoveis_leilao for each row execute function public.trg_tipo_lote_sem_construcao();

update public.imoveis_leilao set tipo = 'terreno'
 where ativo and tipo = 'casa' and titulo ~* '^\s*(lote|terreno)\M'
   and coalesce(titulo,'') || ' ' || coalesce(descricao,'') !~* '(casa|sobrado|\mresid[eê]ncias?\M|[aá]rea constru[ií]da|edifica[cç][aã]o|edificad|benfeitoria|pr[eé]dios?|barrac[aã]o|galp[aã]o)'
   and public.tipo_construido_pelo_titulo(titulo) is null;
