-- ─────────────────────────────────────────────────────────────────────────────────────────
-- O ALARME DO TETO ESTAVA CALIBRADO NUM NÚMERO QUE SE MOVEU — 17/08/2026
--
-- `bd_teto_saturado` compara os requests da semana contra o literal **405** (90% de 450, o
-- padrão histórico). Desde hoje o teto é PARÂMETRO DE DISPARO (`teto_semana` no workflow da
-- PECINI, 500 na rodada de ontem à noite) e o banco não tem onde lê-lo: `brightdata_uso` só
-- guarda a contagem. Resultado imediato: 429 requests acusando "perto do teto" contra um teto
-- que na verdade era 500 — o alarme erra para o lado seguro, mas erra.
--
-- Por que isso não é detalhe: um alarme que dispara sem motivo é um alarme que as pessoas
-- aprendem a ignorar, e aí ele não serve para o caso em que estiver certo. E o número que ele
-- deveria vigiar EXISTE — `registrar_uso_brightdata(p_teto, …)` recebe o teto em toda chamada,
-- usa para decidir, e joga fora.
--
-- Conserto: a própria reserva grava o teto vigente na linha da semana, e o invariante passa a
-- comparar contra 90% DELE. Sem coluna preenchida (semanas anteriores a esta migração), cai no
-- 450 histórico — o limite continua 405 e nada muda para trás.
--
-- Fica registrado o que este conserto NÃO faz: o teto é o da ÚLTIMA chamada permitida da
-- semana, não o maior já usado. É de propósito — o que interessa ao alarme é o teto que a
-- PRÓXIMA chamada vai encontrar, não o mais generoso que alguém já pediu um dia.
-- ─────────────────────────────────────────────────────────────────────────────────────────

alter table public.brightdata_uso add column if not exists teto integer;

comment on column public.brightdata_uso.teto is
  'Teto semanal (BRIGHTDATA_MAX_REQ_SEMANA) em vigor na ULTIMA chamada permitida da semana. '
  'Gravado por registrar_uso_brightdata; lido pelo invariante bd_teto_saturado.';

create or replace function public.registrar_uso_brightdata(p_teto integer, p_proposito text default 'geral'::text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_semana          date := date_trunc('week', now())::date;
  v_prop            text := coalesce(nullif(trim(p_proposito), ''), 'geral');
  v_total           int;
  v_usado_p         int;
  v_reserva         int;
  v_teto_p          int;
  v_reservado_alheio int;
  v_limite          int;
begin
  select coalesce(reserva, 0), teto into v_reserva, v_teto_p
    from brightdata_reserva where proposito = v_prop;
  v_reserva := coalesce(v_reserva, 0);

  select coalesce(requests, 0) into v_total from brightdata_uso where semana = v_semana;
  v_total := coalesce(v_total, 0);

  select coalesce(requests, 0) into v_usado_p
    from brightdata_uso_proposito where semana = v_semana and proposito = v_prop;
  v_usado_p := coalesce(v_usado_p, 0);

  if v_teto_p is not null and v_usado_p >= v_teto_p then
    return jsonb_build_object('permitido', false, 'motivo', 'subcota',
      'proposito', v_prop, 'usado', v_usado_p, 'teto', v_teto_p, 'usado_total', v_total);
  end if;

  select coalesce(sum(greatest(0, r.reserva - coalesce(u.requests, 0))), 0)
    into v_reservado_alheio
    from brightdata_reserva r
    left join brightdata_uso_proposito u
           on u.proposito = r.proposito and u.semana = v_semana
   where r.proposito <> v_prop and r.reserva > 0;

  v_limite := case
    when v_usado_p < v_reserva then p_teto + (v_reserva - v_usado_p)
    else p_teto - v_reservado_alheio
  end;

  if v_total >= v_limite then
    return jsonb_build_object('permitido', false,
      'motivo', case when v_total >= p_teto then 'teto_global' else 'reservado_para_outros' end,
      'proposito', v_prop, 'usado', v_usado_p, 'usado_total', v_total,
      'teto', p_teto, 'reservado_alheio', v_reservado_alheio);
  end if;

  -- ÚNICA MUDANÇA DE COMPORTAMENTO: o teto em vigor passa a ficar gravado junto da contagem.
  insert into brightdata_uso (semana, requests, teto) values (v_semana, 1, p_teto)
    on conflict (semana) do update
      set requests = brightdata_uso.requests + 1, teto = excluded.teto, atualizado_em = now();

  insert into brightdata_uso_proposito (semana, proposito, requests) values (v_semana, v_prop, 1)
    on conflict (semana, proposito) do update
      set requests = brightdata_uso_proposito.requests + 1, atualizado_em = now();

  return jsonb_build_object('permitido', true, 'motivo', 'ok', 'proposito', v_prop,
    'usado', v_usado_p + 1, 'usado_total', v_total + 1, 'teto', p_teto,
    'reserva', v_reserva, 'subcota', v_teto_p);
end $function$;

-- Semeia a semana corrente com o teto que de fato esteve em vigor na última rodada (500),
-- para o alarme parar de gritar contra 405 antes mesmo da próxima chamada.
update public.brightdata_uso set teto = 500 where semana = date_trunc('week', now())::date and teto is null;

-- Invariante passa a ler o teto gravado (90% dele). Sem teto na linha, 450 — o valor
-- histórico — e o limite continua sendo os mesmos 405 de antes.
do $do$
declare def text; antes text; depois text;
begin
  select pg_get_functiondef(oid) into def from pg_proc where proname = 'qa_invariantes';

  antes := $a$     ('bd_teto_saturado','Bright Data: cota semanal perto do teto','Captura','bug',
       (select coalesce(requests,0) from brightdata_uso where semana = date_trunc('week', now())::date), 405)$a$;

  depois := $b$     ('bd_teto_saturado','Bright Data: cota semanal perto do teto','Captura','bug',
       (select coalesce(requests,0) from brightdata_uso where semana = date_trunc('week', now())::date),
       coalesce((select round(coalesce(teto,450) * 0.9)::int from brightdata_uso where semana = date_trunc('week', now())::date), 405))$b$;

  if position(antes in def) = 0 then
    if position('coalesce(teto,450) * 0.9' in def) > 0 then
      raise notice 'invariante ja dinamico — nada a fazer';
      return;
    end if;
    raise exception 'ancora bd_teto_saturado nao encontrada em qa_invariantes()';
  end if;

  execute replace(def, antes, depois);
  raise notice 'bd_teto_saturado agora le o teto vigente';
end $do$;
