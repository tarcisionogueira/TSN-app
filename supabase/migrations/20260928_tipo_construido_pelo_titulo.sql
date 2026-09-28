-- 28/09 — TERRENO COM CONSTRUÇÃO NO TÍTULO: casa/comercial gravado como terreno.
--
-- Achado ao fechar o caso Embu/Araraquara (o erro inverso: terreno virando casa): 128 lotes ATIVOS
-- gravados como `terreno` com o título dizendo o contrário — "Casa c/ 200m² - Terreno c/ 746m²"
-- (LJUD), "Terreno de 288m² | Constr. de 277m²" (SUBLIME), "PRÉDIO COMERCIAL COM 2.289 M² DE ÁREA
-- CONSTRUÍDA" (FERREIRALEIL), "Galpão - Vale Real" (PESTANA). O mercadológico compara com TERRENOS
-- e o preço da construção some do laudo. Vinham de vários coletores — a categoria do site, ou o
-- primeiro termo do título ("Terreno ...") — então a correção é UMA, no banco, e vale para todos.
--
-- Direção única e deliberada: só TIRA de `terreno`. O inverso (casa → terreno por nome de
-- loteamento, "Parque Residencial") foi corrigido nos classificadores JS e é vigiado pelo invariante
-- tipo_casa_titulo_lote. Só o TÍTULO decide: a descrição traz zoneamento, confrontações e
-- propaganda ("ideal para residência") e erra demais.
create or replace function public.tipo_construido_pelo_titulo(t text) returns text
language sql immutable set search_path = public as $f$
 select case
  when t is null
    or t ~* '(rural|fazenda|s[ií]tio|ch[aá]cara|\mapart|\mapto\M|\msem\s+(casa|benfeitoria|constru|edifica))' then null
  when t ~* '(\m(pr[eé]dio|im[oó]vel|edifica[cç][aã]o|constru[cç][aã]o)\s+(comercial|misto|industrial)|\mgalp[aã]o|\mbarrac[aã]o|(conjunto|complexo)\s+industrial|\mlojas?\M|\msalas?\s+comercia|\mpr[eé]dios?\M(?!\s+residenc))' then 'comercial'
  when t ~* '(\mcasas?\M|\msobrados?\M|\mresid[eê]ncias?\M|(benfeitorias?|pr[eé]dios?|constru[cç][aã]o|im[oó]vel)\s+residenc|\mconstr\.?\s+de\s+\d|[aá]rea constru[ií]da|edifica[cç][aã]o|edificad|\mmans[aã]o)'
    and t !~* '(residencial\s+casa|para\s+resid[eê]ncia)' then 'casa'
 end $f$;

create or replace function public.trg_tipo_construido_pelo_titulo() returns trigger
language plpgsql set search_path = public as $f$
declare novo text;
begin
  if new.tipo = 'terreno' then
    novo := public.tipo_construido_pelo_titulo(new.titulo);
    if novo is not null then new.tipo := novo; end if;
  end if;
  return new;
end $f$;

drop trigger if exists trg_tipo_construido_pelo_titulo on public.imoveis_leilao;
create trigger trg_tipo_construido_pelo_titulo before insert or update of tipo, titulo
  on public.imoveis_leilao for each row execute function public.trg_tipo_construido_pelo_titulo();

-- Acervo: o trigger dispara em UPDATE OF tipo — reescrever o próprio valor já corrige.
update public.imoveis_leilao set tipo = tipo
 where ativo and tipo = 'terreno' and public.tipo_construido_pelo_titulo(titulo) is not null;

-- Invariante: 0 enquanto o trigger existir. Se subir, o trigger foi removido ou contornado.
do $mig$
declare d text; ancora text := E'  )\n  select chave, titulo, categoria, gravidade, valor::bigint, limite::bigint,';
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position('tipo_terreno_com_construcao' in d) > 0 then return; end if;
  if position(ancora in d) = 0 then raise exception 'qa_invariantes: âncora não encontrada'; end if;
  execute replace(d, ancora, $ins$,
     ('tipo_terreno_com_construcao','Captura: lote com casa/prédio/galpão no TÍTULO gravado como terreno — mercadológico ignora a construção (trigger trg_tipo_construido_pelo_titulo sumiu?)','Captura','bug',
       (select count(*) from imoveis_leilao where ativo and tipo = 'terreno' and public.tipo_construido_pelo_titulo(titulo) is not null), 0)
$ins$ || ancora);
end $mig$;

-- Os dois invariantes de tipo têm que concordar sobre o que é construção: o de casa passa a
-- delegar à MESMA função (acusou 2 "Terreno | Constr. de 256m²" que o trigger tinha acertado).
do $mig$
declare d text; velho text := $v$edificad|benfeitoria|pr[eé]dios?|barrac[aã]o|galp[aã]o)'$v$;
begin
  d := pg_get_functiondef('public.qa_invariantes'::regproc);
  if position(velho in d) = 0 then return; end if;
  execute replace(d, velho, velho || ' and public.tipo_construido_pelo_titulo(titulo) is null');
end $mig$;
