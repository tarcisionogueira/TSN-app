-- ─────────────────────────────────────────────────────────────────────────────────────────
-- ALUGUEL-ALVO DE 1% AO MÊS — a intenção "locação" ganha régua de dinheiro (28/08, dono)
--
-- A intenção "locação" filtrava só o TIPO do imóvel e não dizia nada sobre renda. A regra do
-- negócio é "1% ao mês sobre o valor investido", e ela NÃO pode virar filtro de busca: o
-- acervo conhece aluguel de mercado em 44 dos 29.447 lotes ativos — filtrar por rendimento
-- real esconderia 99,8% do material (é a mesma razão registrada em busca.intencao_locacao).
-- O que ela pode ser é um ALVO calculado do lance, que existe em 100% dos lotes:
-- "para render 1% a.m., este lote precisaria alugar por R$ X".
--
-- ⚠️ ALVO, NÃO PREVISÃO. O sistema não afirma que o imóvel aluga por isso; afirma quanto ele
-- precisaria render. O aluguel praticado na região continua sendo assunto do relatório
-- mercadológico, que é onde o número existe.
--
-- A RÉGUA DE CUSTO ERA TRÊS. Antes deste commit: 5%+5% no relatório (`Analise.jsx`), 9,5% na
-- simulação da ficha e 5%+3% no registro semeado pela Busca ao marcar "Arrematei" — três
-- contas do mesmo custo na mesma jornada. O relatório é a autoridade (é o que o cliente paga
-- para ler), então 10% vale para todos, e a régua passa a morar em src/lib/rentabilidade.js.
--
-- APLICAÇÃO em JS (ficha do lote e card da Busca); esta função é a DECLARAÇÃO canônica — a
-- única coisa que `auditoria_regras_negocio()` consegue enxergar — e `npm run verificar:regras`
-- compara as duas no CI, como já faz com a intenção.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.aluguel_alvo_mensal(p_lance numeric)
returns numeric
language sql
immutable
set search_path to 'public'
as $$
  -- Aplica a regra negocio.aluguel_alvo_1pct: investido = lance + comissão do leiloeiro (5%)
  -- + ITBI/registro (5%); o alvo é 1% desse investido, por mês. NULL quando não há lance —
  -- zero seria um número, e número é resposta.
  select case when p_lance is null or p_lance <= 0 then null
              else round(p_lance * 1.10 * 0.01, 2) end;
$$;

comment on function public.aluguel_alvo_mensal(numeric) is
  'Declaracao canonica do aluguel-alvo de 1% a.m. A aplicacao vive em src/lib/rentabilidade.js (ficha e Busca); npm run verificar:regras compara as duas. E ALVO, nao previsao de aluguel.';

insert into public.regra_negocio (chave, valor, descricao, aplicada_por, ativo) values
 ('negocio.aluguel_alvo_1pct',
  '{"pct_mes":1,"base":"investido","comissao_leiloeiro_pct":5,"itbi_registro_pct":5,"custo_aquisicao_pct":10,"e_previsao":false}'::jsonb,
  'Locacao: o alvo de renda e 1% ao mes sobre o VALOR INVESTIDO (lance + comissao do leiloeiro 5% + ITBI/registro 5%), nao sobre o lance seco. E exibido como ALVO na ficha do lote e no card da Busca quando a intencao e locacao, sempre com a premissa dita na tela. NAO e previsao de aluguel nem filtro de busca — o aluguel praticado sai no relatorio mercadologico, unico lugar onde o numero existe.',
  array['aluguel_alvo_mensal'], true)
on conflict (chave) do update
   set valor = excluded.valor, descricao = excluded.descricao,
       aplicada_por = excluded.aplicada_por, ativo = true, atualizado_em = now();
