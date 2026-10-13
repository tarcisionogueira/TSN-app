-- 14/10 (dono: "pode fazer o desconto contra a FIPE também"). Mesmo desenho do
-- `desconto_percentual` (11/09, contra a avaliação do leiloeiro): coluna própria para o PostgREST
-- filtrar/ordenar no servidor, com a mesma trava (<= 0 ou > 95 vira null — desconto que não existe).
-- Calculado por TRIGGER, não por coluna gerada: há código que reescreve linhas de veiculos_leilao e
-- uma coluna gerada recusaria o valor no upsert. O trigger só olha `valor_minimo`/`valor_fipe`, então
-- o lote da FIPE (que grava `valor_fipe`) e os coletores (que gravam `valor_minimo`) já o mantêm.
alter table public.veiculos_leilao add column if not exists desconto_fipe_percentual integer;

create or replace function public.veiculo_desconto_fipe()
returns trigger language plpgsql set search_path = public as $$
declare d integer;
begin
  d := null;
  if new.valor_fipe > 0 and new.valor_minimo > 0 and new.valor_minimo < new.valor_fipe then
    d := round((1 - new.valor_minimo::numeric / new.valor_fipe) * 100);
    if d <= 0 or d > 95 then d := null; end if;
  end if;
  new.desconto_fipe_percentual := d;
  return new;
end $$;

drop trigger if exists trg_veiculo_desconto_fipe on public.veiculos_leilao;
create trigger trg_veiculo_desconto_fipe
  before insert or update of valor_minimo, valor_fipe on public.veiculos_leilao
  for each row execute function public.veiculo_desconto_fipe();

-- Ordenar por "maior desconto (FIPE)" sem varrer o acervo.
create index if not exists veiculos_leilao_desconto_fipe_idx
  on public.veiculos_leilao (desconto_fipe_percentual desc) where ativo and desconto_fipe_percentual is not null;

-- Backfill (poucas dezenas de linhas com FIPE em 14/10): reescreve valor_fipe nele mesmo para o trigger calcular.
update public.veiculos_leilao set valor_fipe = valor_fipe where valor_fipe > 0;
