-- Score BidPro — camada Financeiro: conserta os zeros "sujos" + para o drift de NULL.
--
-- Contexto (achado ao investigar a pílula "Financeiro: 0" da Busca): o backfill original
-- (backfill_score_financeiro.sql) só cobria `score_financeiro is null`, deixando:
--   • 239 linhas com score_financeiro = 0 estagnado (a fórmula tem PISO 35 p/ desconto ≥0,
--     então 0 nunca é um score real — é "não medido"; virava pílula VERMELHA falsa);
--   • ~9,2 mil imóveis NOVOS pós-backfill sem a camada Financeiro (sem mecanismo que
--     recalcule → o número só cresce).
-- calc_score_financeiro é determinística/imutável e o front (score.js) já trata 0 como
-- ausente — aqui alinhamos o DADO à mesma convenção.

-- 1) Recalcula onde está NULL ou 0. Nunca toca num score real > 0 (fluxo de análise/staff).
update public.imoveis_leilao
   set score_financeiro   = public.calc_score_financeiro(modalidade, desconto_percentual, tipo),
       score_calculado_em = now()
 where score_financeiro is null or score_financeiro = 0;

-- 2) Trigger: todo imóvel novo (ou update que zere/anule o campo) já nasce com o score
--    determinístico — some o drift de NULL. Só preenche quando ausente; jamais sobrescreve
--    um score real gravado pelo fluxo de análise. Função imutável → custo desprezível no
--    upsert do scraper.
create or replace function public.trg_preenche_score_financeiro()
returns trigger language plpgsql as $$
begin
  if new.score_financeiro is null or new.score_financeiro = 0 then
    new.score_financeiro := public.calc_score_financeiro(new.modalidade, new.desconto_percentual, new.tipo);
    new.score_calculado_em := now();
  end if;
  return new;
end $$;

drop trigger if exists score_financeiro_auto on public.imoveis_leilao;
create trigger score_financeiro_auto
  before insert or update on public.imoveis_leilao
  for each row execute function public.trg_preenche_score_financeiro();
