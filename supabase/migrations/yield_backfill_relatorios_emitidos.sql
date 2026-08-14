-- Reparo do acervo: rentabilidade gravada como RAZÃO nos relatórios já emitidos (14/08).
--
-- Contexto completo em `regras_locacao_lote_e_yield.sql`. Em resumo: o yield vinha do modelo e
-- saía sem o ×100 — "0,09% a.a." onde o certo era 11,16% a.a. Metade dos relatórios emitidos
-- (25 de 56) estava assim, publicada para o cliente com a rentabilidade cem vezes menor.
--
-- Esta migração NÃO reprocessa IA: os dois números da conta (`aluguelMedio` e
-- `valorEstimadoImovel`) já estão gravados no próprio JSON do relatório, então o reparo é
-- aritmética pura, custo zero. Fórmula idêntica à que o servidor passa a aplicar na geração:
--   bruto  = aluguelMedio × 12 / valorEstimadoImovel × 100
--   líquido = bruto × 0,85   (15% de vacância/despesas, como o prompt define)
--
-- FILTRO DELIBERADO — `aluguelMedio >= 300`: onde o aluguel em si é implausível, o defeito não
-- é a conta, é a ENTRADA (ex.: `8407e489…`, Sorocaba, com `aluguelMedio: 27,62`, que é
-- R$/m²·mês e não valor mensal — o bug de unidade corrigido em 07/08). Recalcular sobre entrada
-- errada só troca um número errado por outro com aparência melhor. Esses ficam de fora e
-- precisam ser REGERADOS.
--
-- `updated_at` é preservado de propósito: isto é correção de um valor derivado, não atividade
-- nova do cliente — mexer no carimbo bagunçaria a janela de cache e a retenção.
--
-- Reversível: os valores anteriores ficam em `yield_backfill_2026_08_14`.
-- Resultado da execução em 14/08: 23 relatórios corrigidos, yields de 0,96% a 11,16% a.a.
-- (média 7,09%). Idempotente — depois de rodar, nenhuma linha casa com o filtro.
create table if not exists public.yield_backfill_2026_08_14 (
  analise_id uuid primary key,
  yield_bruto_antes numeric,
  yield_liquido_antes numeric,
  yield_bruto_depois numeric,
  yield_liquido_depois numeric,
  corrigido_em timestamptz not null default now()
);
alter table public.yield_backfill_2026_08_14 enable row level security;

with alvo as (
  select id,
         (result->'mercado'->>'aluguelMedio')::numeric as aluguel,
         (result->'mercado'->'consolidado'->>'valorEstimadoImovel')::numeric as val_est,
         (result->'mercado'->>'yieldBruto')::numeric as y_antes,
         (result->'mercado'->>'yieldLiquido')::numeric as yl_antes
    from public.analises_mercado
   where status = 'concluida'
     and (result->'mercado'->>'aluguelMedio')::numeric >= 300
     and (result->'mercado'->'consolidado'->>'valorEstimadoImovel')::numeric > 0
     and (result->'mercado'->>'yieldBruto')::numeric between 0.0001 and 0.5
), calc as (
  select id, y_antes, yl_antes,
         round(aluguel * 12 * 100 / val_est, 2) as y_novo,
         round(aluguel * 12 * 100 / val_est * 0.85, 2) as yl_novo
    from alvo
), gravado as (
  update public.analises_mercado a
     set result = jsonb_set(
           jsonb_set(
             jsonb_set(
               jsonb_set(a.result, '{mercado,yieldBruto}', to_jsonb(c.y_novo)),
               '{mercado,yieldLiquido}', to_jsonb(c.yl_novo)),
             '{mercado,consolidado,yieldBruto}', to_jsonb(c.y_novo)),
           '{mercado,consolidado,yieldLiquido}', to_jsonb(c.yl_novo)),
         updated_at = a.updated_at
    from calc c
   where a.id = c.id
   returning a.id, c.y_antes, c.yl_antes, c.y_novo, c.yl_novo
)
insert into public.yield_backfill_2026_08_14 (analise_id, yield_bruto_antes, yield_liquido_antes, yield_bruto_depois, yield_liquido_depois)
select id, y_antes, yl_antes, y_novo, yl_novo from gravado
on conflict (analise_id) do nothing;
