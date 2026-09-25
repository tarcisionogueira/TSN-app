-- RATEIO POR TURNO da subcota diária (25/09, pedido do dono: "aumentar a eficiência com economia").
--
-- Medido em 24 e 25/09: a subcota diária `geral` (25/dia) acabava entre 00:00 e 00:07 UTC —
-- `apurar-resultado-leilao-cron` roda de 3 em 3 h e a PRIMEIRA rodada do dia (00h UTC) levava os
-- 25 créditos. As outras 7 rodadas, `enriquecer-datas-cron` (13h/20h) e `enriquecer-backfill-cron`
-- (16h30) passavam o dia recebendo "subcota_dia". Mesmo gasto, pior distribuição.
--
-- Agora o propósito pode declarar `rateio_turnos` (nulo = comportamento antigo). Com 4 turnos, o
-- acumulado liberado até cada turno é ceil(teto_dia × turno/4): 7 · 13 · 19 · 25 para `geral`.
-- Sobra de um turno passa para o seguinte (é acumulado, não "use ou perca"). Não muda o total
-- diário nem o semanal — só QUANDO ele pode ser gasto. Recusa com o MESMO motivo `subcota_dia`
-- (todos os chamadores — _brightdata.js `semCota`, bd-ledger.mjs, scraper_vlance.py — já sabem
-- tratar), com `turno` e `liberado_ate_agora` a mais para o diagnóstico.
-- Hora em UTC, a mesma base de `current_date` que o contador diário usa.

alter table public.brightdata_reserva add column if not exists rateio_turnos int
  check (rateio_turnos is null or rateio_turnos between 2 and 24);

update public.brightdata_reserva set rateio_turnos = 4 where proposito = 'geral';

CREATE OR REPLACE FUNCTION public.brightdata_decisao(p_teto integer, p_proposito text DEFAULT 'geral'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
declare
  v_semana          date := date_trunc('week', now())::date;
  v_prop            text := coalesce(nullif(trim(p_proposito), ''), 'geral');
  v_total           int;
  v_usado_p         int;
  v_usado_dia       int;
  v_reserva         int;
  v_teto_p          int;
  v_teto_dia        int;
  v_turnos          int;
  v_turno           int;
  v_liberado        int;
  v_isento          boolean;
  v_reservado_alheio int;
  v_limite          int;
  v_teto            int;
begin
  select coalesce(
    (select teto from brightdata_uso where semana = v_semana and teto is not null),
    (select teto from brightdata_uso where teto is not null order by semana desc limit 1),
    p_teto
  ) into v_teto;

  select coalesce(reserva, 0), teto, teto_dia, coalesce(isento_teto, false), rateio_turnos
    into v_reserva, v_teto_p, v_teto_dia, v_isento, v_turnos
    from brightdata_reserva where proposito = v_prop;
  v_reserva := coalesce(v_reserva, 0);
  v_isento := coalesce(v_isento, false);

  select coalesce(requests, 0) into v_total from brightdata_uso where semana = v_semana;
  v_total := coalesce(v_total, 0);

  select coalesce(requests, 0) into v_usado_p
    from brightdata_uso_proposito where semana = v_semana and proposito = v_prop;
  v_usado_p := coalesce(v_usado_p, 0);

  -- ISENÇÃO (12/09): propósito de RELATÓRIO — nunca travado, decisão do dono.
  -- Vem ANTES de qualquer checagem de rateio diário, sub-cota ou teto global.
  if v_isento then
    return jsonb_build_object('permitido', true, 'motivo', 'isento_relatorio',
      'proposito', v_prop, 'usado', v_usado_p, 'usado_total', v_total,
      'teto', v_teto, 'teto_pedido', p_teto);
  end if;

  -- RATEIO DIARIO (18/08): checado ANTES da sub-cota semanal — a recusa do dia e mais
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
    -- RATEIO POR TURNO (25/09): acumulado liberado até o turno atual.
    if v_turnos is not null then
      v_turno := floor(extract(hour from (now() at time zone 'UTC')) * v_turnos / 24)::int + 1;
      v_liberado := ceil(v_teto_dia::numeric * v_turno / v_turnos)::int;
      if v_usado_dia >= v_liberado then
        return jsonb_build_object('permitido', false, 'motivo', 'subcota_dia',
          'proposito', v_prop, 'usado_dia', v_usado_dia, 'teto_dia', v_teto_dia,
          'turno', v_turno, 'turnos', v_turnos, 'liberado_ate_agora', v_liberado,
          'usado', v_usado_p, 'teto', v_teto_p, 'usado_total', v_total, 'teto_global', v_teto);
      end if;
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
   where r.proposito <> v_prop and r.reserva > 0 and coalesce(r.isento_teto, false) = false;

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
    'subcota_dia', v_teto_dia, 'limite', v_limite,
    'turno', v_turno, 'liberado_ate_agora', v_liberado);
end
$function$;
