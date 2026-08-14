-- Reparo do acervo: relatórios de TERRENO que saíram com aluguel (14/08).
--
-- Contexto completo em `regras_locacao_lote_e_yield.sql`. A regra "lote não se aluga" é de
-- 03/08 e vivia como instrução ao modelo; o caminho do modelo não a aplicava. Dois relatórios
-- já emitidos ficaram com aluguel de terreno vazio:
--   • Cotia  (`160edf04…`) — "Terreno 600 m², Chácaras Vista Alegre": R$ 3.000,00/mês, 2 locações
--   • Sorocaba (`32f2648f…`) — "Terreno, Vila Haro": R$ 650,00/mês, 1 locação
-- São preços de CASA. O que os portais listam como "terreno para alugar" é outro produto
-- (pátio, área de eventos, área comercial) e não é comparável a um lote residencial.
--
-- Zerar sem dizer por quê seria trocar a informação falsa por uma lacuna — e lacuna convida
-- alguém a preencher de novo. Por isso grava também `locacaoNaoSeAplica`, que é o que a tela
-- imprime no lugar dos três cards (ver src/pages/Analise.jsx).
--
-- `updated_at` preservado pelo mesmo motivo do backfill de yield.
-- Reversível: aluguel, yield e a lista de locações anteriores ficam em
-- `terreno_locacao_backfill_2026_08_14`. Idempotente.
create table if not exists public.terreno_locacao_backfill_2026_08_14 (
  analise_id uuid primary key,
  aluguel_antes numeric,
  yield_antes numeric,
  locacoes_antes jsonb,
  corrigido_em timestamptz not null default now()
);
alter table public.terreno_locacao_backfill_2026_08_14 enable row level security;

with alvo as (
  select id,
         (result->'mercado'->>'aluguelMedio')::numeric as aluguel,
         (result->'mercado'->>'yieldBruto')::numeric as y,
         coalesce(result->'mercado'->'locacoes', '[]'::jsonb) as locs
    from public.analises_mercado
   where status = 'concluida'
     and lower(coalesce(imovel->>'tipo','')) ~ 'terreno|lote'
     and (result->'mercado'->>'aluguelMedio')::numeric > 0
), gravado as (
  update public.analises_mercado a
     set result = jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(jsonb_set(
             a.result,
             '{mercado,locacoes}', '[]'::jsonb),
             '{mercado,aluguelMedio}', '0'::jsonb),
             '{mercado,yieldBruto}', '0'::jsonb),
             '{mercado,yieldLiquido}', '0'::jsonb),
             '{mercado,consolidado,aluguelMedio}', '0'::jsonb),
             '{mercado,locacaoNaoSeAplica}',
             to_jsonb('Lote/terreno não tem mercado de locação residencial. O que os portais listam como "terreno para alugar" é outro produto (pátio, área de eventos, área comercial) e não serve de comparável — o retorno aqui é revenda/valorização, não aluguel.'::text)),
         updated_at = a.updated_at
    from alvo v
   where a.id = v.id
   returning a.id, v.aluguel, v.y, v.locs
)
insert into public.terreno_locacao_backfill_2026_08_14 (analise_id, aluguel_antes, yield_antes, locacoes_antes)
select id, aluguel, y, locs from gravado
on conflict (analise_id) do nothing;
