-- ─────────────────────────────────────────────────────────────────────────────────────────
-- FRAÇÃO IDEAL: A CLÁUSULA QUE DESCREVE UM APARTAMENTO NÃO É A FATIA QUE SE VENDE — 28/08
--
-- A regra de 17/08 ("frações ideais não são interessantes, pode excluir") continua valendo e
-- não muda: comprar 50% indiviso é outro negócio, e um relatório que projeta a revenda do bem
-- inteiro sobre isso não está otimista, está errado.
--
-- O QUE ESTAVA ERRADO: o padrão casava a EXPRESSÃO onde quer que ela aparecesse. Toda
-- matrícula de unidade em condomínio traz, por forma cartorial, a cláusula descritiva — "área
-- útil de 68,88m2, área comum de 15,56m2 ... e a fração ideal de 1,79088% no terreno e demais
-- coisas comuns do condomínio". O apartamento é vendido INTEIRO; a fração ideal é apenas como
-- o registro descreve a cota de terreno que acompanha a unidade. Existe em todo apartamento
-- do país.
--
-- O efeito era PERVERSO e SILENCIOSO: quanto melhor a ficha (enriquecida com o texto da
-- matrícula), maior a chance de o lote ser barrado — sumia justamente o acervo mais bem
-- documentado. E sem erro em lugar nenhum: o lote só fica `ativo=false` por trigger.
-- Achado a partir do apartamento em Vila Galvão/Guarulhos cujo relatório o dono gerou em
-- 28/08 e que voltou "leilão encerrado" (a data era outro defeito, no mesmo lote).
--
-- A ÂNCORA É O CONTEXTO, NÃO A PREPOSIÇÃO. Duas tentativas anteriores erraram por tentar
-- adivinhar a forma da frase, e as duas só foram desmascaradas TESTANDO CONTRA TEXTO REAL DO
-- ACERVO, não contra exemplos imaginados:
--   v1 exigia "no/do terreno"      → deixava barrado "fração ideal de 0,05015% SOBRE o terreno"
--   v2 exigia o número ANTES        → deixava barrado "fração ideal NO TERRENO DE 0,31413500%"
--                                     e "fração ideal de 561/100.000 sobre o terreno"
-- A v3 aceita as duas ordens e qualquer preposição, e em troca EXIGE O ENTORNO DE CONDOMÍNIO,
-- que é o que de fato separa os dois casos: a cláusula cartorial de unidade autônoma vem
-- sempre cercada de condomínio / área privativa / área útil / coisas de uso comum; a venda de
-- uma fatia de terreno nu não traz nada disso — e, na prática, anuncia no título.
--
-- OS DOIS ERROS NÃO CUSTAM O MESMO, e é isso que dita o desenho: deixar entrar uma fatia gera
-- um relatório que projeta a revenda do bem INTEIRO e conclui "viável"; barrar um apartamento
-- apenas o esconde. Por isso a exceção pede as três condições JUNTAS, e menção no TÍTULO
-- nunca é exceção — no título, é o que está à venda.
--
-- MEDIDO ANTES E DEPOIS (acervo inteiro): 399 barrados → 367. 32 liberados (25 apartamentos,
-- 4 casas, 2 comerciais, 1 imóvel). ZERO lote com termo de fatia — no título ou no texto —
-- passou a escapar. Conferido também contra 120 descrições reais, e o veredito desta função
-- foi cruzado com o de `ehFracaoIdeal` (JS) em 20 casos discriminantes: 0 divergência.
--
-- ESPELHA `ehFracaoIdeal` em scripts/lib/scraper-core.mjs. Mudou a régua aqui, mude lá — são
-- os dois portões (o banco barra o que já entrou; o scraper barra na coleta).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.fracao_ideal_barrada(p_titulo text, p_descricao text)
returns boolean
language sql
immutable
as $function$
  with t as (select coalesce(p_titulo,'') || ' ' || coalesce(p_descricao,'') as txt)
  select
    -- Menção no TÍTULO nunca é descritiva: é o que está à venda. Barra sempre.
    coalesce(p_titulo,'') ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
    or (
      (select txt from t) ~* '(parte\s+ideal|fra[çc][ãa]o\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
      and not (
        (
          -- (a1) número ANTES da âncora: "fração ideal de 1,79088% no terreno"
          (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+de\s+[0-9][0-9./,]*\s*%?\s*(no|do|na|da|nas|das|em|sobre)\s+(o\s+|a\s+|os\s+|as\s+)?([áa]rea|terreno|solo)'
          -- (a2) número DEPOIS da âncora: "fração ideal no terreno de 0,31413500%"
          or (select txt from t) ~* 'fra[çc][ãa]o\s+ideal\s+(de\s+|do\s+|no\s+|na\s+|em\s+|sobre\s+)?(o\s+|a\s+)?(terreno|solo|[áa]rea\s+comum)\s*(condominial\s*)?(e\s+[^,;.]{0,40})?\s*(de\s+|em\s+)?[0-9]'
        )
        -- (b) ... dentro de um contexto de CONDOMÍNIO. É este item que segura a exceção.
        and (select txt from t) ~* '(condom[íi]nio|[áa]rea\s+privativa|[áa]rea\s+[úu]til|[áa]rea\s+real|unidade\s+aut[ôo]noma|coisas\s+comuns|[áa]reas\s+comuns|coisas\s+de\s+uso\s+comum)'
        -- (c) ... e sem nenhum termo que só aparece em venda de fatia ou de direito.
        and (select txt from t) !~* '(parte\s+ideal|fra[çc][õo]es\s+ideais|direitos?\s+credit[óo]rio|nua[\s-]propriedade)'
      )
    );
$function$;

comment on function public.fracao_ideal_barrada(text, text) is
  'Barra lote em que se vende uma FATIA (parte ideal, nua-propriedade, direito creditorio). Excecao para a clausula descritiva de unidade em condominio ("fracao ideal de N% no/sobre o terreno"), que existe em toda matricula de apartamento: exige clausula + contexto de condominio + ausencia de termo de fatia. Espelha ehFracaoIdeal em scripts/lib/scraper-core.mjs — mudou aqui, mude la.';
