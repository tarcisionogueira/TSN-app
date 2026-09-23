-- ─────────────────────────────────────────────────────────────────────────────────────────
-- CEF: VENDIDO inferido pela SAÍDA da lista da Caixa logo após o leilão — 23/09/2026
--
-- Pedido do dono: "identificar os vendidos da CEF". A página de detalhe da Caixa está fechada
-- (Radware CAPTCHA para node:https E fetch, inclusive do GitHub — recon 35880941738). O que
-- sobra é o CSV diário, que o coletor regrava inteiro todo dia (`atualizado_em`).
-- MEDIDO (leilões dos últimos 60 dias):
--   · não vendido VOLTA com o MESMO número como venda online/direta (1.909 — gatilho de sem lance);
--   · 5.641 SAÍRAM da lista; 4.844 saíram até 7 dias DEPOIS da data do leilão, 255 antes;
--   · só 3 dos 5.641 reapareceram no mesmo endereço com OUTRO número — a Caixa não relista
--     não-vendido com número novo.
-- Logo: sair da lista a partir da véspera do leilão = VENDIDO, com margem pequena de
-- retirada/suspensão. Por ser inferência, grava `resultado_origem='inferido_lista_caixa'`.
-- Saiu ANTES da véspera = retirada/suspensão, não venda → fica sem resultado.
-- ─────────────────────────────────────────────────────────────────────────────────────────
alter table public.imoveis_leilao add column if not exists resultado_origem text;

create or replace function public.apurar_vendidos_cef()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with uf as (
    select estado, max(atualizado_em) m from imoveis_leilao where fonte = 'CEF' group by estado
  )
  update imoveis_leilao i
     set resultado_leilao = 'vendido', resultado_origem = 'inferido_lista_caixa', resultado_apurado_em = now()
    from uf
   where uf.estado = i.estado
     and i.fonte = 'CEF'
     and i.modalidade in ('extrajudicial', 'licitacao_aberta')
     and (i.resultado_leilao is null or i.resultado_leilao = 'indeterminado')
     and i.data_leilao ~ '^\d{4}-\d{2}-\d{2}'
     and i.data_leilao::date < current_date
     and i.atualizado_em < uf.m - interval '2 days'             -- saiu da lista (a UF seguiu sendo regravada)
     and i.atualizado_em::date >= i.data_leilao::date - 1;      -- e saiu a partir da véspera do leilão
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function public.apurar_vendidos_cef() from public, anon, authenticated;
grant execute on function public.apurar_vendidos_cef() to service_role;

-- A relistagem (sem lance) também diz de onde veio.
create or replace function public.trg_cef_sem_lance_por_relistagem()
 returns trigger language plpgsql set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.fonte = 'CEF'
     and coalesce(old.modalidade,'') in ('extrajudicial','licitacao_aberta')
     and coalesce(new.modalidade,'') ~* 'venda[_ -]?(direta|online)'
     and (new.resultado_leilao is null or new.resultado_leilao = 'indeterminado')
  then
    new.resultado_leilao := 'sem_lance';
    new.resultado_origem := 'relistagem_caixa';
    new.resultado_apurado_em := now();
  end if;
  return new;
end;
$function$;
update public.imoveis_leilao set resultado_origem = 'relistagem_caixa'
 where fonte = 'CEF' and resultado_leilao = 'sem_lance' and resultado_origem is null;

select public.apurar_vendidos_cef() as vendidos_marcados;
