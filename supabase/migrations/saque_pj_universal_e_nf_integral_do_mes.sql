-- ============================================================================
-- NÃO EXISTE PAGAMENTO A PESSOA FÍSICA + NOTA FISCAL DO VALOR INTEGRAL DO MÊS
-- (08/08 — duas correções do dono, e a primeira desfaz um erro meu)
--
-- 1. PJ SEMPRE. Palavras do dono: "não há pagamento pessoa física, pois para
--    realizar o pagamento exige informar o CNPJ vinculado ao CPF. Já tínhamos
--    vencido essa etapa anteriormente."
--    E ele está certo — essa é a rota decidida no §12.9 (parceiro = PJ, comissão
--    B2B contra nota). O ERRO foi meu: ao abrir o saque para o parceiro grátis, eu
--    o mandei para o ramo do PIX PESSOAL (`perfis.chave_pix`), que existia para a
--    equipe operacional. Ou seja, reintroduzi pagamento a PF pela porta dos fundos,
--    e ainda montei em cima disso uma preocupação tributária que a arquitetura já
--    tinha resolvido. Agora o destino é a PJ para TODA classe, com o CPF conferido
--    no quadro societário (QSA) — sem exceção por papel, como já vale para o KYC e
--    para a nota fiscal.
--
-- 2. A NOTA COBRE O MÊS INTEIRO, não o pedido. "Se o pagamento foi feito inferior
--    a esse valor de R$ 2.500 e durante o mês alcançou o valor, deve não permitir
--    fazer o saque e exigir colocar nota fiscal referente ao valor integral do mês."
--    Antes eu exigia nota do VALOR PEDIDO. Isso abria um buraco óbvio: 3 saques de
--    R$ 1.000 sem nota e um quarto de R$ 500 pediria nota de R$ 500 — R$ 3.500
--    sacados no mês com R$ 500 documentados. Agora a nota tem de cobrir
--    `ja_sacado_no_mes + este_pedido`.
--
-- A regra `saque.destino_sempre_pj` é LIDA pela função (não embutida). Isso não é
-- capricho: quando eu a declarei e deixei o comportamento fixo no código, a
-- `auditoria_regras_negocio()` acusou "regra órfã" na hora — o mecanismo pegou o
-- autor do mecanismo, que é o melhor teste que ele podia ter.
-- ============================================================================

