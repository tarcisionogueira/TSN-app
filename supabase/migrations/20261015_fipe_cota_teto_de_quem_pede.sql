-- 15/10: registrar_uso_fipe comparava com o teto GRAVADO (o do lote noturno) e não com o de quem pede (tela):
-- depois do lote, a tela levava "cota esgotada" com consultas sobrando (dono: Renault Logan sem FIPE).
-- Cada chamador usa o PRÓPRIO teto; a coluna guarda o maior teto já pedido no dia (informativo).
-- Divisão (dono, 15/10): lote automático até 75% da cota útil, 25% sempre livre para a tela (api/_fipe.js).
CREATE OR REPLACE FUNCTION public.registrar_uso_fipe(p_teto integer DEFAULT 450)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_dia date := current_date;
  v_requests int;
BEGIN
  INSERT INTO public.fipe_uso (dia, requests, teto) VALUES (v_dia, 0, p_teto)
    ON CONFLICT (dia) DO NOTHING;

  UPDATE public.fipe_uso SET requests = requests + 1, atualizado_em = now(), teto = greatest(teto, p_teto)
   WHERE dia = v_dia AND requests < p_teto
   RETURNING requests INTO v_requests;

  IF v_requests IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'teto_diario',
      'usado', (SELECT requests FROM public.fipe_uso WHERE dia = v_dia), 'teto', p_teto);
  END IF;

  RETURN jsonb_build_object('permitido', true, 'motivo', 'ok', 'usado', v_requests, 'teto', p_teto);
END;
$function$;
