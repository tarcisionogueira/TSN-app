-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O "1% AO MÊS" DA LOCAÇÃO VIRA FILTRO — 28/08 (correção de rumo pedida pelo dono)
--
-- Horas antes, na mesma sessão, a régua de 1% foi implementada só como ALVO exibido, com a
-- justificativa registrada em `busca.intencao_locacao`: *"não há piso de rendimento no filtro
-- porque o acervo não carrega aluguel por lote"*. O dono corrigiu: o 1% era para FILTRAR —
-- reduzir a Busca aos lotes que atendem à condição, que ainda assim serão avaliados no
-- relatório e pela assessoria.
--
-- A objeção continua verdadeira (aluguel real existe em 48 dos 29.447 ativos) e por isso o
-- filtro NÃO é sobre aluguel: é a mesma regra TRADUZIDA para o que todo lote tem, o desconto.
-- Quanto mais fundo o lance está abaixo da avaliação, menor o aluguel necessário para pagar
-- 1% do investido. Com números MEDIDOS nos nossos próprios relatórios:
--
--   alvo mensal       = lance × 1,10 × 1%  = 1,10% do lance      (custo de aquisição 10%)
--   aluguel plausível ≈ valor de mercado × 0,56%/mês             (mediana de 48 relatórios)
--   valor de mercado  ≈ 95,8% da avaliação do leilão             (mediana de 37 relatórios)
--   0,958 × aval × 0,0056 ≥ lance × 0,011 → lance/aval ≤ 0,4877 → desconto ≥ 51,2%
--
-- PISO ADOTADO: 50%. O 1,2 ponto de folga é deliberado — 1.002 lotes ativos estão EXATAMENTE
-- em 50% (a 2ª praça clássica, metade da avaliação), e cortá-los por 1,2 pp de uma mediana
-- amostral de 48 casos seria fingir precisão que a amostra não tem. São justamente os lotes
-- que o relatório existe para julgar. Medido no acervo: dos 25.646 residenciais ativos,
-- 5.671 passam com 50% (22%) — contra 8.897 em 45% e 4.669 em 51%.
--
-- ⚠️ O QUE ESTE PISO NÃO GARANTE: que a avaliação do leilão seja crível. Desconto fundo sobre
-- avaliação inflada continua passando; quem derruba esse caso é o relatório mercadológico,
-- que pesquisa preço real. O filtro é TRIAGEM, não veredito — que é exatamente o desenho que
-- o dono descreveu.
--
-- ⚠️ TEMPORADA NÃO HERDA ESTE PISO: diária de alta estação não se compara com aluguel mensal,
-- e a regra de 1% foi dita para locação. Piso inventado seria pior que piso nenhum.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.intencao_filtro(p_intencao text)
returns jsonb
language sql
immutable
set search_path to 'public'
as $$
  -- busca.intencao_revenda: tipos líquidos + desconto mínimo de 40% (dono, 28/08 — era 30%).
  -- busca.intencao_locacao: residencial + desconto mínimo de 50%, que é o "1% ao mês sobre o
  --   investido" traduzido para o que o acervo tem em todo lote (ver o cabeçalho da migração).
  -- busca.intencao_temporada: residencial em destino turístico (a lista vive em _temporada.js).
  select case p_intencao
    when 'revenda'   then jsonb_build_object('tipos', jsonb_build_array('apartamento','casa','comercial','imovel'), 'desconto_min', 40)
    when 'locacao'   then jsonb_build_object('tipos', jsonb_build_array('apartamento','casa','imovel'),             'desconto_min', 50)
    when 'temporada' then jsonb_build_object('tipos', jsonb_build_array('apartamento','casa','imovel'),             'desconto_min', 0, 'exige_cidade_turistica', true)
    else jsonb_build_object('tipos', '[]'::jsonb, 'desconto_min', 0)
  end;
$$;

update public.regra_negocio
   set valor = '{"tipos":["apartamento","casa","imovel"],"desconto_min":50,"regra":"aluguel paga 1% a.m. sobre o investido","yield_mediano_pct":0.56,"mercado_sobre_avaliacao_pct":95.8,"derivado":51.2,"adotado":50,"amostra_relatorios":48,"mudou_em":"2026-08-28"}'::jsonb,
       descricao = 'Locacao: residencial + desconto minimo de 50%. E a regra do dono ("o aluguel tem que pagar 1% ao mes sobre o valor investido") traduzida para o unico dado que existe em todo lote — o desconto. Nao se filtra por aluguel porque o acervo so o conhece em 48 dos 29.447 ativos. Conta: alvo = lance x 1,10 x 1% = 1,10% do lance; aluguel plausivel = valor de mercado x 0,56%/mes (mediana de 48 relatorios nossos); valor de mercado = 95,8% da avaliacao (mediana de 37); logo desconto >= 51,2%. Adotado 50% porque 1.002 lotes ativos estao exatamente em 50% (2a praca classica) e 1,2 pp e menos precisao do que uma amostra de 48 tem. Passam 5.671 dos 25.646 residenciais ativos (22%). NAO garante que a avaliacao seja crivel — e triagem, o veredito e do relatorio mercadologico e da assessoria.',
       aplicada_por = array['intencao_filtro'], ativo = true, atualizado_em = now()
 where chave = 'busca.intencao_locacao';
