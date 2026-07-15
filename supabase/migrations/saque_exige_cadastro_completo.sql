-- Saque exige CADASTRO COMPLETO (nome, CPF, telefone e chave PIX), além de saldo.
-- Antes a RPC só exigia a chave PIX. Agora retorna também a lista do que falta
-- ('faltando') para a tela apontar ao profissional o que preencher para liberar o saque.
-- Mantém a atomicidade (advisory lock + checagem de saldo na mesma transação).
CREATE OR REPLACE FUNCTION public.solicitar_saque_ledger(p_user_id uuid, p_valor numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_perfil   record;
  v_faltando text[] := '{}';
  v_saldo    numeric;
  v_valor    numeric := round(p_valor::numeric, 2);
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário inválido');
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor inválido');
  END IF;

  -- Cadastro completo é pré-requisito do saque (pagamento + fiscal). O CPF conta como
  -- presente se houver texto claro (legado) OU o hash (cpf-set cifra e zera o texto).
  SELECT nome, cpf, cpf_hash, telefone, chave_pix INTO v_perfil FROM perfis WHERE id = p_user_id;
  IF v_perfil.nome IS NULL OR btrim(v_perfil.nome) = '' THEN v_faltando := array_append(v_faltando, 'nome'); END IF;
  IF (v_perfil.cpf IS NULL OR btrim(v_perfil.cpf) = '') AND v_perfil.cpf_hash IS NULL THEN v_faltando := array_append(v_faltando, 'CPF'); END IF;
  IF v_perfil.telefone IS NULL OR btrim(v_perfil.telefone) = '' THEN v_faltando := array_append(v_faltando, 'telefone'); END IF;
  IF v_perfil.chave_pix IS NULL OR btrim(v_perfil.chave_pix) = '' THEN v_faltando := array_append(v_faltando, 'chave PIX'); END IF;
  IF array_length(v_faltando, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Complete seu cadastro para sacar. Falta: ' || array_to_string(v_faltando, ', ') || '.',
      'faltando', to_jsonb(v_faltando));
  END IF;

  -- Serializa concorrência POR usuário até o fim da transação (evita a corrida).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

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
          'Solicitação de saque para PIX ' || v_perfil.chave_pix, 'solicitado');

  RETURN jsonb_build_object('ok', true, 'saldo_restante', round(v_saldo - v_valor, 2));
END;
$$;
REVOKE ALL ON FUNCTION public.solicitar_saque_ledger(uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_saque_ledger(uuid, numeric) TO service_role;
