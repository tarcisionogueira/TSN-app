-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O PREÇO DO LOTE É O MENOR VALOR ENTRE AS PRAÇAS — 17/08/2026
-- Decisão do dono: "o valor é sempre o menor valor".
--
-- O PROBLEMA ERA DE CONSUMO, NÃO DE CAPTURA. **3.186 lotes ativos JÁ TINHAM a 2ª praça
-- gravada** (`valor_minimo_2`, quase todos da CEF) e mesmo assim eram exibidos, FILTRADOS,
-- ORDENADOS e enviados por e-mail pelo valor da praça CARA. Em média, o preço real é **27%
-- menor** que o anunciado nesses lotes.
--
-- O pior efeito não era o preço na tela — era o filtro. `Busca.jsx` filtrava por
-- `valor_minimo` no servidor, então quem procurava "até R$ 800 mil" NUNCA VIA um lote de
-- 1ª praça a R$ 1,18 mi cuja 2ª praça sai por R$ 713 mil. O lote sumia justamente para o
-- investidor a quem ele servia.
--
-- POR QUE COLUNA GERADA, e não um cálculo no cliente. Preço aparece em três lugares que
-- precisam concordar: o que o cliente LÊ, o que o filtro COMPARA e o que a ordenação USA. Os
-- dois últimos rodam no servidor. Calcular só no front consertaria a vitrine e deixaria o
-- filtro mentindo — a mesma família de defeito que este projeto vem catalogando (duas
-- leituras do mesmo fato que discordam). Sendo coluna GERADA, é impossível divergirem: há um
-- número só, e ele é derivado, não copiado.
--
-- Também é indexável — daí `imoveis_leilao_valor_ref` —, o que o cálculo no cliente jamais
-- seria: filtrar por preço passaria a varrer o acervo inteiro.
--
-- NOTA SOBRE PRAÇA VENCIDA. `pracaMaisDescontada` (src/utils/leilaoEncerrado.js) escolhe o
-- menor entre as praças ainda NÃO vencidas, o que é mais fino. Não dá para reproduzir isso
-- numa coluna gerada, porque depende de `now()` (a expressão precisa ser IMMUTABLE). A regra
-- do dono é "sempre o menor", e é o que está aqui; a ficha e a análise continuam usando o
-- helper, que é mais preciso quando a 1ª praça já passou. Se um dia a diferença incomodar, o
-- caminho é uma RPC de busca, não relaxar a imutabilidade.
-- ─────────────────────────────────────────────────────────────────────────────────────────

alter table public.imoveis_leilao
  add column if not exists valor_minimo_ref numeric
  generated always as (
    case
      when coalesce(valor_minimo_2, 0) > 0 and coalesce(valor_minimo, 0) > 0
        then least(valor_minimo, valor_minimo_2)
      when coalesce(valor_minimo_2, 0) > 0 then valor_minimo_2
      else valor_minimo
    end
  ) stored;

create index if not exists imoveis_leilao_valor_ref on public.imoveis_leilao (valor_minimo_ref) where ativo;

comment on column public.imoveis_leilao.valor_minimo_ref is
  'O PREÇO do lote: o MENOR entre as praças (decisão do dono, 17/08 — "será sempre o menor valor"). Coluna GERADA, então filtro, ordenação e exibição leem o mesmo número e não podem divergir. Use esta, não valor_minimo, em qualquer lugar que apresente preço ao cliente.';
