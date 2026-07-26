-- GATE anti-interposição no SAQUE do parceiro-cliente (pedido do dono / plano §12.9).
-- Antes: o saque de parceiro só exigia os 3 campos de TEXTO (cnpj, razao_social, pj_chave_pix)
-- preenchidos — sem validar a PJ, sem conferir se o CPF do parceiro é sócio do CNPJ, sem NF.
-- Pagar comissão a uma "PJ" não verificada é risco de INTERPOSIÇÃO / reclassificação tributária.
--
-- Agora: o parceiro só saca com a empresa VALIDADA (perfis.pj_validada_em IS NOT NULL). A validação
-- é feita pela equipe após conferir cartão CNPJ / contrato social + o CPF no quadro societário + NF.
-- O saldo continua ACUMULANDO enquanto pendente (crédito condicionado — deixar claro nos Termos);
-- só o EXERCÍCIO (saque) fica bloqueado. Equipe operacional (admin/analista/…) segue via PIX pessoal,
-- sem esse gate. A coluna pj_validada_em já existia no schema (planejada) e passa a ser ENFORÇADA.
CREATE OR REPLACE FUNCTION public.solicitar_saque_ledger(p_user_id uuid, p_valor numeric)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
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

  SELECT nome, cpf, cpf_hash, telefone, chave_pix, role, cnpj, razao_social, pj_chave_pix, pj_validada_em
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

  -- GATE PJ (anti-interposição): parceiro só saca com a empresa VALIDADA pela equipe.
  IF v_parceiro AND v_perfil.pj_validada_em IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'pj_pendente', true,
      'error', 'Saque bloqueado: sua empresa (PJ) ainda não foi validada. Envie o cartão CNPJ/contrato social e a nota fiscal — o CPF do parceiro precisa constar no quadro societário. Liberamos o saque assim que a validação for concluída.');
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
