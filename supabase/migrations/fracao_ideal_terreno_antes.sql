-- 27/09 (Sublime): 3ª ordem da cláusula cartorial de condomínio — "correspondendo NO TERRENO uma
-- fração ideal de 0,004130 ou 0,4130%" (terreno ANTES da âncora). Apartamento inteiro saía barrado.
-- Medido antes: dos 521 lotes barrados no acervo, 0 liberados por esta ordem. Espelha
-- RE_CLAUSULA_TERRENO_ANTES de scripts/lib/scraper-core.mjs — mudou a régua aqui, mude lá.
create or replace function public.fracao_ideal_barrada(p_titulo text, p_descricao text)
 returns boolean language sql immutable set search_path to 'public' as $function$
  -- Aplica a regra acervo.fracao_ideal: parte/fracao ideal, direito creditorio e
  -- nua-propriedade nao entram no acervo (nos tres casos nao se compra O IMOVEL).
  with t as (select coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as txt)
  select
    coalesce(p_titulo,'') ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    or (
      (select txt from t) ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
      and not (
        (
          -- numero ANTES da ancora
          (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+de\s+[0-9][0-9./,]*\s*%?\s*(no|do|na|da|nas|das|em|sobre)\s+(o\s+|a\s+|os\s+|as\s+)?([áa]rea|terreno|solo)'
          -- ou numero DEPOIS da ancora
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+(de\s+|do\s+|no\s+|na\s+|em\s+|sobre\s+)?(o\s+|a\s+)?(terreno|solo|[áa]rea\s+comum)\s*(condominial\s*)?(e\s+[^,;.]{0,40})?\s*(de\s+|em\s+)?[0-9]'
          -- ou terreno ANTES da ancora ("no terreno uma fracao ideal de 0,0041")
          or (select txt from t) ~* '(no|do|ao)\s+(terreno|solo)\s+(uma\s+|a\s+)?fra[çc][ãa]o\s+ideal\s+de\s+[0-9]'
        )
        and (select txt from t) ~* '(condom[íi]nio|[áa]rea\s+privativa|[áa]rea\s+[úu]til|[áa]rea\s+real|unidade\s+aut[ôo]noma|coisas\s+comuns|[áa]reas\s+comuns|coisas\s+de\s+uso\s+comum)'
        and (select txt from t) !~* '(parte\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
      )
    );
$function$;
