-- ═══════════════════════════════════════════════════════════════════════════════
-- BRIGHT DATA — relatório de CLIENTE nunca é travado pelo teto semanal (12/09)
-- ═══════════════════════════════════════════════════════════════════════════════
-- DECISÃO DO DONO: "os relatorios não devem ser travados pelo teto de gasto semanal.
-- resolva isso. Atribua tudo de consumo apenas a busca dos leiloeiros." — ou seja,
-- o teto/reserva existe para conter o CUSTO DE COLETA (scraper de leiloeiro por
-- leiloeiro), não para decidir se um cliente que já pagou recebe o relatório dele.
-- O reforço de reserva feito hoje mais cedo (20/semana p/ 'certidao') ainda deixava
-- o DJEN sujeito a ficar sem crédito numa semana ruim — o pedido agora é mais
-- forte: ISENÇÃO, não fatia maior do mesmo bolo.
--
-- O QUE MUDA:
--   1. Nova coluna `isento_teto` em brightdata_reserva — o propósito usado
--      exclusivamente por geração de relatório (hoje: 'certidao', que cobre
--      DJEN/Comunica CNJ dentro de api/gerar-documental.js) nunca é bloqueado.
--   2. brightdata_decisao verifica a isenção ANTES de qualquer checagem de teto
--      diário/sub-cota/global e devolve permitido:true direto — a contagem de
--      USO continua acontecendo (registrar_uso_brightdata grava normalmente; só
--      o BLOQUEIO é que não se aplica), então o custo real continua visível no
--      ledger para acompanhamento, só não é mais motivo pra travar o cliente.
--   3. Todo o resto (bayit, docs, emiliomatos, gestao, leilaopro, ljud, pecini,
--      radar, recon, rj, soleon, vlance, geral, geral_cliente) segue exatamente
--      como estava — o teto continua real para a busca/coleta dos leiloeiros.
--      Efeito colateral bom: a reserva de 'certidao' (isenta) deixa de "roubar"
--      espaço do bolo compartilhado dos demais — reservado_alheio some para ela.

alter table public.brightdata_reserva
  add column if not exists isento_teto boolean not null default false;

update public.brightdata_reserva
   set isento_teto = true,
       descricao = 'Laudo/certidões (DJEN/Comunica CNJ) — usado SÓ na geração de relatório '
         || 'do cliente. Isento do teto semanal (12/09, decisão do dono: relatório não pode '
         || 'ser travado por orçamento de coleta) — o consumo segue registrado no ledger, só '
         || 'não é mais motivo de bloqueio.',
       atualizado_em = now()
 where proposito = 'certidao';

create or replace function public.brightdata_decisao(
  p_teto integer,
  p_proposito text default 'geral'::text
) returns jsonb
language plpgsql
stable
set search_path to 'public'
as $function$
declare
  v_semana          date := date_trunc('week', now())::date;
  v_prop            text := coalesce(nullif(trim(p_proposito), ''), 'geral');
  v_total           int;
  v_usado_p         int;
  v_usado_dia       int;
  v_reserva         int;
  v_teto_p          int;
  v_teto_dia        int;
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

  select coalesce(reserva, 0), teto, teto_dia, coalesce(isento_teto, false)
    into v_reserva, v_teto_p, v_teto_dia, v_isento
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
    'subcota_dia', v_teto_dia, 'limite', v_limite);
end
$function$;

revoke execute on function public.brightdata_decisao(integer, text) from public, anon, authenticated;
grant  execute on function public.brightdata_decisao(integer, text) to service_role;
