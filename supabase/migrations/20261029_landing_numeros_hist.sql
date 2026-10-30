-- 29/10 — HISTÓRICO DIÁRIO DOS NÚMEROS DA PÁGINA INICIAL. Pedido do dono ("verifique se estes números estão
-- aumentando"): `app_config.landing_numeros` é sobrescrito a cada `landing_numeros_atualizar()` (monitor-fontes-cron),
-- então de veículos, cidades e leiloeiros não havia como ver a evolução — só imóveis, reconstruído de
-- `fonte_metricas_hist`. Agora cada gravação de `landing_numeros` deixa o retrato do dia aqui (o último do dia vence).
--
-- Gatilho em `app_config` em vez de mexer em `landing_numeros_atualizar()`: o cálculo (e a vitrine) ficam intocados, e
-- qualquer caminho que regrave a chave alimenta o histórico.
create table if not exists public.landing_numeros_hist (
  dia date primary key,
  imoveis integer,
  veiculos integer,
  cidades integer,
  leiloeiros integer,
  em timestamptz not null default now(),
  origem text not null default 'landing_numeros'
);
comment on table public.landing_numeros_hist is
  'Retrato diário dos números da página inicial (imóveis, veículos, cidades, leiloeiros). Alimentado por gatilho em app_config(landing_numeros); dias antes de 29/10/2026 só com imóveis, de fonte_metricas_hist.';
-- Só o banco/serviço lê e grava (sem policy = nega anon/authenticated).
alter table public.landing_numeros_hist enable row level security;

create or replace function public.landing_numeros_hist_registrar()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  begin
    v := new.value::jsonb;
  exception when others then
    return new; -- valor ilegível: o histórico não pode derrubar a gravação da página inicial
  end;
  insert into public.landing_numeros_hist (dia, imoveis, veiculos, cidades, leiloeiros, em)
  values ((now() at time zone 'America/Sao_Paulo')::date,
          (v->>'imoveis')::int, (v->>'veiculos')::int, (v->>'cidades')::int, (v->>'leiloeiros')::int, now())
  on conflict (dia) do update set imoveis = excluded.imoveis, veiculos = excluded.veiculos, cidades = excluded.cidades,
    leiloeiros = excluded.leiloeiros, em = excluded.em, origem = 'landing_numeros';
  return new;
end $function$;

drop trigger if exists trg_landing_numeros_hist on public.app_config;
create trigger trg_landing_numeros_hist
  after insert or update of value on public.app_config
  for each row when (new.key = 'landing_numeros')
  execute function public.landing_numeros_hist_registrar();

-- Carga inicial: imóveis por dia a partir do histórico por fonte (a mesma soma bate com o número do dia: 29/10
-- 38.586 × 38.595). Veículos, cidades e leiloeiros ficam nulos nesses dias — não há de onde reconstruir.
insert into public.landing_numeros_hist (dia, imoveis, em, origem)
select dia, sum(ativos)::int, max(dia)::timestamptz, 'fonte_metricas_hist'
  from public.fonte_metricas_hist
 where fonte not like '%\_VEICULOS'
 group by dia
on conflict (dia) do nothing;

-- O retrato de hoje com os 4 números (dispara o gatilho com o valor atual).
update public.app_config set value = value where key = 'landing_numeros';
