-- 03/10 — regra acervo.fracao_ideal: fração em NÚMERO no título também barra.
--
-- Achado pelo invariante tipo_terreno_com_construcao: "(2/9 do imóvel) Galpão, A.C. 749m², Itajobi/SP"
-- (SOLD) estava ATIVO. A régua só conhecia as palavras "parte/fração ideal"; "2/9 do imóvel" e
-- "1/6 do Prédio" (LJUD) passavam. Vender 2/9 de um galpão não é vender o galpão — o relatório
-- projetaria a revenda do bem inteiro.
-- Só no TÍTULO: na descrição, "1/20 do terreno" é a cota cartorial de um apartamento inteiro (por isso
-- `terreno` fica fora da lista). Medido antes de aplicar: barra exatamente 3 lotes ativos (os 3 acima).
-- Espelho JS: RE_FRACAO_NUMERICA_TITULO em scripts/lib/scraper-core.mjs (teste: npm run testar:fracao).
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
    or coalesce(p_titulo,'') ~* '(^|[^0-9/])[0-9]{1,3}\s*/\s*[0-9]{1,3}\s*(\([^)]{0,20}\)\s*)?(avos\s+)?(d[oa]s?|sobre\s+[oa])\s+(im[oó]vel|bem|pr[eé]dio|casa|apartamento|lote)\M'
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

-- Uma vez: os 3 lotes ativos que a régua nova barra (o trigger trg_imovel_fracao_ideal só age na
-- próxima escrita de cada um).
update imoveis_leilao set ativo = false where ativo and public.fracao_ideal_barrada(titulo, descricao);

-- Uma vez: tipo de lote gravado ANTES do trigger trg_tipo_construido_pelo_titulo (28/09) e não
-- reescrito desde então (o galpão da SOLD, última escrita 24/09). Só ATIVOS: há 290 inativos no mesmo
-- caso, que não chegam ao cliente; se voltarem, a reescrita dispara o trigger e corrige sozinha.
update imoveis_leilao set tipo = public.tipo_construido_pelo_titulo(titulo)
 where ativo and tipo = 'terreno' and public.tipo_construido_pelo_titulo(titulo) is not null;
