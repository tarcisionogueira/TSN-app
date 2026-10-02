-- MARCA PARA BUSCA, CANÔNICA (02/10, dono: "ao consultar a marca não separar a abreviatura VW de
-- Volkswagen; veja também outros casos"). Medido no acervo ativo: VW 822 × VOLKSWAGEN 327, GM 236 ×
-- CHEVROLET 447, MERCEDES 208 × MERCEDES-BENZ 15, MMC 10 × MITSUBISHI 38, KIA MOTORS, CITROËN,
-- CAOACHERY/CAOA/CHERY, RE/ROYAL (Royal Enfield), 7YAMAHA — e 3.901 SEM marca (o título tem:
-- "VW/VOYAGE S", "YAMAHA/YZF R3", "M.BENZ BUSSCAR", "LR Freelander"). A busca fazia `marca ilike %x%`
-- OR `titulo ilike %x%`: "volk" não achava VW e "vw" não achava VOLKSWAGEN.
--
-- `marca` NÃO é alterada: regra de 24/09 (api/_fipe.js) — "dado inferido não pode se passar por dado da
-- fonte". A coluna nova `marca_busca` guarda a marca canônica da fonte ou, na falta, a INFERIDA do
-- título; serve só para buscar. Apelidos são DADO (tabela), não código: marca nova = um insert.
-- Front espelha os apelidos em src/lib/marcas.js (expansão do que o usuário digita).

create table if not exists public.marca_alias (
  alias     text primary key,           -- minúsculo, como aparece (vw, m.benz, kia motors)
  canonica  text not null,              -- MAIÚSCULO (VOLKSWAGEN)
  no_titulo boolean not null default true,  -- false = curto/ambíguo demais para achar solto no título
  eh_modelo boolean not null default false  -- MODELO inequívoco (gol, palio, evoque): só infere a marca do
                                            -- título; a busca do front NÃO expande por modelo
);
alter table public.marca_alias add column if not exists eh_modelo boolean not null default false;
alter table public.marca_alias enable row level security;
drop policy if exists marca_alias_le on public.marca_alias;
create policy marca_alias_le on public.marca_alias for select to anon, authenticated using (true);

insert into public.marca_alias (alias, canonica, no_titulo) values
  ('volkswagen','VOLKSWAGEN',true),('vw','VOLKSWAGEN',true),('volks','VOLKSWAGEN',true),('volkswagem','VOLKSWAGEN',true),('v.w','VOLKSWAGEN',true),
  ('chevrolet','CHEVROLET',true),('gm','CHEVROLET',true),('gmc','CHEVROLET',true),('chev','CHEVROLET',true),('chevy','CHEVROLET',true),('g.m','CHEVROLET',true),
  ('mercedes-benz','MERCEDES-BENZ',true),('mercedes benz','MERCEDES-BENZ',true),('mercedes','MERCEDES-BENZ',true),('m.benz','MERCEDES-BENZ',true),
  ('m. benz','MERCEDES-BENZ',true),('m benz','MERCEDES-BENZ',true),('mbenz','MERCEDES-BENZ',true),('mb','MERCEDES-BENZ',false),
  ('mitsubishi','MITSUBISHI',true),('mmc','MITSUBISHI',true),
  ('kia','KIA',true),('kia motors','KIA',true),
  ('citroen','CITROEN',true),('citroën','CITROEN',true),
  ('caoa chery','CAOA CHERY',true),('caoachery','CAOA CHERY',true),('caoa','CAOA CHERY',true),('chery','CAOA CHERY',true),
  ('royal enfield','ROYAL ENFIELD',true),('royal','ROYAL ENFIELD',false),('re','ROYAL ENFIELD',false),
  ('yamaha','YAMAHA',true),('7yamaha','YAMAHA',false),
  ('harley-davidson','HARLEY-DAVIDSON',true),('harley davidson','HARLEY-DAVIDSON',true),('harley','HARLEY-DAVIDSON',true),('h-d','HARLEY-DAVIDSON',false),
  ('land rover','LAND ROVER',true),('land-rover','LAND ROVER',true),('lr','LAND ROVER',false),
  ('renault','RENAULT',true),('renalt','RENAULT',true),
  ('jta','SUZUKI',false),('suzuki','SUZUKI',true),
  ('gwm','GWM',true),('great wall','GWM',true),('haval','GWM',true),
  ('fiat','FIAT',true),('ford','FORD',true),('honda','HONDA',true),('peugeot','PEUGEOT',true),('toyota','TOYOTA',true),
  ('hyundai','HYUNDAI',true),('nissan','NISSAN',true),('iveco','IVECO',true),('volvo','VOLVO',true),('scania','SCANIA',true),
  ('jeep','JEEP',true),('bmw','BMW',true),('audi','AUDI',true),('shineray','SHINERAY',true),('agrale','AGRALE',true),
  ('bajaj','BAJAJ',true),('byd','BYD',true),('dafra','DAFRA',true),('kawasaki','KAWASAKI',true),('ram','RAM',false),
  ('jac','JAC',false),('sundown','SUNDOWN',true),('triumph','TRIUMPH',true),('denza','DENZA',true),('mini','MINI',false),
  ('dodge','DODGE',true),('ktm','KTM',true),('randon','RANDON',true),('jaguar','JAGUAR',true),('omoda','OMODA',true),
  ('ducati','DUCATI',true),('ssangyong','SSANGYONG',true),('porsche','PORSCHE',true),('subaru','SUBARU',true),
  ('chrysler','CHRYSLER',true),('lifan','LIFAN',true),('effa','EFFA',true),('troller','TROLLER',true),('kasinski','KASINSKI',true),
  ('traxx','TRAXX',true),('haojue','HAOJUE',true),('marcopolo','MARCOPOLO',true),('volare','VOLARE',true),('facchini','FACCHINI',true),
  ('guerra','GUERRA',true),('recrusul','RECRUSUL',true),('sinotruk','SINOTRUK',true),('foton','FOTON',true),('jmc','JMC',true),
  ('lexus','LEXUS',true),('polaris','POLARIS',true),('brp','BRP',true),('can-am','BRP',true)
on conflict (alias) do update set canonica = excluded.canonica, no_titulo = excluded.no_titulo;

-- Modelos inequívocos: "Gol Special - 01/01", "I/LR Evoque" (título sem a marca).
insert into public.marca_alias (alias, canonica, no_titulo, eh_modelo) values
 ('gol','VOLKSWAGEN',true,true),('saveiro','VOLKSWAGEN',true,true),('voyage','VOLKSWAGEN',true,true),('kombi','VOLKSWAGEN',true,true),('amarok','VOLKSWAGEN',true,true),('fusca','VOLKSWAGEN',true,true),
 ('palio','FIAT',true,true),('strada','FIAT',true,true),('siena','FIAT',true,true),('fiorino','FIAT',true,true),('toro','FIAT',false,true),
 ('celta','CHEVROLET',true,true),('onix','CHEVROLET',true,true),('corsa','CHEVROLET',true,true),('prisma','CHEVROLET',true,true),('montana','CHEVROLET',true,true),
 ('fiesta','FORD',true,true),('ranger','FORD',true,true),('ecosport','FORD',true,true),
 ('hilux','TOYOTA',true,true),('corolla','TOYOTA',true,true),('etios','TOYOTA',true,true),
 ('civic','HONDA',true,true),
 ('sandero','RENAULT',true,true),('logan','RENAULT',true,true),('duster','RENAULT',true,true),('kwid','RENAULT',true,true),('oroch','RENAULT',true,true),
 ('hb20','HYUNDAI',true,true),('tucson','HYUNDAI',true,true),('creta','HYUNDAI',true,true),
 ('compass','JEEP',true,true),('renegade','JEEP',true,true),
 ('evoque','LAND ROVER',true,true),('freelander','LAND ROVER',true,true),('defender','LAND ROVER',true,true),('discovery','LAND ROVER',true,true),
 ('pajero','MITSUBISHI',true,true),('l200','MITSUBISHI',true,true),('outlander','MITSUBISHI',true,true)
on conflict (alias) do update set canonica=excluded.canonica, no_titulo=excluded.no_titulo, eh_modelo=excluded.eh_modelo;

-- Marca da FONTE → canônica. Tira o prefixo de importado ("I/", "IMP/", "IMP."). Desconhecida fica como
-- veio (maiúscula): não inventa.
create or replace function public.marca_canonica(p text)
returns text language sql stable set search_path to 'public' as $$
  with v as (select lower(btrim(regexp_replace(coalesce(p, ''), '^\s*(i|imp\.?)\s*[/ ]\s*', '', 'i'))) m)
  select case when (select m from v) = '' then null
         else coalesce((select a.canonica from marca_alias a where a.alias = (select m from v)), upper((select m from v))) end;
$$;

-- Marca INFERIDA do título: MARCA antes de modelo; entre elas, a que aparece PRIMEIRO, como palavra
-- inteira (à esquerda aceita dígito colado: "Repasse2520Fiat", "Aguardando240VW/GOL" — prefixo de
-- fonte). Apelido curto/ambíguo (no_titulo=false: re, mb, ram, lr…) só vale colado antes de "/".
create or replace function public.marca_do_titulo(t text)
returns text language sql stable set search_path to 'public' as $$
  select a.canonica
    from marca_alias a
    cross join lateral (select ' ' || upper(coalesce(t, '')) || ' ' as tt) x
    cross join lateral (select regexp_replace(upper(a.alias), '([.\-])', '\\\1', 'g') as pat) e
    cross join lateral (select regexp_instr(x.tt,
             '[^A-ZÀ-Ú]' || e.pat || (case when a.no_titulo then '[^A-Z0-9À-Ú]' else '\s*/' end)) as pos) p
   where p.pos > 0
   order by a.eh_modelo, p.pos, length(a.alias) desc
   limit 1;
$$;

alter table public.veiculos_leilao add column if not exists marca_busca text;
create index if not exists veiculos_leilao_marca_busca_idx on public.veiculos_leilao (marca_busca) where ativo;

create or replace function public.trg_marca_busca()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  new.marca_busca := coalesce(marca_canonica(new.marca), marca_do_titulo(new.titulo));
  return new;
end $$;
drop trigger if exists marca_busca on public.veiculos_leilao;
create trigger marca_busca before insert or update of marca, titulo on public.veiculos_leilao
  for each row execute function public.trg_marca_busca();

-- Acervo atual (só ativos e recentes; o gatilho cuida do resto conforme as linhas forem tocadas).
-- Aplicado 02/10 em lotes: 11.886 ativos → 11.375 com marca; os 511 restantes são equipamento/peça.
update public.veiculos_leilao
   set marca_busca = coalesce(marca_canonica(marca), marca_do_titulo(titulo))
 where ativo or criado_em > now() - interval '60 days';
