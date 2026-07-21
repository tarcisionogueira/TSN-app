-- Radar de Editais — INGESTÃO (Item 3): usa o edital do DJEN para preencher dados que os
-- leiloeiros escondem (avaliação/valores/imóvel), inclusive p/ leiloeiros que não raspamos.
-- Campos adicionais do imóvel extraídos do edital (o DJEN não traz a certidão da matrícula,
-- mas o edital descreve o imóvel + ônus): área, débitos, ocupação, cartório (CRI).
alter table public.editais_leilao
  add column if not exists imovel_area_m2 numeric,
  add column if not exists debitos text,
  add column if not exists ocupacao text,
  add column if not exists cartorio text;

-- Enriquecimento do ACERVO a partir de editais: preenche a avaliação de lotes SEM avaliação
-- quando um edital tem lance EXATAMENTE igual ao valor mínimo do lote (chave forte p/ valores
-- "quebrados" > 10k) e avaliação coerente (entre o mínimo e 10x o mínimo). Conservador — não
-- toca lote que já tem avaliação nem faz match fraco. Chamado pelo radar-editais-cron.
create or replace function public.editais_enriquecer_acervo()
returns integer language plpgsql security definer set search_path to 'public' as $fn$
declare n integer;
begin
  with m as (
    select distinct on (i.id) i.id as imovel_id, e.valor_avaliacao as aval
    from public.imoveis_leilao i
    join public.editais_leilao e
      on e.valor_avaliacao > 0 and e.lance_minimo > 10000
     and i.valor_minimo = e.lance_minimo
     and e.valor_avaliacao between i.valor_minimo and i.valor_minimo*10
    where i.ativo and coalesce(i.valor_avaliacao,0)=0
    order by i.id, e.data_disponibilizacao desc
  )
  update public.imoveis_leilao i
  set valor_avaliacao = m.aval,
      desconto_percentual = round((1 - i.valor_minimo/m.aval)*100),
      viavel = ((1 - i.valor_minimo/m.aval) >= 0.3),
      score_viabilidade = least(100, round((1 - i.valor_minimo/m.aval)*150))
  from m where i.id = m.imovel_id;
  get diagnostics n = row_count;
  return n;
end $fn$;
revoke execute on function public.editais_enriquecer_acervo() from public, anon, authenticated;
grant execute on function public.editais_enriquecer_acervo() to service_role;