create or replace function public.saque_avaliar(p_user_id uuid, p_valor numeric)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_p          record;
  v_faltando   text[] := '{}';
  v_valor      numeric := round(coalesce(p_valor, 0)::numeric, 2);
  v_pagante    boolean;
  v_equipe     boolean;
  v_teto       numeric := coalesce((public.regra('saque.teto_sem_nf')->>'valor')::numeric, 2500);
  v_exige_kyc  boolean := coalesce((public.regra('saque.exige_kyc')->>'ativo')::boolean, true);
  v_ja         numeric;
  v_total_mes  numeric;
  v_acima      boolean;
  v_exige_nf   boolean := false;
  v_nf_ok      boolean := false;
  v_saldo      numeric;
  v_exige_pj   boolean := coalesce((public.regra('saque.destino_sempre_pj')->>'ativo')::boolean, true);
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
    from public.saldo_lancamentos where user_id = p_user_id and status <> 'cancelado';

  if v_p.nome is null or btrim(v_p.nome) = '' then
    v_faltando := array_append(v_faltando, 'nome');
  end if;
  if (v_p.cpf is null or btrim(v_p.cpf) = '') and v_p.cpf_hash is null then
    v_faltando := array_append(v_faltando, 'CPF');
  end if;
  if v_p.telefone is null or btrim(v_p.telefone) = '' then
    v_faltando := array_append(v_faltando, 'telefone');
  end if;

  if v_exige_kyc and not coalesce(v_p.identidade_validada, false) then
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
       and not v_pagante and not v_equipe then
      return jsonb_build_object(
        'permitido', false, 'acima_do_teto', true, 'precisa_assinar', true,
        'teto', v_teto, 'ja_sacado_na_janela', v_ja, 'total_do_mes', v_total_mes,
        'disponivel_sem_nf', greatest(v_teto - v_ja, 0), 'nf_valor_exigido', v_total_mes,
        'saldo', v_saldo, 'faltando', to_jsonb(v_faltando),
        'motivo', 'Você já sacou R$ ' || to_char(v_ja, 'FM999999990.00') || ' neste mês. Com este pedido o mês chega a R$ '
                  || to_char(v_total_mes, 'FM999999990.00') || ', acima do limite de R$ ' || to_char(v_teto, 'FM999999990.00')
                  || ' — a partir daí o saque exige plano pago e nota fiscal. Você pode sacar até R$ '
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
end; $$;

create or replace function public.solicitar_saque_ledger(p_user_id uuid, p_valor numeric)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_valor numeric := round(p_valor::numeric, 2);
  v_av    jsonb;
  v_pix   text;
  v_saldo numeric;
  v_lanc  bigint;
  v_total numeric;
begin
  if p_user_id is null then return jsonb_build_object('ok', false, 'error', 'Usuário inválido'); end if;
  if v_valor is null or v_valor <= 0 then return jsonb_build_object('ok', false, 'error', 'Valor inválido'); end if;

  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  v_av := public.saque_avaliar(p_user_id, v_valor);
  if not coalesce((v_av->>'permitido')::boolean, false) then
    return jsonb_build_object('ok', false,
      'error', v_av->>'motivo',
      'faltando', v_av->'faltando',
      'pj_pendente', coalesce((v_av->>'pj_pendente')::boolean, false),
      'pj_revalidar', coalesce((v_av->>'pj_revalidar')::boolean, false),
      'acima_do_teto', coalesce((v_av->>'acima_do_teto')::boolean, false),
      'exige_nf', coalesce((v_av->>'exige_nf')::boolean, false),
      'precisa_assinar', coalesce((v_av->>'precisa_assinar')::boolean, false),
      'nf_valor_exigido', v_av->'nf_valor_exigido',
      'disponivel_sem_nf', v_av->'disponivel_sem_nf',
      'saldo', v_av->'saldo');
  end if;

  select pj_chave_pix into v_pix from public.perfis where id = p_user_id;
  v_total := coalesce((v_av->>'total_do_mes')::numeric, v_valor);

  insert into public.saldo_lancamentos (user_id, tipo, valor, descricao, status)
  values (p_user_id, 'saque', -v_valor, 'Solicitação de saque para PIX ' || v_pix, 'solicitado')
  returning id into v_lanc;

  -- Consome a nota usada: ela cobriu o mês ATÉ aqui e não vale para o próximo pedido.
  if coalesce((v_av->>'exige_nf')::boolean, false) then
    update public.saque_nf set lancamento_id = v_lanc
     where id = (select id from public.saque_nf
                  where user_id = p_user_id and status = 'aprovada' and lancamento_id is null
                    and valor_nf >= v_total - 0.01 order by criado_em asc limit 1);
  end if;

  select coalesce(sum(valor), 0) into v_saldo
    from public.saldo_lancamentos where user_id = p_user_id and status <> 'cancelado';

  return jsonb_build_object('ok', true, 'saldo_restante', round(v_saldo, 2));
end; $$;

update public.regra_negocio
   set valor = valor || '{"nf_cobre": "total_do_mes"}'::jsonb,
       descricao = 'Teto de saque, por mês-calendário, que dispensa nota fiscal. ABSOLUTO: vale para TODA classe, inclusive equipe — a exigência de NF acima do teto é FISCAL. Quando o acumulado do mês ultrapassa o teto, a nota exigida é do VALOR INTEGRAL SACADO NO MÊS (ja_sacado + este pedido), não só do excedente nem só deste pedido: quem sacou 3× R$ 1.000 sem nota e pede mais R$ 500 precisa de nota de R$ 3.500. A exigência adicional de ESTAR EM PLANO PAGO acima do teto vale só para PARCEIRO. Para virar teto vitalício, troque "janela" para "vitalicio".',
       atualizado_em = now()
 where chave = 'saque.teto_sem_nf';

insert into public.regra_negocio (chave, valor, descricao, aplicada_por) values
  ('saque.destino_sempre_pj',
   '{"ativo": true, "escopo": "todos"}'::jsonb,
   'NÃO EXISTE pagamento a pessoa física (dono, 08/08: "para realizar o pagamento exige informar o CNPJ vinculado ao CPF; já tínhamos vencido essa etapa"). Todo saque, de qualquer classe, vai para a conta de uma PJ da qual o beneficiário é sócio, com o CPF conferido no quadro societário (QSA). Antes, o caminho do não-pagante caía em PIX pessoal — era pagamento PF entrando pela porta dos fundos.',
   array['saque_avaliar'])
on conflict (chave) do update
   set valor = excluded.valor, descricao = excluded.descricao,
       aplicada_por = excluded.aplicada_por, atualizado_em = now();

revoke all on function public.saque_avaliar(uuid, numeric) from public, anon, authenticated;
revoke all on function public.solicitar_saque_ledger(uuid, numeric) from public, anon, authenticated;
