-- ─────────────────────────────────────────────────────────────────────────────────────────
-- "SEM LANCE" QUE TEVE LANCE — 24/09/2026 (dono: Ford Ka SUPERBID 5020871)
--
-- O filtro "Sem lance" junta 'sem_lance' + 'indeterminado' (decisão de 21/09). A apuração
-- residencial da SUPERBID grava 'indeterminado' quando há lance mas não dá para afirmar venda
-- (lance abaixo da reserva = condicional, ou sem `winnerBid`) — e esse lote ia para o filtro de
-- quem procura lote SEM comprador. O Ka tinha 1 lance de R$ 23.000 sobre mínimo de R$ 22.500 e
-- "Ganhador" na página.
-- Sinal medido no nosso próprio acervo: `raw.price` > `valor_minimo` em 0 de 419 'sem_lance'
-- confirmados e em 35 de 55 'vendido'; e em 62 de 294 'indeterminado' — esses 62 saem do filtro.
-- Só liga (nunca desliga); a apuração residencial também liga quando `totalBids` > 0.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.veiculos_leilao add column if not exists teve_lance boolean not null default false;

create or replace function public.trg_veiculo_teve_lance()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  if not new.teve_lance and new.fonte = 'SUPERBID'
     and coalesce(nullif(new.raw->>'price', '')::numeric, 0) > coalesce(new.valor_minimo, 0)
     and coalesce(new.valor_minimo, 0) > 0 then
    new.teve_lance := true;
  end if;
  return new;
end $$;

drop trigger if exists trg_veiculo_teve_lance on public.veiculos_leilao;
create trigger trg_veiculo_teve_lance
  before insert or update of raw, valor_minimo, teve_lance on public.veiculos_leilao
  for each row execute function public.trg_veiculo_teve_lance();

update public.veiculos_leilao set teve_lance = true
 where not teve_lance and fonte = 'SUPERBID' and valor_minimo > 0
   and coalesce(nullif(raw->>'price', '')::numeric, 0) > valor_minimo;
