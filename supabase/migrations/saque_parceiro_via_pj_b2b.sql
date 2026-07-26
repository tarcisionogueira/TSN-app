-- Saque role-aware: PARCEIRO-CLIENTE (plano pago) recebe via PJ (B2B) — exige CNPJ + razão
-- social + PIX da empresa; EQUIPE operacional mantém o PIX pessoal (path INALTERADO).
-- Rede vazia hoje → branch de parceiro é inerte. Preserva atomicidade (advisory lock).
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
  v_parceiro boolean;
  v_pix_pag  text;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuário inválido');
  END IF;
  IF v_valor IS NULL OR v_valor <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Valor inválido');
  END IF;

  SELECT nome, cpf, cpf_hash, telefone, chave_pix, role, cnpj, razao_social, pj_chave_pix
    INTO v_perfil FROM perfis WHERE id = p_user_id;

  -- Parceiro-cliente (plano pago) recebe via PJ; equipe operacional via PIX pessoal.
  v_parceiro := v_perfil.role = ANY (ARRAY['top2','top2_anual','assessorado','assessorado_anual','clube','clube_anual']);

  IF v_perfil.nome IS NULL OR btrim(v_perfil.nome) = '' THEN v_faltando := array_append(v_faltando, 'nome'); END IF;
  IF (v_perfil.cpf IS NULL OR btrim(v_perfil.cpf) = '') AND v_perfil.cpf_hash IS NULL THEN v_faltando := array_append(v_faltando, 'CPF'); END IF;
  IF v_perfil.telefone IS NULL OR btrim(v_perfil.telefone) = '' THEN v_faltando := array_append(v_faltando, 'telefone'); END IF;

  IF v_parceiro THEN
    IF v_perfil.cnpj IS NULL OR btrim(v_perfil.cnpj) = '' THEN v_faltando := array_append(v_faltando, 'empresa (CNPJ)'); END IF;
    IF v_perfil.razao_social IS NULL OR btrim(v_perfil.razao_social) = '' THEN v_faltando := array_append(v_faltando, 'razão social'); END IF;
    IF v_perfil.pj_chave_pix IS NULL OR btrim(v_perfil.pj_chave_pix) = '' THEN v_faltando := array_append(v_faltando, 'PIX da empresa'); END IF;
    v_pix_pag := v_perfil.pj_chave_pix;
  ELSE
    IF v_perfil.chave_pix IS NULL OR btrim(v_perfil.chave_pix) = '' THEN v_faltando := array_append(v_faltando, 'chave PIX'); END IF;
    v_pix_pag := v_perfil.chave_pix;
  END IF;

  IF array_length(v_faltando, 1) > 0 THEN
    RETURN jsonb_build_object('ok', false,
      'error', 'Complete seu cadastro para sacar. Falta: ' || array_to_string(v_faltando, ', ') || '.',
      'faltando', to_jsonb(v_faltando));
  END IF;

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
          'Solicitação de saque para PIX ' || v_pix_pag, 'solicitado');

  RETURN jsonb_build_object('ok', true, 'saldo_restante', round(v_saldo - v_valor, 2));
END;
$$;
REVOKE ALL ON FUNCTION public.solicitar_saque_ledger(uuid, numeric) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.solicitar_saque_ledger(uuid, numeric) TO service_role;
