-- FRAÇÃO IDEAL v4 (08/10). Espelho: ehFracaoIdeal() em scripts/lib/scraper-core.mjs — mudou aqui, mude lá.
--
-- Achado: ao gravar a DESCRIÇÃO COMPLETA da ZUK/MEGA (antes era eco do título), o gatilho
-- trg_imovel_fracao_ideal derrubou 82 lotes que eram unidades INTEIRAS — a matrícula de todo
-- apartamento/casa de condomínio cita "fração ideal do terreno", e a régua só conhecia 3 formas
-- de escrever essa cláusula. Medido sobre o acervo antes de aplicar: 76 lotes liberados (revisados
-- um a um), 0 lote ativo passa a ser barrado. Três correções:
--  1. O NOME DO VENDEDOR não é o objeto à venda: "Vendedor: Santiago Fundo de Investimento em
--     Direitos Creditórios" barrava a casa inteira como se fosse venda de crédito.
--  2. Formas cartoriais novas: "respectiva/correspondente fração ideal", "fração ideal … do
--     (respectivo) terreno / domínio útil" (até 60 chars), "Fração ideal: 8,2881%", "Fração ideal
--     (matrícula): 27,5%", "1,98% de fração ideal", "Área de terreno/fração ideal de 21,02m²",
--     "2,99/100 avos da área", "Área terreno: 60,00m² (fração ideal)" — sempre exigindo contexto de unidade (condomínio, área privativa,
--     apartamento, casa, loja, área construída, vaga…).
--  3. Fatia continua barrada mesmo com número: "Fração ideal de 33,33% SOBRE imóvel rural",
--     "1/3 sobre casa", "83,48% DA fração ideal" (4 casos reais do EDITAL_DJEN que a regra 2 liberaria).
create or replace function public.fracao_ideal_barrada(p_titulo text, p_descricao text)
returns boolean language sql immutable set search_path to 'public' as $function$
  with t as (select
    regexp_replace(regexp_replace(coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,''),
      'fundos?\s+de\s+investimentos?\s+em\s+direitos\s+credit[óo]rios(\s+n[ãa]o[\s-]padronizados?)?', ' ', 'gi'),
      '(respectiv[ao]s?|correspondentes?)\s+fra[çc](ão|ao|ões|oes)\s+idea(l|is)', ' fração ideal do terreno ', 'gi') as txt)
  select
    coalesce(p_titulo,'') ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    or coalesce(p_titulo,'') ~* '(^|[^0-9/])[0-9]{1,3}\s*/\s*[0-9]{1,3}\s*(\([^)]{0,20}\)\s*)?(avos\s+)?(d[oa]s?|de(\s+uma?)?|sobre\s+[oa])\s+(im[oó]vel|bem|pr[eé]dio|casa|apartamento|lote)\M'
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
