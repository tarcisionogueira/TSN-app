-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O ALARME DE GEOCODE ACUSAVA O PRÓPRIO FREIO FUNCIONANDO — 27/08/2026
--
-- `geocode_acima_da_cota` marcava 11.119 contra 10.000 e parecia dinheiro vazando. Fui ver.
--
-- ELE PROJETA LINEARMENTE: `consumido × 30 / dia_do_mês`. E o consumo real do mês foi assim:
--     22/08: 1.298 · 23/08: 957 · 24/08: 0 · 25/08: 6 · 26/08: 1 · 27/08: 0
-- Os últimos quatro dias somam SETE chamadas. A projeção extrapola um ritmo que não existe
-- mais, e ia gritar até o fim do mês com o Google já desligado.
--
-- ⚠️ E ELE ESTAVA ENTREGANDO O FREIO DE CUSTO COMO SE FOSSE PROBLEMA — a forma nº 5 do
-- CLAUDE.md, e a quarta vez que o instrumento é o errado nesta base. `googleGeocode` tem
-- trava mensal (`GOOGLE_GEOCODE_MAX_MES`, 10.000): batido o teto, vira no-op e a cascata
-- segue nas rotas gratuitas. Os 10.007 do mês SÃO o teto — os 7 a mais são corrida entre
-- chamadas concorrentes, US$ 0,04. Não havia vazamento nenhum: havia trava funcionando.
--
-- 💸 MAS O CAMINHO ACHOU UM DEFEITO DE VERDADE, e esse é caro.
-- `registrarUso('google_geocode', 'geocode', { unidades: 1 })` nunca passava
-- `custo_usd_micro`, então gravava ZERO. O painel "Custos & Uso" mostrou **US$ 0 em julho —
-- mês de 34.695 chamadas, ~US$ 123 acima do tier grátis**. Não era custo zero: era custo
-- NÃO MEDIDO, entregue com cara de resposta. Mesma coisa no LocationIQ.
--
-- Corrigido em `api/_geo.js`: o Google passa a gravar o custo marginal (o tier grátis do
-- GOOGLE, 10k/mês, é constante própria — não se confunde com a NOSSA trava, e quem subir a
-- trava amanhã passa a ver a conta sozinho). O LocationIQ lê o preço de
-- `LOCATIONIQ_USD_POR_1000`, porque eu não sei qual plano está contratado e chutar um número
-- repetiria o mesmo defeito com outro valor.
-- ─────────────────────────────────────────────────────────────────────────────────────────

do $$
declare
  d text := pg_get_functiondef('public.qa_invariantes()'::regprocedure);
  antigo text;
  novo   text;
  ancora text := E'\n  )\n  select chave, titulo, categoria, gravidade,';
begin
  -- ─── 1. TROCA a projeção pelo GASTO REAL ────────────────────────────────────────────
  -- O que merece alarme não é "no ritmo de hoje daria mais que 10.000" — é "já passou do
  -- grátis e está custando". Limite 200 (~US$ 1) tolera a corrida do teto e continua
  -- acusando alto se a trava for desligada ou furar.
  antigo := substring(d from '\(''geocode_acima_da_cota''.*?\), 10000\),');
  if antigo is null then
    raise notice 'geocode_acima_da_cota nao encontrado — talvez ja substituido';
  else
    novo :=
      E'(''geocode_pago_no_mes'',''Chamadas de geocode do Google JA PAGAS no mes (acima das 10.000 gratuitas)'',''Captura'',''gap'',\n'
      '       (select greatest(0, coalesce(sum(requests),0) - 10000)::bigint\n'
      '          from uso_integracoes\n'
      '         where provedor = ''google_geocode'' and dia >= date_trunc(''month'', now())::date), 200),';
    d := replace(d, antigo, novo);
  end if;

  -- ─── 2. ACRESCENTA o vigia do custo NÃO MEDIDO ──────────────────────────────────────
  -- Zero gravado num provedor que está consumindo não é "de graça" — é "ninguém mediu".
  -- Foi assim que US$ 123 de julho ficaram invisíveis. Some sozinho quando a env for setada.
  if position('geocode_sem_preco' in d) = 0 then
    if position(ancora in d) = 0 then
      raise exception 'ancora nao encontrada em qa_invariantes() — abortando';
    end if;
    d := replace(d, ancora,
      E',\n'
      '     (''geocode_sem_preco'',''LocationIQ consumindo com preco nao configurado (defina LOCATIONIQ_USD_POR_1000)'',''Ingestao'',''gap'',\n'
      '       (select case when coalesce(sum(requests),0) > 0 and coalesce(sum(custo_usd_micro),0) = 0\n'
      '                    then coalesce(sum(requests),0) else 0 end::bigint\n'
      '          from uso_integracoes\n'
      '         where provedor = ''locationiq'' and dia >= date_trunc(''month'', now())::date), 0)'
      || ancora);
  end if;

  execute d;
end $$;
