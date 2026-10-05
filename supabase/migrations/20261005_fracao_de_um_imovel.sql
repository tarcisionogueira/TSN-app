-- 05/10 — regra acervo.fracao_ideal: "1/9 de Um Imóvel Urbano" (DBS, plataforma Astavero) passava — o conector
-- entre a fração e o bem só aceitava do/da/dos/das/sobre. Acrescenta "de"/"de um(a)". Medido antes de aplicar:
-- 0 lotes ativos novos barrados (só pega a forma nova). Espelho JS: RE_FRACAO_NUMERICA_TITULO em
-- scripts/lib/scraper-core.mjs (teste: npm run testar:fracao). Mudou aqui → mude lá no mesmo commit.
create or replace function public.fracao_ideal_barrada(p_titulo text, p_descricao text)
 returns boolean
 language sql
 immutable
 set search_path to 'public'
as $function$
  -- Aplica a regra acervo.fracao_ideal: parte/fracao ideal, direito creditorio e
  -- nua-propriedade nao entram no acervo (nos tres casos nao se compra O IMOVEL).
  with t as (select coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as txt)
  select
    coalesce(p_titulo,'') ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    -- fracao em NUMERO no titulo (03/10): "(2/9 do imovel)", "1/6 do Predio"
    or coalesce(p_titulo,'') ~* '(^|[^0-9/])[0-9]{1,3}\s*/\s*[0-9]{1,3}\s*(\([^)]{0,20}\)\s*)?(avos\s+)?(d[oa]s?|de(\s+uma?)?|sobre\s+[oa])\s+(im[oó]vel|bem|pr[eé]dio|casa|apartamento|lote)\M'
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
