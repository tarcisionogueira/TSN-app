-- 28/10: "APROX. 45 EQUIPAMENTOS RETORNADOS DAS LOJAS DE DIVERSAS MARCAS" (FRAZAO, 61 lotes ativos, tipo comercial) passava
-- como imóvel pelo "lojas" — a loja ali é de onde a MERCADORIA voltou, não o bem. A expressão sai do texto antes do teste.
-- Espelho de scripts/lib/scraper-core.mjs `ehForaDoAcervo` (RE_LOJA_DE_ORIGEM). Diff contra todo o acervo ativo em 28/10:
-- só esses 61 mudam (todos equipamentos); os 27 imóveis da FRAZAO continuam dentro.
create or replace function public.fora_do_acervo_imovel_veiculo(p_titulo text, p_descricao text)
 returns boolean language sql immutable set search_path to 'public', 'pg_temp'
as $function$
  with n as (select regexp_replace(coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,''),
                    '\y(retornad|devolvid|oriund|provenient|recolhid)\w*\s+d[ae]s?\s+lojas?\y', ' ', 'gi') as txt)
  select not (
       txt ~* '\y(im[óo]ve(l|is)|imobili[áa]ri[ao]s?|casas?|sobrados?|apartament\w*|apto(?:s(?!["'']))?(?![a-z])|flats?|kitnets?|studios?|coberturas?|terr+enos?|fra[çc](?:[ãa]o|[õo]es)\s+de\s+terras?|lotes?(?!\s*\d+\)|\s+de\s+(?!terrenos?\y|terras?\y))|loteament\w*|glebas?|ch[áa]caras?|s[íi]tios?|fazendas?|propriedade\s+rural|multipropriedade|galp(?:[ãa]o|[õo]es)s?|barrac(?:[ãa]o|[õo]es)s?|pr[ée]dios?|edif[íi]cios?|edifica[çc](?:[ãa]o|[õo]es)s?|hot(?:el|[ée]is)|posto\s+de\s+(combust[íi]vel|gasolina)|salas?\s*(?:comerciai?s?|n[ºo°.]|\d)|lojas?|com[eé]rcial|industrial|condom[íi]nios?|matr[íi]culas?|escrit[óo]rios?|boxe?s?\s*(?:de\s+garagem|n[ºo°.]?\s*\d|\d)|vagas?\s+de\s+garagem|metros?\s+quadrados|hectares?|alqueires?|alquires?|sucursal\s+banc[áa]ria|ag[êe]ncia\s+banc[áa]ria)|m²|m2\y|\d\s*ha\y|[áa]rea\s+(rural|de\s+terra)\y'
    or txt ~* '\y(ve[íi]culos?|autom[óo]ve(l|is)|caminh[õo]es|caminh[ãa]o|caminhonetes?|carretas?|reboques?|semirreboques?|[ôo]nibus|motocicletas?|motonetas?|tratores?|trator|colheitadeiras?|retroescavadeiras?|empilhadeiras?|chassi|chevrolet|volkswagen|vw|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citro[ëe]n|scania|iveco|volvo|mercedes|kia|mitsubishi|suzuki|yamaha|kawasaki|jeep)\y'
    or txt ~* '(19|20)\d{2}/(19|20)\d{2}'
  )
  from n;
$function$;

-- Os 61 equipamentos já gravados: desativados como os outros não-imóveis (UPDATE simples, sem DDL na mesma transação).
update public.imoveis_leilao set ativo = false, suprimido_motivo = 'nao_imovel'
 where fonte = 'FRAZAO' and ativo and public.fora_do_acervo_imovel_veiculo(titulo, descricao);
