-- =====================================================================================
-- RATEIO DIÁRIO DA SUB-COTA DO BRIGHT DATA (decisão do dono, 18/08 noite)
--
-- O problema medido: a sub-cota semanal de `docs` (150) foi consumida INTEIRA na
-- segunda-feira — o backfill de documentos é guloso e queima a semana no primeiro dia.
-- Na terça à noite a conta global estava em 521/550, com 5 dias de semana pela frente.
--
-- `brightdata_reserva.teto_dia` espalha: propósito com teto_dia definido não passa daquele
-- número POR DIA, além de continuar sob a sub-cota semanal e o teto global. NULL = sem
-- rateio (comportamento idêntico ao anterior). O contador diário
-- (`brightdata_uso_proposito_dia`) é mantido para TODOS os propósitos — ligar o rateio de
-- outro no futuro é um UPDATE, sem correr atrás de histórico.
--
-- A recusa tem motivo PRÓPRIO (`subcota_dia`) e ele entrou no catálogo `semCota` de
-- `api/_brightdata.js` NO MESMO COMMIT — sem isso, o rateio chegaria aos coletores com
-- cara de fonte quebrada (a forma #5, de novo). No mesmo passe, `scraper-rj` trocou a
-- lista enumerada de motivos por `e.semCota`: a lista era a cópia que não receberia o
-- motivo novo.
--
-- A devolução por falha de rede (registrar_resultado com p_devolver) também decrementa o
-- contador diário — senão o rateio cobraria por chamada que nunca saiu.
--
-- VERIFICADO em transação desfeita, propósito de teste com teto_dia=2:
--   1º ok · 2º ok · 3º RECUSA subcota_dia · devolução reabre a vaga (2→1, volta a
--   permitir) · controle: `docs` hoje recusa por `subcota` SEMANAL (150/150 já gastos) —
--   o rateio passa a governar na segunda, com a semana nova.
-- Aplicado: teto_dia = 25 para `docs` (150 ÷ 7 ≈ 21; 25 dá folga num dia cheio, e o teto
-- semanal de 150 continua valendo por cima).
-- =====================================================================================

alter table public.brightdata_reserva add column if not exists teto_dia int;
comment on column public.brightdata_reserva.teto_dia is
  'Teto DIARIO do proposito (rateio da sub-cota semanal). NULL = sem rateio. Recusa com motivo subcota_dia — que os coletores tratam como sem_cota, nunca como falha da fonte.';

create table if not exists public.brightdata_uso_proposito_dia (
  dia date not null,
  proposito text not null,
  requests int not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (dia, proposito)
);
alter table public.brightdata_uso_proposito_dia enable row level security;

create or replace function public.brightdata_decisao(p_teto int, p_proposito text default 'geral')
returns jsonb language plpgsql stable as $$
declare
  v_semana          date := date_trunc('week', now())::date;
  v_prop            text := coalesce(nullif(trim(p_proposito), ''), 'geral');
  v_total           int;
  v_usado_p         int;
  v_usado_dia       int;
  v_reserva         int;
  v_teto_p          int;
  v_teto_dia        int;
  v_reservado_alheio int;
  v_limite          int;
  v_teto            int;
begin
  select coalesce(
    (select teto from brightdata_uso where semana = v_semana and teto is not null),
    (select teto from brightdata_uso where teto is not null order by semana desc limit 1),
    p_teto
  ) into v_teto;

  select coalesce(reserva, 0), teto, teto_dia into v_reserva, v_teto_p, v_teto_dia
    from brightdata_reserva where proposito = v_prop;
  v_reserva := coalesce(v_reserva, 0);

  select coalesce(requests, 0) into v_total from brightdata_uso where semana = v_semana;
  v_total := coalesce(v_total, 0);

  select coalesce(requests, 0) into v_usado_p
    from brightdata_uso_proposito where semana = v_semana and proposito = v_prop;
  v_usado_p := coalesce(v_usado_p, 0);

  -- RATEIO DIARIO: checado ANTES da sub-cota semanal — a recusa do dia e mais
  -- informativa ("volta amanha") que a da semana ("volta segunda").
  if v_teto_dia is not null then
    select coalesce(requests, 0) into v_usado_dia
      from brightdata_uso_proposito_dia where dia = current_date and proposito = v_prop;
    v_usado_dia := coalesce(v_usado_dia, 0);
    if v_usado_dia >= v_teto_dia then
      return jsonb_build_object('permitido', false, 'motivo', 'subcota_dia',
        'proposito', v_prop, 'usado_dia', v_usado_dia, 'teto_dia', v_teto_dia,
        'usado', v_usado_p, 'teto', v_teto_p, 'usado_total', v_total, 'teto_global', v_teto);
    end if;
  end if;

  if v_teto_p is not null and v_usado_p >= v_teto_p then
    return jsonb_build_object('permitido', false, 'motivo', 'subcota',
      'proposito', v_prop, 'usado', v_usado_p, 'teto', v_teto_p, 'usado_total', v_total,
      'teto_global', v_teto);
  end if;

  select coalesce(sum(greatest(0, r.reserva - coalesce(u.requests, 0))), 0)
    into v_reservado_alheio
    from brightdata_reserva r
    left join brightdata_uso_proposito u
           on u.proposito = r.proposito and u.semana = v_semana
   where r.proposito <> v_prop and r.reserva > 0;

  v_limite := case
    when v_usado_p < v_reserva then v_teto + (v_reserva - v_usado_p)
    else v_teto - v_reservado_alheio
  end;

  if v_total >= v_limite then
    return jsonb_build_object('permitido', false,
      'motivo', case when v_total >= v_teto then 'teto_global' else 'reservado_para_outros' end,
      'proposito', v_prop, 'usado', v_usado_p, 'usado_total', v_total,
      'teto', v_teto, 'teto_pedido', p_teto, 'reservado_alheio', v_reservado_alheio,
      'limite', v_limite);
  end if;

  return jsonb_build_object('permitido', true, 'motivo', 'ok', 'proposito', v_prop,
    'usado', v_usado_p, 'usado_dia', coalesce(v_usado_dia, 0), 'usado_total', v_total,
    'teto', v_teto, 'teto_pedido', p_teto, 'reserva', v_reserva, 'subcota', v_teto_p,
    'subcota_dia', v_teto_dia, 'limite', v_limite);
end
$$;

create or replace function public.registrar_uso_brightdata(p_teto int, p_proposito text default 'geral')
returns jsonb language plpgsql as $$
declare
  v_semana date := date_trunc('week', now())::date;
  v_prop   text := coalesce(nullif(trim(p_proposito), ''), 'geral');
  d        jsonb := public.brightdata_decisao(p_teto, p_proposito);
  v_teto   int   := (d->>'teto')::int;
begin
  if (d->>'permitido')::boolean is not true then
    return d;
  end if;

  insert into brightdata_uso (semana, requests, teto) values (v_semana, 1, v_teto)
    on conflict (semana) do update
      set requests = brightdata_uso.requests + 1, teto = excluded.teto, atualizado_em = now();

  insert into brightdata_uso_proposito (semana, proposito, requests) values (v_semana, v_prop, 1)
    on conflict (semana, proposito) do update
      set requests = brightdata_uso_proposito.requests + 1, atualizado_em = now();

  -- Contador DIARIO (rateio): mantido para TODOS os propositos.
  insert into brightdata_uso_proposito_dia (dia, proposito, requests) values (current_date, v_prop, 1)
    on conflict (dia, proposito) do update
      set requests = brightdata_uso_proposito_dia.requests + 1, atualizado_em = now();

  return d || jsonb_build_object(
    'usado', (d->>'usado')::int + 1,
    'usado_total', (d->>'usado_total')::int + 1);
end
$$;

create or replace function public.registrar_resultado_brightdata(p_proposito text, p_ok boolean, p_devolver boolean default false)
returns void language plpgsql as $$
declare
  v_semana date := date_trunc('week', now())::date;
  v_prop   text := coalesce(nullif(trim(p_proposito), ''), 'geral');
begin
  update public.brightdata_uso_proposito
     set sucessos    = sucessos + (case when p_ok then 1 else 0 end),
         falhas_rede = falhas_rede + (case when p_ok then 0 else 1 end),
         requests    = greatest(0, requests - (case when p_devolver then 1 else 0 end)),
         atualizado_em = now()
   where semana = v_semana and proposito = v_prop;

  if p_devolver then
    update public.brightdata_uso
       set requests = greatest(0, requests - 1), atualizado_em = now()
     where semana = v_semana;
    -- Devolucao tambem no contador diario — senao o rateio cobra por chamada que nao saiu.
    update public.brightdata_uso_proposito_dia
       set requests = greatest(0, requests - 1), atualizado_em = now()
     where dia = current_date and proposito = v_prop;
  end if;
end
$$;

update public.brightdata_reserva set teto_dia = 25 where proposito = 'docs';
