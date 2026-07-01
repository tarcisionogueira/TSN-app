-- ════════════════════════════════════════════════════════════════════════════
-- Saque atômico — elimina a corrida read-then-write do /api/saque
-- Rodar no SQL Editor do Supabase. Aditivo e idempotente.
--
-- Problema: api/saque.js lia o saldo (SUM do ledger) e DEPOIS inseria o
-- lançamento de saque. Dois POSTs simultâneos liam o mesmo saldo e ambos
-- passavam na checagem → saldo podia ficar negativo (saque a mais).
--
-- Solução: uma função que serializa por usuário (advisory lock transacional)
-- e faz checagem + inserção na MESMA transação. Chamada só pelo servidor
-- (service_role) passando o user_id já autenticado no edge (getAuthUser).
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.solicitar_saque_ledger(p_user_id uuid, p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pix   text;
  v_saldo numeric;
  v_valor numeric := round(p_valor::numeric, 2);
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário inválido');
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor inválido');
  END IF;

  -- Serializa concorrência POR usuário até o fim da transação (evita a corrida).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  SELECT chave_pix INTO v_pix FROM perfis WHERE id = p_user_id;
  IF v_pix IS NULL OR btrim(v_pix) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'Cadastre sua chave PIX no perfil antes de solicitar saque.');
  END IF;

  -- Saldo = créditos − saques (solicitados reservam; cancelados ignorados).
  -- Mesma fórmula da view saldo_usuarios.
  SELECT COALESCE(SUM(valor), 0) INTO v_saldo
  FROM saldo_lancamentos
  WHERE user_id = p_user_id AND status <> 'cancelado';

  IF v_valor > v_saldo THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Saldo insuficiente. Disponível: R$ ' || to_char(v_saldo, 'FM999999990.00'),
      'saldo', v_saldo);
  END IF;

  INSERT INTO saldo_lancamentos (user_id, tipo, valor, descricao, status)
  VALUES (p_user_id, 'saque', -v_valor,
          'Solicitação de saque para PIX ' || v_pix, 'solicitado');

  RETURN jsonb_build_object('ok', true, 'saldo_restante', round(v_saldo - v_valor, 2));
END;
$$;

-- Só o servidor (service_role) chama; nunca exposto ao cliente autenticado/anon.
REVOKE ALL ON FUNCTION public.solicitar_saque_ledger(uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_saque_ledger(uuid, numeric) TO service_role;
