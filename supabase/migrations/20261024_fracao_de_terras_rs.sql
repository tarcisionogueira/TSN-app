-- "FRAÇÃO DE TERRAS" (RS) e "TERRRENO" são imóvel (24/10, dono: "corrija a fração de terras do RS").
-- Espelho de ehForaDoAcervo() em scripts/lib/scraper-core.mjs: no RS a gleba inteira vem titulada "FRAÇÃO DE
-- TERRAS" e caía como "nem imóvel nem veículo". Fração IDEAL continua barrada por fracao_ideal_barrada().
create or replace function public.fora_do_acervo_imovel_veiculo(p_titulo text, p_descricao text)
 returns boolean
 language sql
 immutable
 set search_path to 'public', 'pg_temp'
as $function$
  with n as (select coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as txt)
  select not (
       txt ~* '\y(im[óo]ve(l|is)|imobili[áa]ri[ao]s?|casas?|sobrados?|apartament\w*|apto(?:s(?!["'']))?(?![a-z])|flats?|kitnets?|studios?|coberturas?|terr+enos?|fra[çc](?:[ãa]o|[õo]es)\s+de\s+terras?|lotes?(?!\s*\d+\)|\s+de\s+(?!terrenos?\y|terras?\y))|loteament\w*|glebas?|ch[áa]caras?|s[íi]tios?|fazendas?|propriedade\s+rural|multipropriedade|galp(?:[ãa]o|[õo]es)s?|barrac(?:[ãa]o|[õo]es)s?|pr[ée]dios?|edif[íi]cios?|edifica[çc](?:[ãa]o|[õo]es)s?|hot(?:el|[ée]is)|posto\s+de\s+(combust[íi]vel|gasolina)|salas?\s*(?:comerciai?s?|n[ºo°.]|\d)|lojas?|com[eé]rcial|industrial|condom[íi]nios?|matr[íi]culas?|escrit[óo]rios?|boxe?s?\s*(?:de\s+garagem|n[ºo°.]?\s*\d|\d)|vagas?\s+de\s+garagem|metros?\s+quadrados|hectares?|alqueires?|alquires?|sucursal\s+banc[áa]ria|ag[êe]ncia\s+banc[áa]ria)|m²|m2\y|\d\s*ha\y|[áa]rea\s+(rural|de\s+terra)\y'
    or txt ~* '\y(ve[íi]culos?|autom[óo]ve(l|is)|caminh[õo]es|caminh[ãa]o|caminhonetes?|carretas?|reboques?|semirreboques?|[ôo]nibus|motocicletas?|motonetas?|tratores?|trator|colheitadeiras?|retroescavadeiras?|empilhadeiras?|chassi|chevrolet|volkswagen|vw|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citro[ëe]n|scania|iveco|volvo|mercedes|kia|mitsubishi|suzuki|yamaha|kawasaki|jeep)\y'
    or txt ~* '(19|20)\d{2}/(19|20)\d{2}'
  )
  from n;
$function$;
