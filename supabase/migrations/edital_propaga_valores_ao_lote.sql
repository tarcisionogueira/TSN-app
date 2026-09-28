-- ─────────────────────────────────────────────────────────────────────────────────────────
-- EDITAL QUE GANHA VALOR DEPOIS DE PROMOVIDO PASSA O VALOR AO LOTE — 28/09/2026
--
-- Invariante `editais_avaliacao_perdida` = 7 (achado 22/09 com 39, backfill feito, "causa não
-- 100% isolada"). Medido hoje: `editais_promover_pendentes` COPIA valor_avaliacao/lance_minimo
-- no insert e nenhum gatilho de imoveis_leilao os anula. O que sobra é o tempo: a extração do
-- edital completa campos DEPOIS da promoção (edital atualizado às 08h e em 28/09, promovido às
-- 04h) e nada levava o valor ao lote — ele ficava sem avaliação para sempre, sem desconto e
-- fora do filtro de preço, com o edital de origem sabendo o número.
--
-- Mesma regra do ramo de dedup da promoção: só preenche o que o lote NÃO tem (nunca sobrescreve
-- valor que veio da fonte do leiloeiro).
-- ─────────────────────────────────────────────────────────────────────────────────────────
create or replace function public.editais_propagar_valores()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.imovel_id is null then return new; end if;
  update public.imoveis_leilao i set
    valor_avaliacao = case when coalesce(i.valor_avaliacao, 0) = 0 and coalesce(new.valor_avaliacao, 0) > 0 then new.valor_avaliacao else i.valor_avaliacao end,
    valor_minimo    = case when coalesce(i.valor_minimo, 0) = 0 and coalesce(new.lance_minimo, 0) > 0 then new.lance_minimo else i.valor_minimo end
   where i.id = new.imovel_id
     and ((coalesce(i.valor_avaliacao, 0) = 0 and coalesce(new.valor_avaliacao, 0) > 0)
       or (coalesce(i.valor_minimo, 0) = 0 and coalesce(new.lance_minimo, 0) > 0));
  return new;
end $$;
revoke all on function public.editais_propagar_valores() from public, anon, authenticated;

drop trigger if exists trg_editais_propagar_valores on public.editais_leilao;
create trigger trg_editais_propagar_valores
  after update of valor_avaliacao, lance_minimo, imovel_id on public.editais_leilao
  for each row execute function public.editais_propagar_valores();

-- Backfill: os lotes ativos já ligados que ficaram sem o valor do edital.
update public.imoveis_leilao i set
  valor_avaliacao = case when coalesce(i.valor_avaliacao, 0) = 0 and coalesce(e.valor_avaliacao, 0) > 0 then e.valor_avaliacao else i.valor_avaliacao end,
  valor_minimo    = case when coalesce(i.valor_minimo, 0) = 0 and coalesce(e.lance_minimo, 0) > 0 then e.lance_minimo else i.valor_minimo end
  from public.editais_leilao e
 where e.imovel_id = i.id and i.ativo
   and ((coalesce(i.valor_avaliacao, 0) = 0 and coalesce(e.valor_avaliacao, 0) > 0)
     or (coalesce(i.valor_minimo, 0) = 0 and coalesce(e.lance_minimo, 0) > 0));
