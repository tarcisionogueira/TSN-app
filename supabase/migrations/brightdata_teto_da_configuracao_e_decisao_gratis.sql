-- =====================================================================================
-- TRÊS LEILOEIROS PASSARAM 5 DIAS SEM COLETA, COM O ACERVO INTACTO (18/08)
--
-- CALIL, VEGAS e GESTAOLEILOES não coletaram nenhuma manhã entre 14 e 18/08. O acervo
-- estava íntegro o tempo todo (95 · 21 · 130 lotes) e `tocados_24h = 0` nos três. A coleta
-- da TARDE, quando havia, passava — mesma fonte, mesmo dia, mesmo site.
--
-- A causa não era a fonte nem o orçamento: era QUEM PERGUNTA. `registrar_uso_brightdata`
-- recebia o teto por PARÂMETRO. `api/_brightdata.js` manda `BRIGHTDATA_MAX_REQ_SEMANA || 450`;
-- os disparos manuais mandavam 520 — o número que o dono escolheu e que está gravado em
-- `brightdata_uso.teto`. Medido em 18/08, com 488 usados e 26 reservados para outros:
--
--     pergunta com 450 → limite 450 - 26 = 424 → 488 >= 424 → RECUSA (teto_global)
--     pergunta com 520 → limite 520 - 26 = 494 → 488 <  494 → PERMITE
--
-- Mesmo instante, mesma fonte, respostas opostas. O freio de custo estava certo; o número
-- é que não era um só. E o sintoma chegou como "fonte quebrada" — a forma #5 da lista do
-- CLAUDE.md: o freio de orçamento entregue como regressão da fonte.
--
-- DUAS MUDANÇAS, e a segunda é a que evita o próximo erro:
--
-- 1. O teto efetivo vem da CONFIGURAÇÃO: teto da semana → último teto configurado →
--    `p_teto` (só quando nunca houve configuração). NÃO afrouxa o freio: o número passa a
--    ser um só, e é o que o dono escolheu. Para mudar, escreva em `brightdata_uso.teto`;
--    mexer na env de um dos chamadores só vale para ele — foi exatamente esse o defeito.
--
-- 2. A DECISÃO virou função própria, `stable`, sem escrita (`brightdata_decisao`), e a
--    reserva passou a DELEGAR a ela. Antes, `registrar_uso_brightdata` era reserva atômica
--    — CONCEDE ao responder — e em 18/08 foi usada como sonda: o ledger da PECINI ficou com
--    uma permissão concedida e nunca gasta (requests 69 · sucessos 68). O CLAUDE.md passou a
--    avisar "não use a função de reserva para conferir", mas ler as tabelas soltas NÃO
--    reproduz a regra (reserva de terceiros, sub-cota, teto efetivo): a única forma de saber
--    a resposta era gastar por ela. Agora dá para perguntar de graça, e não existe segunda
--    cópia da regra para divergir.
--
-- VERIFICADO em transação desfeita: com o contador em 520 e em 999 a resposta continua
-- `permitido: false / teto_global`, e a sub-cota de `docs` (150/150) continua recusando.
-- O freio continua freando — o que mudou é que ele responde a mesma coisa para todos.
-- =====================================================================================

create or replace function public.brightdata_decisao(p_teto int, p_proposito text default 'geral')
returns jsonb language plpgsql stable as $$
declare
  v_semana          date := date_trunc('week', now())::date;
  v_prop            text := coalesce(nullif(trim(p_proposito), ''), 'geral');
  v_total           int;
  v_usado_p         int;
  v_reserva         int;
  v_teto_p          int;
  v_reservado_alheio int;
  v_limite          int;
  v_teto            int;
begin
  -- O teto vem da CONFIGURACAO, nao do chamador. Ver o cabecalho desta migracao.
  select coalesce(
    (select teto from brightdata_uso where semana = v_semana and teto is not null),
    (select teto from brightdata_uso where teto is not null order by semana desc limit 1),
    p_teto
  ) into v_teto;

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
    'usado', v_usado_p, 'usado_total', v_total, 'teto', v_teto, 'teto_pedido', p_teto,
    'reserva', v_reserva, 'subcota', v_teto_p, 'limite', v_limite);
end
$$;

comment on function public.brightdata_decisao(int, text) is
  'Diz o que o freio RESPONDERIA, sem gastar nada (stable, sem escrita). Use esta para conferir cota. registrar_uso_brightdata chama exatamente esta funcao antes de reservar — uma regra so.';

-- A reserva DELEGA a decisao: nao ha segunda copia da regra.
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

  -- Devolve os contadores JA incrementados (o chamador loga a permissao concedida).
  return d || jsonb_build_object(
    'usado', (d->>'usado')::int + 1,
    'usado_total', (d->>'usado_total')::int + 1);
end
$$;

comment on function public.registrar_uso_brightdata(int, text) is
  'Reserva ATOMICA de 1 request do Bright Data — CONCEDE ao responder permitido=true. Para apenas CONFERIR, use brightdata_decisao (nao gasta). Delega a decisao a ela: uma regra so. O teto efetivo vem de brightdata_uso.teto, nao do p_teto do chamador — em 18/08 chamadores com defaults diferentes (450 vs 520) recebiam respostas opostas no mesmo instante, e tres leiloeiros passaram 5 dias sem coleta com o acervo intacto.';
