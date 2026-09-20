-- 20/09: trava de custo pra FIPE (pedido do dono — "resguardar pra evitar estrapolar o teto").
-- A API gratuita da FIPE libera 500 requisições/dia sem token; agora que o valor também é
-- buscado SOB DEMANDA (ao abrir a tela do veículo, não só pelo cron em lote), uma rajada de
-- aberturas de página em veículos ainda não cacheados poderia estourar a cota do dia.
-- Mesmo princípio já usado pro Bright Data (`registrar_uso_brightdata`/`brightdata_uso`):
-- reserva ATÔMICA no banco ANTES de cada chamada real — não um contador em memória por
-- execução (que não vê rajadas concorrentes) nem um "checar depois de gastar".
-- Teto do dia em 450 (não 500): folga de segurança contra variação de fuso/relógio entre o
-- reset da cota do provedor e o `current_date` daqui.
CREATE TABLE IF NOT EXISTS public.fipe_uso (
  dia date PRIMARY KEY,
  requests integer NOT NULL DEFAULT 0,
  teto integer NOT NULL DEFAULT 450,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

-- UPDATE ... WHERE requests < teto ... RETURNING é atômico sob MVCC do Postgres: duas
-- transações concorrentes na MESMA linha serializam (uma espera a outra), então não há
-- janela pra "duas leituras acharem espaço e as duas gravarem", diferente de um
-- select-depois-decide-depois-insere em passos separados.
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

  UPDATE public.fipe_uso SET requests = requests + 1, atualizado_em = now(), teto = p_teto
   WHERE dia = v_dia AND requests < teto
   RETURNING requests INTO v_requests;

  IF v_requests IS NULL THEN
    RETURN jsonb_build_object('permitido', false, 'motivo', 'teto_diario',
      'usado', (SELECT requests FROM public.fipe_uso WHERE dia = v_dia), 'teto', p_teto);
  END IF;

  RETURN jsonb_build_object('permitido', true, 'motivo', 'ok', 'usado', v_requests, 'teto', p_teto);
END;
$function$;
