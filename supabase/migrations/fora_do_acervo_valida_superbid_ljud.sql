-- 20/09: validação explícita do classificador contra SUPERBID e LJUD (pedido do dono, "valida
-- o classificador contra SUPERBID e LJUD antes de ampliar") — 33 candidatos revisados um a um,
-- depois diff COMPLETO deste SQL contra o espelho em JS (scripts/lib/scraper-core.mjs) sobre as
-- 2.396 linhas ativas das duas fontes (não só os 33). 0 divergências no diff final.
--
-- Achados desta rodada (todos espelham o fix já aplicado em scraper-core.mjs, mesmo commit):
--   - régua ganhou termos novos vistos em SUPERBID/LJUD: imobiliário, lote refinado (sem
--     reabrir "lote de gado"), box/sala com contexto de número, edificação, hotel, barracão,
--     propriedade rural, multipropriedade, posto de combustível/gasolina, hectares/ha.
--   - bug de BACKTRACKING em `aptos?(?!["'])`: deixava passar "Apto" (4 letras) como falso-
--     positivo de `font-family:"Aptos",sans-serif` (CSS colado no HTML pelo Word). Corrigido
--     tornando o "s" opcional condicional ao próprio lookahead: `apto(?:s(?!["']))?(?![a-z])`.
--   - duas fronteiras ESPÚRIAS introduzidas ao portar pro SQL nesta mesma rodada (achadas
--     comparando resultado SQL × JS sobre os mesmos candidatos): (a) `\y` de FECHAMENTO no fim
--     do grande grupo de alternativas — o JS nunca teve isso, e ele quebrava toda alternativa
--     que termina casando um dígito cru seguido de mais dígitos ("Box 306" só casava o "3", sem
--     fronteira até o "0"); (b) `\y` de ABERTURA em `m2` — número colado tipo "1.900,00m2" tem
--     dígito logo antes do "m", nunca é fronteira ali.
--   - bug de fronteira ASCII-only do PRÓPRIO JS (não do SQL — o SQL sempre acertou este caso):
--     `\b` do Javascript só reconhece `[A-Za-z0-9_]` como `\w`, SEMPRE (com ou sem a flag `/u`,
--     testado isoladamente) — a fronteira de abertura do grupo grande nunca batia quando o
--     trecho casado começaria em cima do "Á" acentuado logo após início/espaço ("Área Rural -
--     Colonia Murici SJP" sem mais nenhum sinal no título). Corrigido puxando "área rural"/
--     "área de terra" pra fora do grupo `\b`-compartilhado, mesmo padrão já usado pra m²/ha.
--
-- Único achado real de contaminação confirmada em SUPERBID/LJUD nesta rodada: "Bens móveis em
-- geral: betoneira, gerador, portas, cadeiras e outros" (limpeza retroativa na migração
-- qa_invariante_amplia_superbid_ljud.sql, mesmo commit). Os outros 6 candidatos restantes
-- ("Outros - <endereço>" ×3, "Direito - 01 Vaga...", "Área em Luz/MG.", "4ª Vara Cível...") são
-- ambíguos por FALTA de sinal — mesma classe que já deixa "Jazigo" de fora — não são bug do
-- classificador, e ficam de fora da limpeza retroativa de propósito.
CREATE OR REPLACE FUNCTION public.fora_do_acervo_imovel_veiculo(p_titulo text, p_descricao text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with n as (select coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as txt)
  select not (
       txt ~* '\y(im[óo]ve(l|is)|imobili[áa]ri[ao]s?|casas?|sobrados?|apartament\w*|apto(?:s(?!["'']))?(?![a-z])|flats?|kitnets?|studios?|coberturas?|terrenos?|lotes?(?!\s*\d+\)|\s+de\s+(?!terrenos?\y|terras?\y))|loteament\w*|glebas?|ch[áa]caras?|s[íi]tios?|fazendas?|propriedade\s+rural|multipropriedade|galp(?:[ãa]o|[õo]es)s?|barrac(?:[ãa]o|[õo]es)s?|pr[ée]dios?|edif[íi]cios?|edifica[çc](?:[ãa]o|[õo]es)s?|hot(?:el|[ée]is)|posto\s+de\s+(combust[íi]vel|gasolina)|salas?\s*(?:comerciai?s?|n[ºo°.]|\d)|lojas?|com[eé]rcial|industrial|condom[íi]nios?|matr[íi]culas?|escrit[óo]rios?|boxe?s?\s*(?:de\s+garagem|n[ºo°.]?\s*\d|\d)|vaga\s+de\s+garagem|metros?\s+quadrados|hectares?)|m²|m2\y|\d\s*ha\y|[áa]rea\s+(rural|de\s+terra)\y'
    or txt ~* '\y(ve[íi]culos?|autom[óo]ve(l|is)|caminh[õo]es|caminh[ãa]o|caminhonetes?|carretas?|reboques?|semirreboques?|[ôo]nibus|motocicletas?|motonetas?|tratores?|trator|colheitadeiras?|retroescavadeiras?|empilhadeiras?|chassi|chevrolet|volkswagen|vw|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citro[ëe]n|scania|iveco|volvo|mercedes|kia|mitsubishi|suzuki|yamaha|kawasaki|jeep)\y'
    or txt ~* '(19|20)\d{2}/(19|20)\d{2}'
  )
  from n;
$function$;
