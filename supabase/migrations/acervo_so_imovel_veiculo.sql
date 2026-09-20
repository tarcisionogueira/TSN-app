-- 20/09: achado real (screenshot do dono) — "Fresas topo OSG 4c 18mm" (uma fresa de usinagem)
-- publicada como imóvel `tipo:'terreno'`, fonte LEILAOBRASIL. Causa: leiloeiro judicial
-- multi-bem vende o imóvel da empresa falida JUNTO com maquinário, ferramentas, gado,
-- eletrônicos, cotas sociais — tudo na mesma vitrine — e o parser (leilaobrasil-parse.mjs, via
-- scraper-core.mjs/checarQualidade) não tinha filtro nenhum: o classificador de TIPO sempre
-- devolve alguma coisa (nunca "recusa"), então tudo virava lote.
--
-- Corrigido na ingestão em scripts/lib/scraper-core.mjs (`ehForaDoAcervo`, LISTA PERMITIDA —
-- não proibida, mesma lição já aprendida em nordeste-parse.mjs: "uma lista de palavras
-- PROIBIDAS vira caça ao gambá"). Esta função ESPELHA aquela em SQL — mudou a régua lá, mude
-- aqui — para (a) limpar o acervo já contaminado e (b) dar ao qa_invariantes() um jeito de
-- pegar regressão futura sem depender de screenshot do dono.
CREATE OR REPLACE FUNCTION public.fora_do_acervo_imovel_veiculo(p_titulo text, p_descricao text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  with n as (select coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as txt)
  select not (
       txt ~* '\y(im[óo]ve(l|is)|casas?|sobrados?|apartament\w*|flats?|kitnets?|studios?|coberturas?|terrenos?|loteament\w*|glebas?|ch[áa]caras?|s[íi]tios?|fazendas?|[áa]rea\s+rural|galp[õo][ãe]s?|pr[ée]dios?|edif[íi]cios?|sala\s+comercial|lojas?|com[eé]rcial|industrial|condom[íi]nios?|matr[íi]culas?|escrit[óo]rios?|box\s+de\s+garagem|vaga\s+de\s+garagem|m[²2]|metros?\s+quadrados)\y'
    or txt ~* '\y(ve[íi]culos?|autom[óo]ve(l|is)|caminh[õo]es|caminh[ãa]o|caminhonetes?|carretas?|reboques?|semirreboques?|[ôo]nibus|motocicletas?|motonetas?|tratores?|trator|colheitadeiras?|retroescavadeiras?|empilhadeiras?|chassi|chevrolet|volkswagen|vw|fiat|ford|renault|toyota|honda|hyundai|nissan|peugeot|citro[ëe]n|scania|iveco|volvo|mercedes|kia|mitsubishi|suzuki|yamaha|kawasaki|jeep)\y'
    or txt ~* '(19|20)\d{2}/(19|20)\d{2}'
  )
  from n;
$function$;

-- Limpeza retroativa: 23 LEILAOBRASIL + 3 LUTHERO (medido 20/09, ativos antes desta migração).
update public.imoveis_leilao
   set ativo = false
 where ativo
   and fonte in ('LEILAOBRASIL','LUTHERO')
   and public.fora_do_acervo_imovel_veiculo(titulo, descricao);
