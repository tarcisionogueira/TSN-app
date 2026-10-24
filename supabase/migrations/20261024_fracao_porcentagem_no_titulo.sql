-- 24/10 (decisão do dono: "descarte fração parcial de imóvel e vagas de garagem"). Espelho de
-- RE_PCT_DO_BEM_TITULO em scripts/lib/scraper-core.mjs: porcentagem do bem no TÍTULO ("20% do imóvel",
-- "50% de Um Apartamento", "COTA PARTE DE 5% DA CASA") é venda de fatia. 1–2 dígitos (100% não é fatia);
-- só no título. Medido em 24/10: 15 ativos casam, todos fatia. Vaga de garagem já era barrada (fora_do_acervo).
create or replace function public.fracao_ideal_barrada(p_titulo text, p_descricao text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  with t as (select
    regexp_replace(regexp_replace(regexp_replace(coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,''),
      'fundos?\s+de\s+investimentos?\s+em\s+direitos\s+credit[óo]rios(\s+n[ãa]o[\s-]padronizados?)?', ' ', 'gi'),
      '(respectiv[ao]s?|correspondentes?)\s+fra[çc](ão|ao|ões|oes)\s+idea(l|is)', ' fração ideal do terreno ', 'gi'),
      'fra[çc](ões|oes)\s+ideais\s+(de\s+)?([0-9])', 'fração ideal de \3', 'gi') as txt)
  select
    coalesce(p_titulo,'') ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    or coalesce(p_titulo,'') ~* '(^|[^0-9/])[0-9]{1,3}\s*/\s*[0-9]{1,3}\s*(\([^)]{0,20}\)\s*)?(avos\s+)?(d[oa]s?|de(\s+uma?)?|sobre\s+[oa])\s+(im[oó]vel|bem|pr[eé]dio|casa|apartamento|lote)\M'
    or coalesce(p_titulo,'') ~* '(^|[^0-9,.])[0-9]{1,2}([.,][0-9]+)?\s*%\s*(\([^)]{0,20}\)\s*)?(d[oa]s?|de(\s+uma?)?|sobre\s+[oa])\s+(im[oó]ve(l|is)|bem|pr[eé]dio|casa|apartamento|lote|terreno|gleba|fazenda|s[íi]tio|ch[áa]cara|sala|loja|galp)'
    or (select txt from t) ~* '(parte\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+(de\s+)?[0-9][0-9.,/]*\s*%?\s*(sobre|d[oa])[\])]?\s+(o\s+|a\s+|um\s+|uma\s+)?(im[óo]ve(l|is)|casa|bem|bens|sorte|gleba|fazenda|s[íi]tio|ch[áa]cara|pr[ée]dio|terra|[áa]rea\s+rural)'
    or (select txt from t) ~* '[0-9][0-9.,]*\s*%\s+d[ao]s?\s+(cota|fra[çc][ãa]o)\s+ideal'
    or (
      (select txt from t) ~* 'fra[çc][ãa]o\s+ideal'
      and not (
        (
          (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+de\s+[0-9][0-9./,]*\s*%?\s*(no|do|na|da|nas|das|em|sobre)\s+(o\s+|a\s+|os\s+|as\s+)?([áa]rea|terreno|solo)'
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+(de\s+|do\s+|no\s+|na\s+|em\s+|sobre\s+)?(o\s+|a\s+)?(terreno|solo|[áa]rea\s+comum)\s*(condominial\s*)?(e\s+[^,;.]{0,40})?\s*(de\s+|em\s+)?[0-9]'
          or (select txt from t) ~* '(no|do|ao)\s+(terreno|solo)\s+(uma\s+|a\s+)?fra[çc][ãa]o\s+ideal\s+de\s+[0-9]'
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal[^.;]{0,60}?\m(terreno|solo|[áa]rea\s+comum|dom[íi]nio\s+[úu]til)'
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s*(\([^)]{0,20}\))?\s*:?\s*(de\s+)?[0-9]'
          or (select txt from t) ~* '[0-9][0-9.,]*\s*%\s+de\s+fra[çc][ãa]o\s+ideal'
          or (select txt from t) ~* '(terreno|privativa)\s*/?\s*\(?\s*fra[çc][ãa]o\s+ideal'
          or (select txt from t) ~* 'terreno\s*:?\s*[0-9][0-9.,]*\s*m[²2]\s*\(\s*fra[çc][ãa]o\s+ideal\s*\)'
        )
        and (select txt from t) ~* '(condom[íi]nio|[áa]rea\s+privativa|[áa]rea\s+[úu]til|[áa]rea\s+real|unidade\s+aut[ôo]noma|coisas\s+comuns|[áa]reas\s+comuns|coisas\s+de\s+uso\s+comum|apartamento|\mcasa\M|sobrado|\mloja\M|[áa]rea\s+(total\s+)?constru[íi]da|[áa]rea\s+edificada|vagas?\s+(de\s+|na\s+)?garagem)'
      )
    );
$function$;
