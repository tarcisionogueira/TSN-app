-- Corpus de aprendizado: tirar o aluguel dos registros de TERRENO (14/08).
--
-- `aprenderNaEmissao` grava no corpus o que foi EMITIDO. Como o relatório de terreno saía com
-- aluguel (a regra "lote não se aluga" era de 03/08 e o caminho do modelo não a aplicava — ver
-- `regras_locacao_lote_e_yield.sql`), o defeito do relatório virou defeito do aprendizado: o
-- agente estava aprendendo que lote tem mercado de locação, e com que preço.
--
-- Não é um registro, são CINCO — e o pior deles é justo o que originou a regra:
--   id 200 · Cotia            · R$ 3.000,00/mês   (14/08, o que o dono viu)
--   id 154 · Sorocaba         · R$ 650,00/mês
--   id 149 · Santana de Parnaíba · R$ 63.409,17/mês  ← é ESTE que o comentário do prompt cita
--            como "o relatório de um TERRENO já saiu com aluguel médio R$ 63.409/mês porque três
--            anúncios de VENDA foram lidos como aluguel". A regra foi escrita em 03/08 para que
--            não se repetisse, e o registro dele ficou no corpus desde então.
--   id 130 · Santana de Parnaíba · R$ 3.000,00/mês
--   id   3 · Bertioga         · R$ 4.966,00/mês
--
-- ZERA SÓ O CAMPO CONTAMINADO. Apagar a linha inteira jogaria fora o que ela tem de bom
-- (preço/m², desconto, avaliação, intenção) e a região que ela representa — o corpus tem 199
-- linhas em 36 cidades, é caro de refazer. `aluguel_medio` vira null: ausência, não zero.
--
-- Reversível: `corpus_aluguel_terreno_backup_2026_08_14`. Idempotente.
create table if not exists public.corpus_aluguel_terreno_backup_2026_08_14 (
  aprendizado_id bigint primary key,
  aluguel_antes numeric,
  cidade text,
  corrigido_em timestamptz not null default now()
);
alter table public.corpus_aluguel_terreno_backup_2026_08_14 enable row level security;

with alvo as (
  select a.id, (a.corpus->>'aluguel_medio')::numeric as aluguel, a.cidade
    from public.agente_aprendizado a
    left join public.imoveis_leilao i on i.id::text = a.imovel_id
   where a.agente = 'mercadologico'
     and coalesce((a.corpus->>'aluguel_medio')::numeric, 0) > 0
     and (lower(coalesce(i.tipo,'')) ~ 'terreno|lote' or lower(coalesce(a.tipo,'')) ~ 'terreno|lote')
), gravado as (
  update public.agente_aprendizado a
     set corpus = jsonb_set(a.corpus, '{aluguel_medio}', 'null'::jsonb)
    from alvo v
   where a.id = v.id
   returning a.id, v.aluguel, v.cidade
)
insert into public.corpus_aluguel_terreno_backup_2026_08_14 (aprendizado_id, aluguel_antes, cidade)
select id, aluguel, cidade from gravado
on conflict (aprendizado_id) do nothing;
