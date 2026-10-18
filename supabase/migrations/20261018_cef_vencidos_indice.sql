-- ─────────────────────────────────────────────────────────────────────────────────────────
-- desativar_imoveis_cef_vencidos_lote ainda estourou os 8 s às 05h UTC de 18/10 (0 pendentes!) — o custo
-- não é o UPDATE, é achar o "máximo por estado": 40 mil linhas CEF (ativas e inativas) lidas do heap
-- (~20 mil blocos). Parado: 273 ms; com cache frio + runner residencial + onda de crons das 05h: > 8 s.
--
-- (a) o máximo vem só das ATIVAS — quem a última lista da Caixa trouxe está ativo, então o máximo é o mesmo;
-- (b) índice (fonte, estado, atualizado_em) where ativo: o máximo por estado e o alvo saem do índice.
-- ─────────────────────────────────────────────────────────────────────────────────────────
create index if not exists idx_imoveis_ativo_fonte_estado_atualizado
  on public.imoveis_leilao (fonte, estado, atualizado_em) where ativo;

create or replace function public.desativar_imoveis_cef_vencidos_lote(margem interval default '1 day'::interval, lote integer default 200)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare n integer;
begin
  with mx as (
    select estado, max(atualizado_em) m
      from imoveis_leilao where fonte = 'CEF' and ativo group by estado
  ), alvo as (
    -- Busca POR ESTADO (lateral), direto no índice — o join comum virava 550 mil comparações (273 → 32 ms).
    select x.id from mx cross join lateral (
      select t.id, t.atualizado_em from imoveis_leilao t
       where t.fonte = 'CEF' and t.ativo = true and t.estado = mx.estado and t.atualizado_em < mx.m - margem
       order by t.atualizado_em
       limit greatest(1, least(lote, 1000))
    ) x
     order by x.atualizado_em
     limit greatest(1, least(lote, 1000))
  )
  update imoveis_leilao t set ativo = false, suprimido_motivo = 'sumiu_da_fonte'
    from alvo where t.id = alvo.id;
  get diagnostics n = row_count;
  return n;
end $function$;
