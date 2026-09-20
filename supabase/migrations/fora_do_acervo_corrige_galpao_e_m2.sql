-- 20/09: dois bugs achados testando `fora_do_acervo_imovel_veiculo()` contra OUTRAS fontes
-- (BIASI/ZUK/WEBLEILOES/LEFFA) antes de sequer cogitar ampliar o escopo do invariante além de
-- LEILAOBRASIL/LUTHERO — os dois já existiam desde a 1ª versão, só não tinham aparecido porque
-- as 26 linhas já limpas em LEILAOBRASIL/LUTHERO tinham outro termo na descrição que mascarava
-- o defeito:
--   1) `galp[õo][ãe]s?` nunca batia "Galpão" singular — a vogal do singular ("galpÃo") e do
--      plural ("galpÕes") trocam de posição, não é variação de acento; precisa de ramo próprio
--      pra cada forma.
--   2) `\bm[²2]\b` nunca batia área colada sem espaço tipo "1.575,00M²" — nem depois de tirar a
--      fronteira de abertura (dígito-a-'m' não é fronteira de palavra) a de FECHAMENTO passava:
--      '²' não é caractere de palavra pro motor de regex, então não há transição depois dele.
-- Espelha o fix já aplicado em scripts/lib/scraper-core.mjs (mesmo commit).
CREATE OR REPLACE FUNCTION public.fora_do_acervo_imovel_veiculo(p_titulo text, p_descricao text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with n as (select coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as txt)
  select not (
       txt ~* '\y(im[óo]ve(l|is)|casas?|sobrados?|apartament\w*|flats?|kitnets?|studios?|coberturas?|terrenos?|loteament\w*|glebas?|ch[áa]caras?|s[íi]tios?|fazendas?|[áa]rea\s+(rural|de\s+terra)|galp(?:[ãa]o|[õo]es)s?|pr[ée]dios?|edif[íi]cios?|sala\s+comercial|lojas?|com[eé]rcial|industrial|condom[íi]nios?|matr[íi]culas?|escrit[óo]rios?|box\s+de\s+garagem|vaga\s+de\s+garagem|metros?\s+quadrados)\y'
    or txt ~* 'm²|\ym2\y'
    or txt ~* '\y(ve[íi]culos?|autom[óo]ve(l|is)|caminh[õo]es|caminh[ãa]o|caminhonetes?|carretas?|reboques?|semirreboques?|[ôo]nibus|motocicletas?|motonetas?|tratores?|trator|colheitadeiras?|retroescavadeiras?|empilhadeiras?|chassi|chevrolet|volkswagen|vw|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citro[ëe]n|scania|iveco|volvo|mercedes|kia|mitsubishi|suzuki|yamaha|kawasaki|jeep)\y'
    or txt ~* '(19|20)\d{2}/(19|20)\d{2}'
  )
  from n;
$function$;
