-- 13/10: BACKFILL do corpo VIVO de saque_avaliar (forma 7b — mudou no banco, não no repo).
-- As migrações saque_kyc_escopo_parceiro.sql e saque_pagante_absoluto_acima_do_teto.sql só trocaram
-- dados de regra_negocio; o corpo que lê `escopo` (KYC e pagante acima do teto) foi aplicado direto
-- no Supabase. Recriar o banco do repo voltaria à versão anterior. Este arquivo É o que está em
-- produção, copiado de pg_get_functiondef — aplicá-lo é no-op.
CREATE OR REPLACE FUNCTION public.saque_avaliar(p_user_id uuid, p_valor numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_p          record;
  v_faltando   text[] := '{}';
  v_valor      numeric := round(coalesce(p_valor, 0)::numeric, 2);
  v_pagante    boolean;
  v_equipe     boolean;
  v_teto       numeric := coalesce((public.regra('saque.teto_sem_nf')->>'valor')::numeric, 2500);
  v_exige_kyc  boolean := coalesce((public.regra('saque.exige_kyc')->>'ativo')::boolean, true);
  v_kyc_escopo text := coalesce(public.regra('saque.exige_kyc')->>'escopo', 'todos');
  v_ja         numeric;
  v_total_mes  numeric;
  v_acima      boolean;
  v_exige_nf   boolean := false;
  v_nf_ok      boolean := false;
  v_saldo      numeric;
  v_exige_pj   boolean := coalesce((public.regra('saque.destino_sempre_pj')->>'ativo')::boolean, true);
  v_pag_escopo text := coalesce(public.regra('saque.acima_do_teto')->>'escopo', 'todos');
begin
  if p_user_id is null then
    return jsonb_build_object('permitido', false, 'motivo', 'Usuário inválido');
  end if;

  select nome, cpf, cpf_hash, telefone, role, cnpj, razao_social,
         pj_chave_pix, pj_validada_em, pj_revalidacao_pendente, identidade_validada, termos_uso_versao
    into v_p from public.perfis where id = p_user_id;

  if not found then
    return jsonb_build_object('permitido', false, 'motivo', 'Perfil não encontrado');
  end if;

  v_pagante   := public.eh_pagante(v_p.role);
  v_equipe    := v_p.role = any (array['admin','analista','advogado','consultor','afiliado','leiloeiro']);
  v_ja        := public.saque_sacado_na_janela(p_user_id);
  v_total_mes := v_ja + v_valor;
  v_acima     := v_total_mes > v_teto;

  select coalesce(sum(valor), 0) into v_saldo
    from public.saldo_lancamentos where user_id = p_user_id and status not in ('cancelado','a_liberar');

  if v_p.nome is null or btrim(v_p.nome) = '' then
    v_faltando := array_append(v_faltando, 'nome');
  end if;
  if (v_p.cpf is null or btrim(v_p.cpf) = '') and v_p.cpf_hash is null then
    v_faltando := array_append(v_faltando, 'CPF');
  end if;
  if v_p.telefone is null or btrim(v_p.telefone) = '' then
    v_faltando := array_append(v_faltando, 'telefone');
  end if;

  -- KYC: escopo lido do dado. 'parceiro' = equipe operacional isenta.
  if v_exige_kyc
     and (v_kyc_escopo = 'todos' or not v_equipe)
     and not coalesce(v_p.identidade_validada, false) then
    v_faltando := array_append(v_faltando, 'identidade validada (selfie + documento)');
  end if;

  if coalesce((public.regra('saque.exige_termos_vigentes')->>'ativo')::boolean, false)
     and not v_equipe
     and coalesce(v_p.termos_uso_versao, '') <> coalesce(public.regra('saque.exige_termos_vigentes')->>'versao', '') then
    v_faltando := array_append(v_faltando, 'aceite da versão atual dos Termos (basta aceitar — nenhum documento novo)');
  end if;

  if v_exige_pj and (v_p.cnpj is null or btrim(v_p.cnpj) = '') then
    v_faltando := array_append(v_faltando, 'empresa (CNPJ do qual você é sócio)');
  end if;
  if v_exige_pj and (v_p.razao_social is null or btrim(v_p.razao_social) = '') then
    v_faltando := array_append(v_faltando, 'razão social');
  end if;
  if v_exige_pj and (v_p.pj_chave_pix is null or btrim(v_p.pj_chave_pix) = '') then
    v_faltando := array_append(v_faltando, 'PIX da empresa');
  end if;

  if v_acima then
    v_exige_nf := coalesce((public.regra('saque.acima_do_teto')->>'exige_nf')::boolean, true);
    if coalesce((public.regra('saque.acima_do_teto')->>'exige_pagante')::boolean, true)
       and not v_pagante
       and (v_pag_escopo = 'todos' or not v_equipe) then
      return jsonb_build_object(
        'permitido', false, 'acima_do_teto', true, 'precisa_assinar', true,
        'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
        'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'nf_valor_exigido', v_total_mes,
        'saldo', v_saldo, 'faltando', to_jsonb(v_faltando),
        'motivo', 'Você já sacou R$ ' || to_char(v_ja, 'FM999999990.00') || ' neste mês. Com este pedido o mês chega a R$ '
                  || to_char(v_total_mes, 'FM999999990.00') || ', acima do limite de R$ ' || to_char(v_teto, 'FM999999990.00')
                  || ' — a partir daí o saque exige plano pago e nota fiscal, para qualquer perfil. Você pode sacar até R$ '
                  || to_char(greatest(v_teto - v_ja, 0), 'FM999999990.00') || ' agora, ou assinar um plano para liberar o valor cheio.');
    end if;
    if v_exige_nf then
      select true into v_nf_ok from public.saque_nf
       where user_id = p_user_id and status = 'aprovada' and lancamento_id is null
         and valor_nf >= v_total_mes - 0.01
       limit 1;
      if not coalesce(v_nf_ok, false) then
        return jsonb_build_object(
          'permitido', false, 'acima_do_teto', true, 'exige_nf', true,
          'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
          'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'nf_valor_exigido', v_total_mes,
          'saldo', v_saldo, 'faltando', to_jsonb(v_faltando),
          'motivo', 'Com este pedido o mês chega a R$ ' || to_char(v_total_mes, 'FM999999990.00')
                    || ', acima do limite de R$ ' || to_char(v_teto, 'FM999999990.00')
                    || '. Anexe a nota fiscal do valor INTEGRAL sacado no mês (R$ '
                    || to_char(v_total_mes, 'FM999999990.00') || '), não apenas deste pedido.');
      end if;
    end if;
  end if;

  if array_length(v_faltando, 1) > 0 then
    return jsonb_build_object('permitido', false, 'faltando', to_jsonb(v_faltando),
      'acima_do_teto', v_acima, 'exige_nf', v_exige_nf, 'teto', v_teto,
      'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'nf_valor_exigido', case when v_acima then v_total_mes else null end,
      'saldo', v_saldo,
      'motivo', 'Complete seu cadastro para sacar. Falta: ' || array_to_string(v_faltando, ', ') || '.');
  end if;

  if v_exige_pj and v_p.pj_validada_em is null then
    return jsonb_build_object('permitido', false, 'pj_pendente', true, 'saldo', v_saldo,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
      'motivo', 'Saque bloqueado: sua empresa (PJ) ainda não foi validada. Envie o cartão CNPJ/contrato social — o seu CPF precisa constar no quadro societário do CNPJ informado.');
  end if;
  if v_exige_pj and coalesce(v_p.pj_revalidacao_pendente, false) then
    return jsonb_build_object('permitido', false, 'pj_revalidar', true, 'saldo', v_saldo,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
      'motivo', 'Repasse retido: os dados da sua empresa divergiram na reconferência periódica. Atualize o CNPJ/razão social e clique em "Verificar automaticamente".');
  end if;

  if v_valor > 0 and v_valor > v_saldo then
    return jsonb_build_object('permitido', false, 'saldo', v_saldo,
      'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
      'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
      'motivo', 'Saldo insuficiente. Disponível: R$ ' || to_char(v_saldo, 'FM999999990.00'));
  end if;

  return jsonb_build_object('permitido', true, 'saldo', v_saldo, 'teto', v_teto,
    'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
    'disponivel_sem_nf', greatest(v_teto - v_ja, 0),
    'acima_do_teto', v_acima, 'exige_nf', v_exige_nf, 'destino', 'pj');
end; $function$;
